import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { OperacionesService } from '../operaciones/operaciones.service.js';
import { ServiciosEspecialesService } from '../operaciones/servicios-especiales.service.js';
import { StorageService } from '../storage/storage.service.js';
import type { MediaEvidenceType } from '../storage/storage.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SyncPushDto } from './dto/sync-push.dto.js';
import { SyncPullQueryDto } from './dto/sync-pull.dto.js';
import { RegisterPushTokenDto } from './dto/sync-device.dto.js';
import { ServiceStatus } from '@prisma/client';
import { buildDataGridResponse } from '../../common/dto/data-grid.dto.js';
import { serializeServicioLavado } from '../../common/utils/servicio-serializer.util.js';

import { tienePermiso } from '../../common/permisos/capacidades.js';
import { esLiderDeAgencia, rolDeUsuario } from '../../common/permisos/alias-roles.js';
import { modulosDeRol } from '../../common/permisos/modulos-navegacion.js';
import {
  resolverAlcance,
  SIN_RESULTADOS,
} from '../../common/permisos/alcance.js';
const publicMediaUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return /^https:\/\//i.test(normalized) ? normalized : undefined;
};

export interface SyncMutationResult {
  mutationId: string;
  clientUuid: string;
  serverAssignedId: string;
  status: 'APPLIED' | 'ALREADY_EXISTS' | 'FAILED' | 'DEAD_LETTER';
  syncedAt: string;
  error?: string;
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private prisma: PrismaService,
    private operacionesService: OperacionesService,
    private serviciosEspecialesService: ServiciosEspecialesService,
    private storageService: StorageService,
    @Optional() private notifications?: NotificationsService,
  ) {}

  async processPush(body: any, userId: string, headerOpId?: string) {
    const now = new Date();
    const results: SyncMutationResult[] = [];

    // Normalizar si viene en lote (SyncPushDto) o evento singular (SyncEngine de la app)
    let deviceId = body?.deviceId || 'mobile-app';
    let mutations: any[] = [];

    if (Array.isArray(body?.mutations)) {
      mutations = body.mutations;
    } else if (body?.operationId || body?.entityType || headerOpId) {
      const opId = body?.operationId || headerOpId || `op_${Date.now()}`;
      const payload = body?.payload || body;
      mutations = [
        {
          mutationId: opId,
          clientUuid: payload?.clientUuid || payload?.id || opId,
          entity: body?.entityType || 'servicio_lavado',
          action: body?.action || 'CREATE',
          timestamp: Date.now(),
          data: payload,
        },
      ];
    } else {
      return { success: true, processed: 0, results: [] };
    }

    // Punto 4: Límite estricto de chunking en backend (máximo 50 mutaciones por petición)
    if (mutations.length > 50) {
      throw new BadRequestException(
        `Lote excede el máximo permitido de 50 mutaciones por petición (recibidas: ${mutations.length}). Por favor divida en tandas de hasta 50.`,
      );
    }

    // Punto 1: Ordenamiento Causal estricto por timestamp ascendente
    // Garantiza que el "padre" (CREATE) siempre se escriba en PostgreSQL antes que los "hijos" (ADD_EVIDENCIA, COMPLETE, etc.)
    mutations.sort((a, b) => {
      const timeA = Number(a.timestamp) || 0;
      const timeB = Number(b.timestamp) || 0;
      return timeA - timeB;
    });

    // Obtener usuario actual para conocer su agencia
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: true,
        agencia: {
          include: { bahias: true },
        },
      },
    });

    // Rescate de Lotes de Operadores Desactivados:
    // Si el usuario fue dado de baja mientras tenía órdenes offline pendientes, se resguardan en DLQ
    if (currentUser && currentUser.estado === 0) {
      this.logger.warn(
        `[SyncRescue] Operador ${currentUser.email} (${userId}) está inactivo. Rescatando lote offline hacia la DLQ.`,
      );
      for (const mut of mutations) {
        await this.prisma.syncDeadLetterQueue.upsert({
          where: { mutationId: mut.mutationId },
          update: {
            errorMotivo: `OPERADOR_INACTIVO_RESCATE: Operador ${currentUser.email} fue desactivado`,
            intentos: { increment: 1 },
          },
          create: {
            mutationId: mut.mutationId,
            clientUuid: mut.clientUuid || mut.mutationId,
            entityType: mut.entity || 'servicio_lavado',
            payload: mut as any,
            errorMotivo: `OPERADOR_INACTIVO_RESCATE: Operador ${currentUser.email} fue desactivado`,
            intentos: 1,
            resuelto: false,
            usuarioId: userId,
          },
        });
        results.push({
          mutationId: mut.mutationId,
          clientUuid: mut.clientUuid,
          serverAssignedId: '',
          status: 'FAILED',
          error:
            'OPERADOR_INACTIVO_RESCATE: Mutación resguardada en Dead-Letter Queue para aprobación gerencial.',
          syncedAt: now.toISOString(),
        });
      }
      return {
        success: false,
        rescatadoEnDlq: true,
        processed: mutations.length,
        results,
      };
    }

    // Registrar o actualizar dispositivo del operador
    if (userId && deviceId) {
      try {
        await this.prisma.syncDevice.upsert({
          where: { deviceId },
          update: {
            userId,
            lastSyncAt: new Date(),
            appVersion: body?.appVersion || body?.version || undefined,
            platform: body?.platform || undefined,
          },
          create: {
            userId,
            deviceId,
            appVersion: body?.appVersion || body?.version || '1.0.0',
            platform: body?.platform || 'react-native',
            lastSyncAt: new Date(),
          },
        });
      } catch (devErr) {
        this.logger.warn(`No se pudo actualizar SyncDevice: ${devErr}`);
      }
    }

    for (const mut of mutations) {
      try {
        const processedMutation = mut.mutationId
          ? await this.prisma.syncOutboxAudit.findFirst({
              where: { mutationId: mut.mutationId },
            })
          : null;
        if (processedMutation) {
          results.push({
            mutationId: mut.mutationId,
            clientUuid: mut.clientUuid,
            serverAssignedId: '',
            status: 'ALREADY_EXISTS',
            syncedAt: processedMutation.syncedAt.toISOString(),
          });
          continue;
        }
        const entity = String(mut.entity || '').toLowerCase();
        const isServicio =
          entity === 'servicio_lavado' || entity === 'work_order';

        if (isServicio) {
          const action = String(mut.action || 'CREATE').toUpperCase();

          if (action === 'CREATE') {
            // 1. Idempotencia: validar si ya existe por clientUuid
            const existing = await this.prisma.servicioLavado.findUnique({
              where: { clientUuid: mut.clientUuid },
            });

            if (existing) {
              results.push({
                mutationId: mut.mutationId,
                clientUuid: mut.clientUuid,
                serverAssignedId: existing.id,
                status: 'ALREADY_EXISTS',
                syncedAt: existing.syncedAt.toISOString(),
              });
              continue;
            }

            // 2. Determinar Bahía válida
            let bahiaId = mut.data?.bahiaId;
            if (bahiaId) {
              const b = await this.prisma.bahia.findUnique({
                where: { id: bahiaId },
              });
              const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(
                currentUser?.role?.namerol || '',
              );
              if (
                !b ||
                (!isAdmin &&
                  currentUser?.agenciaId &&
                  b.agenciaId !== currentUser.agenciaId)
              )
                bahiaId = null;
            }
            if (!bahiaId) {
              bahiaId = currentUser?.agencia?.bahias?.[0]?.id;
            }
            if (!bahiaId) {
              throw new BadRequestException(
                'El operador no tiene una bahía activa disponible.',
              );
            }

            let servicioCatalogoId = Number(
              mut.data?.servicioCatalogoId || mut.data?.serviceId,
            );
            let catalogo = servicioCatalogoId
              ? await this.prisma.catalogoServicio.findUnique({
                  where: { id: servicioCatalogoId },
                })
              : null;
            if (!catalogo && (mut.data?.servicio || mut.data?.tipoLavado)) {
              const nombre = String(mut.data.servicio || mut.data.tipoLavado)
                .split(' + ')[0]
                .trim();
              catalogo = await this.prisma.catalogoServicio.findFirst({
                where: {
                  OR: [
                    { nombre: { equals: nombre, mode: 'insensitive' } },
                    { codigo: { equals: nombre, mode: 'insensitive' } },
                  ],
                },
              });
              servicioCatalogoId = catalogo?.id || 0;
            }
            if (!catalogo) {
              throw new BadRequestException(
                'No se pudo resolver el servicio en el catálogo offline.',
              );
            }
            if (esLiderDeAgencia(rolDeUsuario(currentUser)) && catalogo.categoria !== 'GENERAL') {
              throw new BadRequestException('Tu rol solo puede registrar servicios generales.');
            }

            const placa = String(
              mut.data?.placa || mut.data?.vehiclePlate || '',
            )
              .toUpperCase()
              .trim();
            if (!placa) {
              throw new BadRequestException(
                'La placa del vehículo es obligatoria.',
              );
            }
            const modelo = String(
              mut.data?.modelo || mut.data?.vehicleModel || '',
            ).trim();

            // Blindaje Huella Operativa: Detección de vehículo ya activo en la misma agencia (Ventana 4 horas)
            const cuatroHorasAtras = new Date(
              now.getTime() - 4 * 60 * 60 * 1000,
            );
            const bahiaObj = bahiaId
              ? await this.prisma.bahia.findUnique({
                  where: { id: bahiaId },
                  select: { agenciaId: true },
                })
              : null;
            const targetAgenciaId =
              bahiaObj?.agenciaId ||
              currentUser?.agenciaId ||
              currentUser?.agencia?.id;
            const otMutacion = String(
              mut.data?.ordenTrabajoOT || mut.data?.numeroOrden || '',
            ).trim();

            // Una OT general puede tener varios servicios (una fila por servicio): las filas
            // activas de la misma OT no son duplicados, salvo que repitan el mismo servicio.
            const duplicateActive = await this.prisma.servicioLavado.findFirst({
              where: {
                placa,
                bahia: targetAgenciaId
                  ? { agenciaId: targetAgenciaId }
                  : undefined,
                estado: {
                  in: [ServiceStatus.EN_ESPERA, ServiceStatus.EN_PROCESO],
                },
                horaIngreso: { gte: cuatroHorasAtras },
                deletedAt: null,
                NOT: { clientUuid: mut.clientUuid },
                ...(otMutacion
                  ? {
                      OR: [
                        { ordenTrabajoOT: null },
                        {
                          NOT: {
                            ordenTrabajoOT: {
                              equals: otMutacion,
                              mode: 'insensitive',
                            },
                          },
                        },
                        { servicioCatalogoId },
                      ],
                    }
                  : {}),
              },
            });

            if (duplicateActive) {
              this.logger.warn(
                `[DuplicatedPlate] Placa ${placa} ya tiene una orden activa (${duplicateActive.id}) en la agencia. Aislando en DLQ.`,
              );
              await this.prisma.syncDeadLetterQueue.upsert({
                where: { mutationId: mut.mutationId },
                update: {
                  clientUuid: mut.clientUuid,
                  payload: mut as any,
                  errorMotivo: `POSIBLE_DUPLICADO_PLACA: El vehículo ya tiene orden activa ${duplicateActive.id} (${duplicateActive.placa})`,
                  intentos: { increment: 1 },
                  resuelto: false,
                },
                create: {
                  mutationId: mut.mutationId,
                  clientUuid: mut.clientUuid,
                  entityType: 'servicio_lavado',
                  payload: mut as any,
                  errorMotivo: `POSIBLE_DUPLICADO_PLACA: El vehículo ya tiene orden activa ${duplicateActive.id} (${duplicateActive.placa})`,
                  intentos: 1,
                  resuelto: false,
                  usuarioId: userId,
                },
              });

              results.push({
                mutationId: mut.mutationId,
                clientUuid: mut.clientUuid,
                serverAssignedId: duplicateActive.id,
                // DEAD_LETTER, no FAILED: esta condición (otra orden activa con la misma placa) no se
                // resuelve sola reintentando — ya quedó registrada en syncDeadLetterQueue para
                // resolución manual arriba. Devolver FAILED hacía que el cliente reintentara el mismo
                // rechazo cada 30s para siempre, sin que nadie se enterara (ver conversación con el
                // usuario del 2026-09-30).
                status: 'DEAD_LETTER',
                error: `POSIBLE_DUPLICADO_PLACA: Ya existe la orden activa ${duplicateActive.id} para el vehículo ${placa}`,
                syncedAt: now.toISOString(),
              });
              continue;
            }

            const estadoFinal: ServiceStatus =
              mut.data?.estado === 'FINALIZADO' ||
              mut.data?.status === 'COMPLETED'
                ? ServiceStatus.FINALIZADO
                : mut.data?.estado === 'EN_PROCESO' ||
                    mut.data?.status === 'IN_PROGRESS'
                  ? ServiceStatus.EN_PROCESO
                  : ServiceStatus.EN_ESPERA;

            // Si se crea directamente como finalizado, inicializar en proceso para gatillar
            // el descuento de insumos de forma transaccional mediante el hook oficial
            const estadoInicial =
              estadoFinal === ServiceStatus.FINALIZADO
                ? ServiceStatus.EN_PROCESO
                : estadoFinal;

            // Blindaje 5: Normalizar y sanitizar horaIngreso contra desincronización de reloj móvil (Clock Skew)
            let sanitizedHoraIngreso = now;
            if (mut.data?.horaIngreso) {
              const parsed = new Date(mut.data.horaIngreso);
              if (!isNaN(parsed.getTime())) {
                const diffMs = parsed.getTime() - now.getTime();
                // Si el reloj del móvil está adelantado más de 5 minutos (>300,000ms) o reseteado al pasado (<2020)
                if (diffMs > 300000 || parsed.getFullYear() < 2020) {
                  this.logger.warn(
                    `[ClockSkew] Reloj cliente descalibrado (${mut.data.horaIngreso}). Ajustando a serverTime actual.`,
                  );
                  sanitizedHoraIngreso = now;
                } else {
                  sanitizedHoraIngreso = parsed;
                }
              }
            }

            // Servicios agregados a una OT existente heredan la evidencia de ingreso de la OT.
            const hermanaOT = otMutacion
              ? await this.prisma.servicioLavado.findFirst({
                  where: {
                    ordenTrabajoOT: { equals: otMutacion, mode: 'insensitive' },
                    placa,
                    deletedAt: null,
                    OR: [
                      { videoInicialUrl: { not: null } },
                      { fotoIngresoUrl: { not: null } },
                    ],
                  },
                  select: { videoInicialUrl: true, fotoIngresoUrl: true },
                  orderBy: { createdAt: 'asc' },
                })
              : null;

            // Blindaje Agencia: si la app indicó qué lavador realiza el servicio, debe
            // pertenecer a la misma agencia que la bahía y estar activo. Si no se indicó,
            // la OT se atribuye a quien está autenticado (comportamiento previo).
            if (mut.data?.operadorId) {
              const lavador = await this.prisma.user.findUnique({
                where: { id: String(mut.data.operadorId) },
              });
              if (!lavador) {
                throw new BadRequestException(
                  'El lavador seleccionado no existe.',
                );
              }
              if (
                targetAgenciaId &&
                String(lavador.agenciaId || '') !== String(targetAgenciaId)
              ) {
                throw new BadRequestException(
                  'El lavador seleccionado no pertenece a la agencia de la bahía indicada.',
                );
              }
              if (lavador.estado !== 1) {
                throw new BadRequestException(
                  'El lavador seleccionado está inactivo y no puede recibir nuevas OTs.',
                );
              }
            }

            let nuevoServicio: any;
            try {
              nuevoServicio = await this.prisma.servicioLavado.create({
                data: {
                  clientUuid: mut.clientUuid,
                  ordenTrabajoOT:
                    String(
                      mut.data?.ordenTrabajoOT || mut.data?.numeroOrden || '',
                    ).trim() || undefined,
                  placa,
                  marca: mut.data?.marca?.trim() || undefined,
                  modelo,
                  color: mut.data?.color?.trim(),
                  cliente:
                    mut.data?.cliente?.trim() || mut.data?.clientName?.trim(),
                  estado: estadoInicial,
                  bahiaId,
                  servicioCatalogoId,
                  operadorId: String(mut.data?.operadorId || userId),
                  horaIngreso: sanitizedHoraIngreso,
                  horaSalida:
                    estadoFinal === ServiceStatus.FINALIZADO ? now : null,
                  fotoIngresoUrl:
                    publicMediaUrl(mut.data?.fotoIngresoUrl) ||
                    hermanaOT?.fotoIngresoUrl ||
                    undefined,
                  videoInicialUrl:
                    publicMediaUrl(
                      mut.data?.videoInicialUrl || mut.data?.videoUrl,
                    ) ||
                    hermanaOT?.videoInicialUrl ||
                    undefined,
                  fotoSalidaUrl: publicMediaUrl(mut.data?.fotoSalidaUrl),
                  observaciones: mut.data?.observaciones || mut.data?.notes,
                  syncedAt: now,
                },
              });
            } catch (createErr: any) {
              // Blindaje 3: Neutralizar carreras concurrentes ("Double-Tap" / dos peticiones simultáneas)
              if (createErr?.code === 'P2002') {
                const raceExisting =
                  await this.prisma.servicioLavado.findUnique({
                    where: { clientUuid: mut.clientUuid },
                  });
                if (raceExisting) {
                  this.logger.warn(
                    `[DoubleTapRace] Detectada inserción concurrente P2002 para clientUuid=${mut.clientUuid}. Retornando ALREADY_EXISTS sin error 500.`,
                  );
                  results.push({
                    mutationId: mut.mutationId,
                    clientUuid: mut.clientUuid,
                    serverAssignedId: raceExisting.id,
                    status: 'ALREADY_EXISTS',
                    syncedAt: raceExisting.syncedAt.toISOString(),
                  });
                  continue;
                }
              }
              throw createErr;
            }

            try {
              await this.operacionesService.consumirInsumosSiPendiente(
                nuevoServicio.id,
                true,
              );
            } catch (e: any) {
              this.logger.warn(
                `Advertencia al descontar insumos de orden offline: ${e.message}`,
              );
            }

            // Si se creó directamente como finalizado, invocar hook oficial de descuento de insumos con No-Block Policy
            if (estadoFinal === ServiceStatus.FINALIZADO) {
              try {
                await this.operacionesService.update(
                  nuevoServicio.id,
                  {
                    id: nuevoServicio.id,
                    estado: ServiceStatus.FINALIZADO,
                    fotoSalidaUrl: publicMediaUrl(mut.data?.fotoSalidaUrl),
                    observaciones: mut.data?.observaciones || mut.data?.notes,
                  },
                  true,
                ); // isOfflineSync = true
              } catch (e: any) {
                this.logger.warn(
                  `Advertencia al descontar insumos de orden offline: ${e.message}`,
                );
              }
            }

            // Auditoría
            await this.prisma.syncOutboxAudit.create({
              data: {
                mutationId: mut.mutationId,
                clientUuid: mut.clientUuid,
                deviceInfo: deviceId,
                entity: 'ServicioLavado',
                action: 'CREATE',
                payload: mut as any,
                syncedAt: now,
              },
            });

            results.push({
              mutationId: mut.mutationId,
              clientUuid: mut.clientUuid,
              serverAssignedId: nuevoServicio.id,
              status: 'APPLIED',
              syncedAt: now.toISOString(),
            });
          } else if (action === 'UPDATE' || action === 'COMPLETE') {
            // Actualización de orden existente
            // `id` es un uuid String en Prisma; algunos clientes (móvil, al crear offline) usan
            // internamente un id numérico de placeholder que nunca corresponde a una fila real. Sin
            // este `String(...)`, Prisma rechaza la consulta ENTERA con un error de validación
            // ("Invalid invocation") en vez de simplemente no encontrar coincidencia por ese lado —
            // tumbaba toda la mutación (y dejaba la OT sin finalizar) por un tipo de dato, no por un
            // rechazo de negocio real. clientUuid sigue siendo la clave de idempotencia confiable.
            const existing = await this.prisma.servicioLavado.findFirst({
              where: {
                OR: [
                  { clientUuid: mut.clientUuid },
                  { id: String(mut.data?.id || mut.clientUuid) },
                ],
              },
            });

            if (!existing) {
              throw new BadRequestException(
                `Servicio ${mut.clientUuid} no encontrado para actualización`,
              );
            }

            // Matriz de Resolución de Conflictos y Falla Asumida (Zero-Trust):
            // 1. Si ya estaba FINALIZADO en servidor y llega un reintento de COMPLETE
            // (porque el 200 OK previo se perdió en el aire):
            if (
              existing.estado === ServiceStatus.FINALIZADO &&
              (action === 'COMPLETE' ||
                mut.data?.estado === 'FINALIZADO' ||
                mut.data?.status === 'COMPLETED')
            ) {
              results.push({
                mutationId: mut.mutationId,
                clientUuid: mut.clientUuid,
                serverAssignedId: existing.id,
                status: 'ALREADY_EXISTS',
                syncedAt: existing.updatedAt.toISOString(),
              });
              continue;
            }

            // 2. Si el servicio en servidor fue cancelado o eliminado pero el operador en campo lo finalizó físicamente:
            // "Gana la Operación en Campo"
            let overrideWarning: string | null = null;
            if (
              (existing.estado === ServiceStatus.CANCELADO ||
                existing.deletedAt) &&
              (action === 'COMPLETE' ||
                mut.data?.estado === 'FINALIZADO' ||
                mut.data?.status === 'COMPLETED')
            ) {
              overrideWarning =
                'Revertida cancelación o eliminación previa: prevaleció finalización física en campo.';
              this.logger.warn(
                `[ConflictResolution] ${overrideWarning} (Servicio: ${existing.id})`,
              );
            }

            // Punto 6: Control de Versiones Optimista (OCC) y Merge Inteligente
            const incomingVersion = Number(mut.data?.version || 1);
            let observacionesFinales =
              mut.data?.observaciones ||
              mut.data?.notes ||
              existing.observaciones;
            let isOccMerged = false;

            if (existing.version > incomingVersion) {
              // Conflicto detectado: un usuario web editó la orden mientras el móvil estuvo sin internet
              isOccMerged = true;
              const mobileNotes = mut.data?.observaciones || mut.data?.notes;
              if (
                mobileNotes &&
                existing.observaciones &&
                mobileNotes !== existing.observaciones
              ) {
                observacionesFinales =
                  `${existing.observaciones} | [Móvil]: ${mobileNotes}`.trim();
              }
              this.logger.log(
                `[OCC] Conflicto version detectado en ${existing.id} (servidor: v${existing.version} > móvil: v${incomingVersion}). Merge inteligente aplicado preservando notas web y registrando campo.`,
              );
            }

            let estadoNuevo =
              action === 'COMPLETE' ||
              mut.data?.estado === 'FINALIZADO' ||
              mut.data?.status === 'COMPLETED'
                ? ServiceStatus.FINALIZADO
                : mut.data?.estado || existing.estado;

            // Blindaje 2: Máquina de estados irreversible contra entregas desordenadas (Out-of-Order Packet Delivery)
            // Secuencia de vida estricta: EN_ESPERA -> EN_PROCESO -> FINALIZADO -> APROBADO
            if (
              existing.estado === ServiceStatus.APROBADO &&
              estadoNuevo !== ServiceStatus.APROBADO
            ) {
              this.logger.warn(
                `[SyncStateGuard] Orden ${existing.id} ya fue APROBADA gerencialmente. Se descarta regresión a ${estadoNuevo}.`,
              );
              estadoNuevo = ServiceStatus.APROBADO;
            } else if (
              existing.estado === ServiceStatus.FINALIZADO &&
              (estadoNuevo === ServiceStatus.EN_PROCESO ||
                estadoNuevo === ServiceStatus.EN_ESPERA)
            ) {
              this.logger.warn(
                `[SyncStateGuard] Orden ${existing.id} ya está FINALIZADA. Se descarta paquete retrasado que solicita ${estadoNuevo}.`,
              );
              estadoNuevo = ServiceStatus.FINALIZADO;
            }

            const updated = await this.operacionesService.update(
              existing.id,
              {
                id: existing.id,
                estado: estadoNuevo,
                fotoSalidaUrl:
                  publicMediaUrl(mut.data?.fotoSalidaUrl) ||
                  existing.fotoSalidaUrl ||
                  undefined,
                observaciones: observacionesFinales,
              },
              true,
            ); // isOfflineSync = true

            // Si el servicio estaba con soft-delete previo, restaurar deletedAt = null
            if (
              existing.deletedAt &&
              (action === 'COMPLETE' || mut.data?.estado === 'FINALIZADO')
            ) {
              await this.prisma.servicioLavado.update({
                where: { id: existing.id },
                data: { deletedAt: null },
              });
            }

            const auditAction = overrideWarning
              ? `${action}_OVERRIDE_CONFLICT`
              : isOccMerged
                ? `${action}_OCC_MERGED`
                : action;

            await this.prisma.syncOutboxAudit.create({
              data: {
                mutationId: mut.mutationId,
                clientUuid: mut.clientUuid,
                deviceInfo: deviceId,
                entity: 'ServicioLavado',
                action: auditAction,
                payload: {
                  ...(mut as any),
                  conflictNote: overrideWarning,
                  isOccMerged,
                },
                syncedAt: now,
              },
            });

            results.push({
              mutationId: mut.mutationId,
              clientUuid: mut.clientUuid,
              serverAssignedId: updated.id,
              status: 'APPLIED',
              syncedAt: now.toISOString(),
            });
          }
        } else if (
          entity === 'incidente' ||
          entity === 'incidente_tecnico' ||
          entity === 'incidente_maquinaria' ||
          entity === 'maintenance_incident'
        ) {
          const incidentAction = String(mut.action || 'CREATE').toUpperCase();
          const existingIncident = await this.prisma.incidenteTecnico.findFirst(
            {
              where: { clientUuid: mut.clientUuid },
            },
          );
          if (incidentAction === 'CREATE' && existingIncident) {
            results.push({
              mutationId: mut.mutationId,
              clientUuid: mut.clientUuid,
              serverAssignedId: existingIncident.id,
              status: 'ALREADY_EXISTS',
              syncedAt: existingIncident.updatedAt.toISOString(),
            });
            continue;
          }
          // Las incidencias de maquinaria ya no se crean ni se cierran por sincronización offline:
          // el reporte exige conexión (hora del servidor, máquina asignada y evidencia verificada en S3).
          throw new BadRequestException(
            'Las incidencias de maquinaria requieren conexión a internet. Repórtalas o ciérralas en línea.',
          );
        } else if (
          entity === 'servicio_especial' ||
          entity === 'servicio_extra' ||
          entity === 'special_service' ||
          entity === 'extra_assignment'
        ) {
          const mutData = mut.data || {};
          const action = String(mut.action || 'CREATE').toUpperCase();

          if (action === 'CREATE') {
            const existing = await this.prisma.servicioEspecial.findFirst({
              where: {
                OR: [
                  { clientUuid: mut.clientUuid },
                  { codigoSE: mutData.codigoSE || 'none' },
                ],
              },
            });

            if (existing) {
              results.push({
                mutationId: mut.mutationId,
                clientUuid: mut.clientUuid,
                serverAssignedId: existing.id,
                status: 'ALREADY_EXISTS',
                syncedAt: (
                  existing.syncedAt || existing.createdAt
                ).toISOString(),
              });
              continue;
            }

            const vInfo = mutData.vehiculoInfo || mutData;
            const placa = String(vInfo.placa || mutData.placa || '')
              .toUpperCase()
              .trim();
            if (!placa) {
              throw new BadRequestException(
                'La placa del vehículo es obligatoria.',
              );
            }
            const marca = vInfo.marca || mutData.marca || null;
            const modelo = vInfo.modelo || mutData.modelo || null;
            const color = vInfo.color || mutData.color || null;
            const clienteNombre =
              vInfo.cliente || vInfo.clienteNombre || mutData.cliente || null;

            const tipoServicio = String(
              mutData.tipoServicio || mutData.servicioNombre || '',
            ).trim();
            if (!tipoServicio) {
              throw new BadRequestException(
                'El tipo de servicio especial es obligatorio.',
              );
            }

            const codigoSE =
              mutData.codigoSE || `SE-${Date.now().toString().slice(-6)}`;
            const operadoresIds = Array.isArray(mutData.operadoresIds)
              ? mutData.operadoresIds.map((id: unknown) => String(id))
              : mutData.operadorId
                ? [String(mutData.operadorId)]
                : [];
            const created = await this.serviciosEspecialesService.create(
              {
                clientUuid: mut.clientUuid,
                codigoSE,
                ordenTrabajoOT: String(mutData.ordenTrabajoOT || codigoSE),
                tipoServicio,
                servicioCatalogoId:
                  Number(mutData.servicioCatalogoId || mutData.servicioId) ||
                  undefined,
                vehiculoInfo: {
                  ...vInfo,
                  placa,
                  marca,
                  modelo,
                  color,
                  cliente: clienteNombre,
                },
                agenciaId:
                  mutData.agenciaId || currentUser?.agenciaId || undefined,
                regionId:
                  mutData.regionId || currentUser?.regionId || undefined,
                regionNombre: mutData.regionNombre,
                operadorId: operadoresIds[0],
                operadoresIds,
                prioridad: mutData.prioridad || 'Media',
                recetaInsumos: mutData.recetaInsumos,
                evidencias: mutData.evidencias,
                observaciones: mutData.observaciones,
              } as any,
              userId,
              currentUser,
            );
            await this.prisma.servicioEspecial.update({
              where: { id: created.id },
              data: { syncedAt: now },
            });

            await this.prisma.syncOutboxAudit.create({
              data: {
                mutationId: mut.mutationId,
                clientUuid: mut.clientUuid,
                deviceInfo: deviceId,
                entity: 'ServicioEspecial',
                action: 'CREATE',
                payload: mut as any,
                syncedAt: now,
              },
            });

            results.push({
              mutationId: mut.mutationId,
              clientUuid: mut.clientUuid,
              serverAssignedId: created.id,
              status: 'APPLIED',
              syncedAt: now.toISOString(),
            });
          } else if (action === 'UPDATE') {
            const existing = await this.prisma.servicioEspecial.findFirst({
              where: {
                OR: [
                  { clientUuid: mut.clientUuid },
                  { id: mutData.id || 'none' },
                  { codigoSE: mutData.codigoSE || 'none' },
                ],
              },
            });

            if (!existing) {
              throw new NotFoundException(
                `Servicio especial ${mut.clientUuid} no encontrado para actualizar`,
              );
            }
            if (
              rolDeUsuario(currentUser) === 'PULIDOR' &&
              existing.operadorId !== userId
            ) {
              throw new ForbiddenException(
                'Solo el primer pulidor asignado puede actualizar y completar esta orden.',
              );
            }

            const updateData: any = {
              version: existing.version + 1,
              syncedAt: now,
            };
            if (mutData.estado) updateData.estado = mutData.estado;
            // La hora de inicio se fija una sola vez (la primera que llegue: API o cola offline).
            if (mutData.fechaInicio && !existing.fechaInicio)
              updateData.fechaInicio = new Date(mutData.fechaInicio);
            if (mutData.fechaFin)
              updateData.fechaFin = new Date(mutData.fechaFin);
            if (mutData.evidencias) updateData.evidencias = mutData.evidencias;
            if (mutData.calificacionCalidad !== undefined)
              updateData.calificacionCalidad = Number(
                mutData.calificacionCalidad,
              );
            if (mutData.observaciones)
              updateData.observaciones = mutData.observaciones;

            const updated = await this.prisma.servicioEspecial.update({
              where: { id: existing.id },
              data: updateData,
            });

            if (String(updated.estado || '').toLowerCase() === 'completado') {
              try {
                await this.serviciosEspecialesService.descontarKitPulidorSiPendiente(
                  updated.id,
                );
              } catch (e: any) {
                this.logger.warn(
                  `Advertencia al descontar kit del pulidor (sync ${updated.codigoSE || updated.id}): ${e.message}`,
                );
              }
            }

            await this.prisma.syncOutboxAudit.create({
              data: {
                mutationId: mut.mutationId,
                clientUuid: mut.clientUuid,
                deviceInfo: deviceId,
                entity: 'ServicioEspecial',
                action: 'UPDATE',
                payload: mut as any,
                syncedAt: now,
              },
            });

            results.push({
              mutationId: mut.mutationId,
              clientUuid: mut.clientUuid,
              serverAssignedId: updated.id,
              status: 'APPLIED',
              syncedAt: now.toISOString(),
            });
          }
        } else {
          throw new BadRequestException(
            `Entidad de sincronización no soportada: ${mut.entity}`,
          );
        }
      } catch (err: any) {
        this.logger.error(
          `Error procesando mutación ${mut.mutationId}: ${err.message}`,
        );
        const intentos = Number(mut.attempts || mut.data?.attempts || 1);
        const isPoisonPill =
          intentos >= 5 ||
          err.message?.includes('no existe') ||
          err.message?.includes('inválido');

        if (isPoisonPill) {
          // Aislar en Dead-Letter Queue (DLQ) para que el móvil no quede bloqueado reintentando
          try {
            await this.prisma.syncDeadLetterQueue.upsert({
              where: { mutationId: mut.mutationId },
              update: { intentos: { increment: 1 }, errorMotivo: err.message },
              create: {
                mutationId: mut.mutationId,
                clientUuid: mut.clientUuid || `dlq-${Date.now()}`,
                entityType: mut.entity || 'WORK_ORDER',
                payload: mut.data || mut,
                errorMotivo: err.message,
                intentos,
                usuarioId: userId,
              },
            });
          } catch (dlqErr) {
            this.logger.error(`Error registrando en DLQ: ${dlqErr}`);
          }

          results.push({
            mutationId: mut.mutationId,
            clientUuid: mut.clientUuid,
            serverAssignedId: '',
            status: 'DEAD_LETTER',
            syncedAt: now.toISOString(),
            error: `Movido a DLQ (Superó umbral o error irrecuperable): ${err.message}`,
          });
        } else {
          results.push({
            mutationId: mut.mutationId,
            clientUuid: mut.clientUuid,
            serverAssignedId: '',
            status: 'FAILED',
            syncedAt: now.toISOString(),
            error: err.message,
          });
        }
      }
    }

    return {
      success: true,
      processed: results.length,
      results,
    };
  }

  async processPull(query: SyncPullQueryDto, userId?: string) {
    const whereClause: any = {};

    if (query.since) {
      const sinceDate = isNaN(Number(query.since))
        ? new Date(query.since)
        : new Date(Number(query.since));
      if (!isNaN(sinceDate.getTime())) {
        // Ventana de solapamiento de seguridad de 5 segundos para transacciones concurrentes
        const safeSince = new Date(sinceDate.getTime() - 5000);
        whereClause.updatedAt = { gt: safeSince };
      }
    }

    // Soporte para Pulidores Móviles y Técnicos (filtro por operadorId / asignación directa)
    const orConditions: any[] = [];
    if (query.bahiaId) {
      orConditions.push({ bahiaId: query.bahiaId });
    }
    if (query.operadorId) {
      orConditions.push({ operadorId: query.operadorId });
    }
    if (orConditions.length > 0) {
      whereClause.OR = orConditions;
    }

    // Scoping por permisos y alcance: solo quien puede ver servicios (servicios.ver) recibe algo; el resto
    // (bodega, mantenimiento, técnico — el plan dice explícitamente que no ven OT) se queda sin resultados.
    let esAdminOSuperAdmin = false;
    let ocultarContactoOperador = true;
    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { role: true },
      });

      if (!user || !tienePermiso(user, 'servicios.ver')) {
        Object.assign(whereClause, SIN_RESULTADOS);
      } else {
        const alcance = resolverAlcance(user);
        switch (alcance.tipo) {
          case 'GLOBAL':
            break;
          case 'REGION':
            whereClause.bahia = { agencia: { regionId: alcance.regionId } };
            break;
          case 'AGENCIA':
            whereClause.bahia = { agenciaId: alcance.agenciaId };
            break;
          case 'PROPIO':
            whereClause.operadorId = alcance.userId;
            break;
          default:
            Object.assign(whereClause, SIN_RESULTADOS);
        }
        const rol = rolDeUsuario(user);
        esAdminOSuperAdmin = rol === 'SUPER_ADMIN' || rol === 'ADMIN';
        ocultarContactoOperador = !esAdminOSuperAdmin;
      }
    }

    const limit = Math.min(
      200,
      Math.max(1, Number(query.limit || query.pageSize || 50)),
    );

    // Cursor Pagination & DataGrid Pagination
    const findArgs: any = {
      where: whereClause,
      include: {
        bahia: { include: { agencia: true } },
        catalogo: true,
        // Quien no es administrador nunca recibe el correo de otro usuario (D9).
        operador: {
          select: {
            id: true,
            name: true,
            lastname: true,
            email: !ocultarContactoOperador,
          },
        },
        consumos: { include: { insumo: true } },
        evidencias: true,
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    };

    if (query.cursor) {
      findArgs.cursor = { id: query.cursor };
      findArgs.skip = 1;
    }

    const [serviciosConExtra, total] = await Promise.all([
      this.prisma.servicioLavado.findMany(findArgs),
      this.prisma.servicioLavado.count({ where: whereClause }),
    ]);

    const hasMore = serviciosConExtra.length > limit;
    const servicios = hasMore
      ? serviciosConExtra.slice(0, limit)
      : serviciosConExtra;
    const nextCursor =
      hasMore && servicios.length > 0
        ? servicios[servicios.length - 1].id
        : null;
    const page = query.page ? Number(query.page) : 1;
    const totalPages = Math.ceil(total / limit) || 1;

    const mappedServicios = servicios.map(serializeServicioLavado);

    return {
      serverTime: new Date().toISOString(),
      count: servicios.length,
      total,
      limit,
      nextCursor,
      hasMore,
      // Metadata estándar DataGrid para Frontends Web
      page,
      pageSize: limit,
      totalPages,
      hasNextPage: hasMore,
      hasPrevPage: page > 1,
      items: mappedServicios,
      servicios: mappedServicios,
    };
  }

  async getBootstrapData(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: { select: { id: true, namerol: true, capacidades: true } },
        agencia: {
          select: {
            id: true,
            codigo: true,
            nombre: true,
            region: true,
            bahias: {
              where: { activa: true },
              select: { id: true, codigo: true, nombre: true, activa: true },
            },
          },
        },
        region: { select: { id: true, codigo: true, nombre: true } },
      },
    });

    const catalogos = await this.prisma.catalogoServicio.findMany({
      include: {
        recetas: {
          include: {
            insumo: { select: { id: true, codigoSKU: true, nombre: true } },
            unidadConsumo: {
              select: {
                id: true,
                codigo: true,
                nombre: true,
                simbolo: true,
                factorBase: true,
              },
            },
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    const insumos = await this.prisma.insumo.findMany({
      where: { estado: 1 },
      select: {
        id: true,
        codigoSKU: true,
        nombre: true,
        categoria: true,
        unidadMedida: {
          select: { id: true, codigo: true, nombre: true, simbolo: true },
        },
      },
      orderBy: { nombre: 'asc' },
    });

    // Bahías: si el usuario tiene agencia, las de su agencia; sino todas las activas
    const bahias = user?.agencia?.bahias?.length
      ? user.agencia.bahias
      : await this.prisma.bahia.findMany({
          where: { activa: true },
          select: {
            id: true,
            codigo: true,
            nombre: true,
            activa: true,
            agenciaId: true,
          },
        });

    return {
      serverTime: new Date().toISOString(),
      syncToken: new Date().toISOString(),
      user: {
        id: user?.id,
        email: user?.email,
        nombre: `${user?.name} ${user?.lastname}`.trim(),
        role: user?.role?.namerol,
        permisos: modulosDeRol(user?.role),
        agenciaId: user?.agenciaId,
        agenciaNombre: user?.agencia?.nombre,
        regionId: user?.regionId,
        regionNombre: user?.region?.nombre,
      },
      catalogos: catalogos.map((c) => ({
        id: c.id,
        codigo: c.codigo,
        nombre: c.nombre,
        categoria: c.categoria,
        precio: Number(c.precio),
        tiempoEstimadoMin: c.tiempoEstimadoMin,
        recetas: c.recetas.map((r) => ({
          insumoId: r.insumoId,
          insumoNombre: r.insumo.nombre,
          productoSKU: r.insumo.codigoSKU,
          cantidad: Number(r.cantidadUsada),
          cantidadSugerida:
            Number(r.cantidadUsada) *
            (Number(r.unidadConsumo?.factorBase) || 1),
          unidad: r.unidadConsumo.codigo,
          esOpcional: r.esOpcional,
        })),
      })),
      bahias,
      insumos,
    };
  }

  async generateMediaUploadTicket(body: {
    clientUuid: string;
    userId?: string;
    type: string;
    fileName?: string;
    agenciaId?: string;
    servicioId?: string;
    category?: any;
    maquinariaId?: string;
    maquinariaNombre?: string;
    maquinariaCodigo?: string;
    incidenteId?: string;
    incidenteFase?: 'fallas' | 'resoluciones';
    mantenimientoId?: string;
    contentType?: string;
  }) {
    let agenciaId = body.agenciaId;
    let servicioId = body.servicioId;
    let maquinariaId = body.maquinariaId;
    let maquinariaNombre = body.maquinariaNombre;
    let maquinariaCodigo = body.maquinariaCodigo;
    let incidenteId = body.incidenteId;
    if (
      body.category === 'MAQUINARIA_INCIDENTE' &&
      (body.incidenteId || body.clientUuid)
    ) {
      const incidentReference = body.incidenteId || body.clientUuid;
      const incident = await this.prisma.incidenteTecnico.findFirst({
        where: {
          OR: [{ id: incidentReference }, { clientUuid: incidentReference }],
        },
        select: {
          id: true,
          maquinariaId: true,
          maquinaria: {
            select: { agenciaId: true, codigo: true, nombre: true },
          },
        },
      });
      if (incident) {
        incidenteId = incident.id;
        maquinariaId = incident.maquinariaId;
        agenciaId = incident.maquinaria?.agenciaId || agenciaId;
        maquinariaCodigo = incident.maquinaria?.codigo || maquinariaCodigo;
        maquinariaNombre = incident.maquinaria?.nombre || maquinariaNombre;
      }
    }
    if (body.clientUuid) {
      const service = await this.prisma.servicioLavado.findFirst({
        where: {
          OR: [{ clientUuid: body.clientUuid }, { id: body.clientUuid }],
        },
        select: {
          ordenTrabajoOT: true,
          bahia: { select: { agenciaId: true } },
        },
      });
      if (service) {
        if (!agenciaId && service.bahia?.agenciaId) {
          agenciaId = service.bahia.agenciaId;
        }
        if (
          !servicioId &&
          (body.category === 'SERVICIOS_GENERALES' || !body.category)
        ) {
          servicioId = service.ordenTrabajoOT || servicioId;
        }
      }
    }

    if (body.category === 'SERVICIOS_ESPECIALES' && body.clientUuid) {
      const specialService = await this.prisma.servicioEspecial.findFirst({
        where: {
          OR: [
            { id: body.clientUuid },
            { clientUuid: body.clientUuid },
            { codigoSE: body.clientUuid },
            { ordenTrabajoOT: body.clientUuid },
          ],
        },
        select: {
          id: true,
          clientUuid: true,
          codigoSE: true,
          ordenTrabajoOT: true,
          agenciaId: true,
        },
      });
      if (specialService) {
        agenciaId = specialService.agenciaId || agenciaId;
        servicioId =
          specialService.ordenTrabajoOT ||
          specialService.codigoSE ||
          specialService.id;
      }
    }

    return this.storageService.generateUploadTicket({
      clientUuid: body.clientUuid,
      userId: body.userId,
      type: body.type as MediaEvidenceType,
      fileName: body.fileName,
      agenciaId,
      servicioId,
      category: body.category,
      maquinariaId,
      maquinariaNombre,
      maquinariaCodigo,
      incidenteId,
      incidenteFase: body.incidenteFase,
      mantenimientoId: body.mantenimientoId,
      contentType: body.contentType,
    });
  }

  async registerPushToken(dto: RegisterPushTokenDto, userId: string) {
    const updated = await this.prisma.syncDevice.upsert({
      where: { deviceId: dto.deviceId },
      update: {
        pushToken: dto.pushToken,
        userId,
        appVersion: dto.appVersion,
        platform: dto.platform,
        lastSyncAt: new Date(),
      },
      create: {
        deviceId: dto.deviceId,
        pushToken: dto.pushToken,
        userId,
        appVersion: dto.appVersion || '1.0.0',
        platform: dto.platform || 'react-native',
        lastSyncAt: new Date(),
      },
    });

    return {
      success: true,
      deviceId: updated.deviceId,
      pushTokenRegistered: !!updated.pushToken,
    };
  }

  async confirmMediaUpload(
    body: {
      clientUuid: string;
      type: string;
      fileUrl: string;
      descripcion?: string;
      metadata?: any;
      category?: string;
      maquinariaId?: string;
      incidenteId?: string;
      servicioId?: string;
      specialAction?: 'START' | 'PAUSE' | 'RESUME' | 'FINISH';
      specialOperatorId?: string;
      pauseReason?: string;
      resumeNotes?: string;
      capturedAt?: string;
    },
    currentUser?: any,
  ) {
    if (!this.storageService.isManagedPublicUrl(body.fileUrl)) {
      throw new BadRequestException(
        'La evidencia debe corresponder a un archivo subido por EasyDry al bucket configurado.',
      );
    }

    // Fotos: se genera en segundo plano la miniatura liviana para los listados.
    if (String(body.type || '').startsWith('FOTO_')) {
      void this.storageService.generarMiniaturaDesdeUrl(body.fileUrl);
    }

    const specialServiceKey = body.servicioId || body.clientUuid;
    if (
      body.category === 'SERVICIOS_ESPECIALES' &&
      body.specialAction === 'START'
    ) {
      const updated = await this.serviciosEspecialesService.iniciar(
        {
          id: specialServiceKey,
          operadorId: body.specialOperatorId,
          videoInicialUrl: body.fileUrl,
        },
        currentUser,
      );
      return { success: true, action: 'START', ...body, service: updated };
    }

    if (
      body.category === 'SERVICIOS_ESPECIALES' &&
      body.specialAction === 'PAUSE'
    ) {
      if (!body.pauseReason?.trim()) {
        throw new BadRequestException('El motivo de la pausa es obligatorio.');
      }
      const updated = await this.serviciosEspecialesService.adjuntarVideoCiclo(
        'PAUSA',
        {
          id: specialServiceKey,
          url: body.fileUrl,
          motivo: body.pauseReason.trim(),
          capturadoEn: body.capturedAt,
        },
        currentUser,
      );
      return { success: true, action: 'PAUSE', ...body, service: updated };
    }

    if (
      body.category === 'SERVICIOS_ESPECIALES' &&
      body.specialAction === 'RESUME'
    ) {
      const updated = await this.serviciosEspecialesService.adjuntarVideoCiclo(
        'REANUDACION',
        {
          id: specialServiceKey,
          url: body.fileUrl,
          observaciones: body.resumeNotes,
          capturadoEn: body.capturedAt,
        },
        currentUser,
      );
      return { success: true, action: 'RESUME', ...body, service: updated };
    }

    if (
      body.category === 'SERVICIOS_ESPECIALES' &&
      body.specialAction === 'FINISH'
    ) {
      const updated = await this.serviciosEspecialesService.completar(
        {
          id: specialServiceKey,
          videoFinalUrl: body.fileUrl,
          observaciones: body.resumeNotes,
        },
        currentUser,
      );
      return { success: true, action: 'FINISH', ...body, service: updated };
    }

    if (body.category === 'MAQUINARIA_INCIDENTE') {
      const incidenteId = body.incidenteId || body.clientUuid;
      const incidente = await this.prisma.incidenteTecnico.findFirst({
        where: { OR: [{ id: incidenteId }, { clientUuid: incidenteId }] },
      });
      if (!incidente) {
        throw new BadRequestException(
          `No se encontró el incidente con id: ${incidenteId}`,
        );
      }
      const resolvedIncidentId = incidente.id;
      const existing = await this.prisma.evidenciaIncidente.findFirst({
        where: {
          incidenteId: resolvedIncidentId,
          tipo: body.type,
          url: body.fileUrl,
        },
      });
      if (existing)
        return {
          success: true,
          status: 'ALREADY_EXISTS',
          evidenciaId: existing.id,
          ...body,
        };

      const evidencia = await this.prisma.evidenciaIncidente.create({
        data: {
          incidenteId: resolvedIncidentId,
          tipo: body.type,
          url: body.fileUrl,
          descripcion: body.descripcion,
          metadata: body.metadata,
        },
      });
      if (body.type === 'FOTO_INCIDENTE' && !incidente.fotoEvidenciaUrl) {
        await this.prisma.incidenteTecnico.update({
          where: { id: resolvedIncidentId },
          data: { fotoEvidenciaUrl: body.fileUrl },
        });
      }
      return {
        success: true,
        incidenteId: resolvedIncidentId,
        evidenciaId: evidencia.id,
        type: body.type,
        fileUrl: body.fileUrl,
      };
    }

    const service = await this.prisma.servicioLavado.findFirst({
      where: {
        OR: [{ clientUuid: body.clientUuid }, { id: body.clientUuid }],
      },
      include: { evidencias: true },
    });

    if (!service) {
      throw new BadRequestException(
        `No se encontró el servicio con clientUuid: ${body.clientUuid}`,
      );
    }

    // Idempotencia Zero-Trust: Si la foto ya está vinculada en evidencias o en columnas principales
    const yaVinculadaEnEvidencias = service.evidencias?.some(
      (e) => e.url === body.fileUrl && e.tipo === body.type,
    );
    const yaVinculadaEnColumnas =
      (body.type === 'FOTO_INGRESO' &&
        service.fotoIngresoUrl === body.fileUrl) ||
      (body.type === 'FOTO_SALIDA' && service.fotoSalidaUrl === body.fileUrl) ||
      (['VIDEO_INICIAL', 'VIDEO_INGRESO'].includes(body.type) &&
        service.videoInicialUrl === body.fileUrl) ||
      (['VIDEO_FINAL', 'VIDEO_SALIDA'].includes(body.type) &&
        service.videoFinalUrl === body.fileUrl);

    if (yaVinculadaEnEvidencias || yaVinculadaEnColumnas) {
      return {
        success: true,
        status: 'ALREADY_EXISTS',
        serviceId: service.id,
        clientUuid: service.clientUuid,
        type: body.type,
        fileUrl: body.fileUrl,
        updatedAt: service.updatedAt,
      };
    }

    const dataToUpdate: any = {};
    if (['FOTO_INGRESO', 'INGRESO'].includes(body.type)) {
      dataToUpdate.fotoIngresoUrl = body.fileUrl;
    } else if (['FOTO_SALIDA', 'SALIDA'].includes(body.type)) {
      dataToUpdate.fotoSalidaUrl = body.fileUrl;
    } else if (['VIDEO_INICIAL', 'VIDEO_INGRESO'].includes(body.type)) {
      dataToUpdate.videoInicialUrl = body.fileUrl;
    } else if (['VIDEO_FINAL', 'VIDEO_SALIDA'].includes(body.type)) {
      dataToUpdate.videoFinalUrl = body.fileUrl;
    }

    const updated = await this.prisma.servicioLavado.update({
      where: { id: service.id },
      data: dataToUpdate,
    });

    // La evidencia de ingreso es del vehículo: se comparte con los demás servicios de la misma OT.
    const columnaIngreso = dataToUpdate.videoInicialUrl
      ? 'videoInicialUrl'
      : dataToUpdate.fotoIngresoUrl
        ? 'fotoIngresoUrl'
        : null;
    if (columnaIngreso && service.ordenTrabajoOT) {
      await this.prisma.servicioLavado.updateMany({
        where: {
          id: { not: service.id },
          ordenTrabajoOT: {
            equals: service.ordenTrabajoOT,
            mode: 'insensitive',
          },
          placa: service.placa,
          deletedAt: null,
          [columnaIngreso]: null,
        },
        data: { [columnaIngreso]: body.fileUrl },
      });
    }

    // Guardar en colección 1-a-N EvidenciaServicio para inspección completa
    const evidencia = await this.prisma.evidenciaServicio.create({
      data: {
        servicioId: service.id,
        tipo: body.type,
        url: body.fileUrl,
        descripcion: body.descripcion || undefined,
        metadata: body.metadata || undefined,
      },
    });

    await this.prisma.syncOutboxAudit.create({
      data: {
        clientUuid: service.clientUuid,
        entity: 'ServicioLavado',
        action: `MEDIA_UPLOAD_CONFIRM_${body.type}`,
        payload: { ...body, evidenciaId: evidencia.id } as any,
        syncedAt: new Date(),
      },
    });

    return {
      success: true,
      serviceId: updated.id,
      clientUuid: updated.clientUuid,
      evidenciaId: evidencia.id,
      type: body.type,
      fileUrl: body.fileUrl,
      updatedAt: updated.updatedAt,
    };
  }

  async listDeadLetterQueue(resuelto?: boolean, user?: any) {
    const where: any = {};
    if (resuelto !== undefined) {
      where.resuelto = resuelto;
    }
    // Quien no gestiona la cola (sync.dlq.gestionar) solo ve los errores de su propia sincronización.
    if (!user || !tienePermiso(user, 'sync.dlq.gestionar')) {
      where.usuarioId = user?.id ? String(user.id) : '__ninguno__';
    }
    const items = await this.prisma.syncDeadLetterQueue.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return {
      count: items.length,
      items,
    };
  }

  async resolveDeadLetterItem(
    id: string,
    resuelto: boolean = true,
    actor?: any,
  ) {
    const item = await this.prisma.syncDeadLetterQueue.findUnique({
      where: { id },
    });

    if (!item) {
      throw new BadRequestException(`Registro DLQ ${id} no encontrado`);
    }

    const updated = await this.prisma.syncDeadLetterQueue.update({
      where: { id },
      data: { resuelto },
    });
    await this.registrarDecisionDlq(actor, id, 'RESOLVER', { resuelto });

    return {
      success: true,
      id: updated.id,
      resuelto: updated.resuelto,
    };
  }

  // Punto 3: Replay y Reingreso de Mutaciones en Dead-Letter Queue (/sync/dlq/replay)
  /** Deja registrado quién resolvió o reintentó un error de sincronización. */
  private async registrarDecisionDlq(
    actor: any,
    dlqId: string,
    accion: 'RESOLVER' | 'REINTENTAR',
    detalle: Record<string, unknown>,
  ) {
    if (!actor?.id) return;
    await this.prisma.auditoriaDecision.create({
      data: {
        entidad: 'SYNC_DLQ',
        entidadId: dlqId,
        accion,
        usuarioId: String(actor.id),
        usuarioNombre:
          [actor.name, actor.lastname].filter(Boolean).join(' ').trim() ||
          actor.email ||
          'Usuario',
        rol: rolDeUsuario(actor),
        regla: 'ADMIN',
        detalle: detalle as any,
      },
    });
  }

  async replayDeadLetterItem(
    dlqId: string,
    payloadCorregido?: any,
    userId?: string,
    actor?: any,
  ) {
    const item = await this.prisma.syncDeadLetterQueue.findUnique({
      where: { id: dlqId },
    });

    if (!item) {
      throw new BadRequestException(`Registro DLQ ${dlqId} no encontrado`);
    }

    // Combinar payload original con correcciones del administrador
    const originalPayload =
      typeof item.payload === 'object' && item.payload !== null
        ? (item.payload as any)
        : {};
    const mergedData = payloadCorregido
      ? { ...originalPayload, ...payloadCorregido }
      : originalPayload;

    const mutationToReplay = {
      mutationId: `replay_${item.mutationId}_${Date.now()}`,
      clientUuid: item.clientUuid,
      entity: item.entityType || 'servicio_lavado',
      action: mergedData?.action || 'CREATE',
      timestamp: Date.now(),
      data: mergedData,
    };

    const pushResult = await this.processPush(
      {
        deviceId: 'dlq-replay-admin',
        mutations: [mutationToReplay],
      },
      userId || 'admin',
    );

    const firstResult = pushResult.results?.[0];
    if (
      firstResult &&
      (firstResult.status === 'APPLIED' ||
        firstResult.status === 'ALREADY_EXISTS')
    ) {
      const updated = await this.prisma.syncDeadLetterQueue.update({
        where: { id: dlqId },
        data: {
          resuelto: true,
          intentos: { increment: 1 },
          payload: mergedData as any,
        },
      });

      await this.prisma.syncOutboxAudit.create({
        data: {
          clientUuid: item.clientUuid,
          deviceInfo: 'dlq-replay-admin',
          entity: item.entityType || 'ServicioLavado',
          action: 'DLQ_REPLAY_SUCCESS',
          payload: {
            dlqId,
            originalMutationId: item.mutationId,
            replayedMutationId: mutationToReplay.mutationId,
            serverAssignedId: firstResult.serverAssignedId,
            payloadCorregido,
          } as any,
          syncedAt: new Date(),
        },
      });

      await this.registrarDecisionDlq(actor, dlqId, 'REINTENTAR', {
        payloadCorregido: !!payloadCorregido,
      });
      return {
        success: true,
        replayed: true,
        dlqId: updated.id,
        resuelto: true,
        mutationResult: firstResult,
      };
    } else {
      const errorMsg = firstResult?.error || 'Replay fallido sin detalle';
      await this.prisma.syncDeadLetterQueue.update({
        where: { id: dlqId },
        data: {
          intentos: { increment: 1 },
          errorMotivo: `Replay fallido: ${errorMsg}`,
          payload: mergedData as any,
        },
      });

      throw new BadRequestException(
        `No se pudo reaplicar la mutación de DLQ: ${errorMsg}`,
      );
    }
  }

  /**
   * Blindaje 1: Fast-Probe Heartbeat (< 10ms)
   * Permite a la app móvil sondear conectividad real (evitar Lie-Fi / falso Wi-Fi cautivo)
   * y obtener el tiempo exacto del servidor para calibrar el reloj (Clock Skew).
   */
  async ping() {
    const now = new Date();
    return {
      ok: true,
      serverTime: now.toISOString(),
      timestamp: now.getTime(),
      version: '2.0.0-enterprise',
      environment: process.env.NODE_ENV || 'development',
    };
  }

  /**
   * Blindaje 4: Reconciliador de Evidencias Multimedia Desacopladas
   * Permite a la app móvil consultar el estado de evidencias de un lote de clientUuids
   * para re-confirmar URLs o reintentar subidas pendientes sin reenviar la orden completa.
   */
  async getPendingMedia(clientUuids: string[]) {
    if (!Array.isArray(clientUuids) || clientUuids.length === 0) {
      return { pending: [] };
    }

    const servicios = await this.prisma.servicioLavado.findMany({
      where: {
        clientUuid: { in: clientUuids },
        deletedAt: null,
      },
      select: {
        id: true,
        clientUuid: true,
        estado: true,
        fotoIngresoUrl: true,
        fotoSalidaUrl: true,
      },
    });

    const pending = servicios
      .map((s) => {
        const missingIngreso = !s.fotoIngresoUrl;
        const missingSalida =
          s.estado === ServiceStatus.FINALIZADO && !s.fotoSalidaUrl;
        if (!missingIngreso && !missingSalida) return null;
        return {
          clientUuid: s.clientUuid,
          serverAssignedId: s.id,
          estado: s.estado,
          missingFotoIngreso: missingIngreso,
          missingFotoSalida: missingSalida,
        };
      })
      .filter(Boolean);

    return {
      totalConsultados: clientUuids.length,
      totalPendientes: pending.length,
      pending,
    };
  }
}
