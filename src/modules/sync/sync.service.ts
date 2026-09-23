import { Injectable, Logger, BadRequestException, NotFoundException, Optional } from '@nestjs/common';
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

export interface SyncMutationResult {
  mutationId: string;
  clientUuid: string;
  serverAssignedId: string;
  status: 'APPLIED' | 'ALREADY_EXISTS' | 'FAILED';
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
          },
        });
        results.push({
          mutationId: mut.mutationId,
          clientUuid: mut.clientUuid,
          serverAssignedId: '',
          status: 'FAILED',
          error: 'OPERADOR_INACTIVO_RESCATE: Mutación resguardada en Dead-Letter Queue para aprobación gerencial.',
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
          ? await this.prisma.syncOutboxAudit.findFirst({ where: { mutationId: mut.mutationId } })
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
          entity === 'servicio_lavado' ||
          entity === 'work_order';

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
              const b = await this.prisma.bahia.findUnique({ where: { id: bahiaId } });
              const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(currentUser?.role?.namerol || '');
              if (!b || (!isAdmin && currentUser?.agenciaId && b.agenciaId !== currentUser.agenciaId)) bahiaId = null;
            }
            if (!bahiaId) {
              bahiaId = currentUser?.agencia?.bahias?.[0]?.id;
            }
            if (!bahiaId) {
              throw new BadRequestException('El operador no tiene una bahía activa disponible.');
            }

            let servicioCatalogoId = Number(mut.data?.servicioCatalogoId || mut.data?.serviceId);
            let catalogo = servicioCatalogoId
              ? await this.prisma.catalogoServicio.findUnique({ where: { id: servicioCatalogoId } })
              : null;
            if (!catalogo && (mut.data?.servicio || mut.data?.tipoLavado)) {
              const nombre = String(mut.data.servicio || mut.data.tipoLavado).split(' + ')[0].trim();
              catalogo = await this.prisma.catalogoServicio.findFirst({
                where: { OR: [{ nombre: { equals: nombre, mode: 'insensitive' } }, { codigo: { equals: nombre, mode: 'insensitive' } }] },
              });
              servicioCatalogoId = catalogo?.id || 0;
            }
            if (!catalogo) {
              throw new BadRequestException('No se pudo resolver el servicio en el catálogo offline.');
            }

            const placa = String(mut.data?.placa || mut.data?.vehiclePlate || '').toUpperCase().trim();
            if (!placa) {
              throw new BadRequestException('La placa del vehículo es obligatoria.');
            }
            const modelo = String(mut.data?.modelo || mut.data?.vehicleModel || '').trim();

            // Blindaje Huella Operativa: Detección de vehículo ya activo en la misma agencia (Ventana 4 horas)
            const cuatroHorasAtras = new Date(now.getTime() - 4 * 60 * 60 * 1000);
            const bahiaObj = bahiaId
              ? await this.prisma.bahia.findUnique({ where: { id: bahiaId }, select: { agenciaId: true } })
              : null;
            const targetAgenciaId = bahiaObj?.agenciaId || currentUser?.agenciaId || currentUser?.agencia?.id;

            const duplicateActive = await this.prisma.servicioLavado.findFirst({
              where: {
                placa,
                bahia: targetAgenciaId ? { agenciaId: targetAgenciaId } : undefined,
                estado: { in: [ServiceStatus.EN_ESPERA, ServiceStatus.EN_PROCESO] },
                horaIngreso: { gte: cuatroHorasAtras },
                deletedAt: null,
                NOT: { clientUuid: mut.clientUuid },
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
                },
              });

              results.push({
                mutationId: mut.mutationId,
                clientUuid: mut.clientUuid,
                serverAssignedId: duplicateActive.id,
                status: 'FAILED',
                error: `POSIBLE_DUPLICADO_PLACA: Ya existe la orden activa ${duplicateActive.id} para el vehículo ${placa}`,
                syncedAt: now.toISOString(),
              });
              continue;
            }

            const estadoFinal: ServiceStatus =
              mut.data?.estado === 'FINALIZADO' || mut.data?.status === 'COMPLETED'
                ? ServiceStatus.FINALIZADO
                : mut.data?.estado === 'EN_PROCESO' || mut.data?.status === 'IN_PROGRESS'
                ? ServiceStatus.EN_PROCESO
                : ServiceStatus.EN_ESPERA;

            // Si se crea directamente como finalizado, inicializar en proceso para gatillar
            // el descuento de insumos de forma transaccional mediante el hook oficial
            const estadoInicial =
              estadoFinal === ServiceStatus.FINALIZADO ? ServiceStatus.EN_PROCESO : estadoFinal;

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

            let nuevoServicio: any;
            try {
              nuevoServicio = await this.prisma.servicioLavado.create({
                data: {
                  clientUuid: mut.clientUuid,
                  ordenTrabajoOT: String(mut.data?.ordenTrabajoOT || mut.data?.numeroOrden || '').trim() || undefined,
                  placa,
                  marca: mut.data?.marca?.trim() || undefined,
                  modelo,
                  color: mut.data?.color?.trim(),
                  cliente: mut.data?.cliente?.trim() || mut.data?.clientName?.trim(),
                  estado: estadoInicial,
                  bahiaId,
                  servicioCatalogoId,
                  operadorId: String(mut.data?.operadorId || userId),
                  horaIngreso: sanitizedHoraIngreso,
                  horaSalida: estadoFinal === ServiceStatus.FINALIZADO ? now : null,
                  fotoIngresoUrl: mut.data?.fotoIngresoUrl || mut.data?.evidenceInLocalUri,
                  fotoSalidaUrl: mut.data?.fotoSalidaUrl || mut.data?.evidenceOutLocalUri,
                  observaciones: mut.data?.observaciones || mut.data?.notes,
                  syncedAt: now,
                },
              });
            } catch (createErr: any) {
              // Blindaje 3: Neutralizar carreras concurrentes ("Double-Tap" / dos peticiones simultáneas)
              if (createErr?.code === 'P2002') {
                const raceExisting = await this.prisma.servicioLavado.findUnique({
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

            // Si se creó directamente como finalizado, invocar hook oficial de descuento de insumos con No-Block Policy
            if (estadoFinal === ServiceStatus.FINALIZADO) {
              try {
                await this.operacionesService.update(nuevoServicio.id, {
                  id: nuevoServicio.id,
                  estado: ServiceStatus.FINALIZADO,
                  fotoSalidaUrl: mut.data?.fotoSalidaUrl || mut.data?.evidenceOutLocalUri,
                  observaciones: mut.data?.observaciones || mut.data?.notes,
                }, true); // isOfflineSync = true
              } catch (e: any) {
                this.logger.warn(`Advertencia al descontar insumos de orden offline: ${e.message}`);
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
            const existing = await this.prisma.servicioLavado.findFirst({
              where: {
                OR: [{ clientUuid: mut.clientUuid }, { id: mut.data?.id || mut.clientUuid }],
              },
            });

            if (!existing) {
              throw new BadRequestException(`Servicio ${mut.clientUuid} no encontrado para actualización`);
            }

            // Matriz de Resolución de Conflictos y Falla Asumida (Zero-Trust):
            // 1. Si ya estaba FINALIZADO en servidor y llega un reintento de COMPLETE
            // (porque el 200 OK previo se perdió en el aire):
            if (
              existing.estado === ServiceStatus.FINALIZADO &&
              (action === 'COMPLETE' || mut.data?.estado === 'FINALIZADO' || mut.data?.status === 'COMPLETED')
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
              (existing.estado === ServiceStatus.CANCELADO || existing.deletedAt) &&
              (action === 'COMPLETE' || mut.data?.estado === 'FINALIZADO' || mut.data?.status === 'COMPLETED')
            ) {
              overrideWarning = 'Revertida cancelación o eliminación previa: prevaleció finalización física en campo.';
              this.logger.warn(`[ConflictResolution] ${overrideWarning} (Servicio: ${existing.id})`);
            }

            // Punto 6: Control de Versiones Optimista (OCC) y Merge Inteligente
            const incomingVersion = Number(mut.data?.version || 1);
            let observacionesFinales = mut.data?.observaciones || mut.data?.notes || existing.observaciones;
            let isOccMerged = false;

            if (existing.version > incomingVersion) {
              // Conflicto detectado: un usuario web editó la orden mientras el móvil estuvo sin internet
              isOccMerged = true;
              const mobileNotes = mut.data?.observaciones || mut.data?.notes;
              if (mobileNotes && existing.observaciones && mobileNotes !== existing.observaciones) {
                observacionesFinales = `${existing.observaciones} | [Móvil]: ${mobileNotes}`.trim();
              }
              this.logger.log(
                `[OCC] Conflicto version detectado en ${existing.id} (servidor: v${existing.version} > móvil: v${incomingVersion}). Merge inteligente aplicado preservando notas web y registrando campo.`,
              );
            }

            let estadoNuevo =
              action === 'COMPLETE' || mut.data?.estado === 'FINALIZADO' || mut.data?.status === 'COMPLETED'
                ? ServiceStatus.FINALIZADO
                : mut.data?.estado || existing.estado;

            // Blindaje 2: Máquina de estados irreversible contra entregas desordenadas (Out-of-Order Packet Delivery)
            // Secuencia de vida estricta: EN_ESPERA -> EN_PROCESO -> FINALIZADO -> APROBADO
            if (existing.estado === ServiceStatus.APROBADO && estadoNuevo !== ServiceStatus.APROBADO) {
              this.logger.warn(
                `[SyncStateGuard] Orden ${existing.id} ya fue APROBADA gerencialmente. Se descarta regresión a ${estadoNuevo}.`,
              );
              estadoNuevo = ServiceStatus.APROBADO;
            } else if (
              existing.estado === ServiceStatus.FINALIZADO &&
              (estadoNuevo === ServiceStatus.EN_PROCESO || estadoNuevo === ServiceStatus.EN_ESPERA)
            ) {
              this.logger.warn(
                `[SyncStateGuard] Orden ${existing.id} ya está FINALIZADA. Se descarta paquete retrasado que solicita ${estadoNuevo}.`,
              );
              estadoNuevo = ServiceStatus.FINALIZADO;
            }


            const updated = await this.operacionesService.update(existing.id, {
              id: existing.id,
              estado: estadoNuevo,
              fotoSalidaUrl: mut.data?.fotoSalidaUrl || mut.data?.evidenceOutLocalUri || existing.fotoSalidaUrl,
              observaciones: observacionesFinales,
            }, true); // isOfflineSync = true

            // Si el servicio estaba con soft-delete previo, restaurar deletedAt = null
            if (existing.deletedAt && (action === 'COMPLETE' || mut.data?.estado === 'FINALIZADO')) {
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
                payload: { ...(mut as any), conflictNote: overrideWarning, isOccMerged },
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
          const mutData = mut.data || {};
          const incidentAction = String(mut.action || 'CREATE').toUpperCase();
          const existingIncident = await this.prisma.incidenteTecnico.findFirst({
            where: { clientUuid: mut.clientUuid },
          });
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
          if (incidentAction === 'UPDATE') {
            const incidentToUpdate = existingIncident || await this.prisma.incidenteTecnico.findFirst({
              where: { OR: [{ id: String(mutData.id || '') }, { clientUuid: mut.clientUuid }] },
            });
            if (!incidentToUpdate) {
              throw new NotFoundException(`Incidente ${mut.clientUuid} no encontrado para actualizar`);
            }
            const updatedIncident = await this.prisma.incidenteTecnico.update({
              where: { id: incidentToUpdate.id },
              data: {
                estado: mutData.estado || incidentToUpdate.estado,
                solucion: mutData.solucion || mutData.diagnostico || incidentToUpdate.solucion,
                fechaSolucion: mutData.fechaSolucion ? new Date(mutData.fechaSolucion) : incidentToUpdate.fechaSolucion,
                resueltoPorId: mutData.estado === 'RESUELTO' ? userId : incidentToUpdate.resueltoPorId,
              },
            });
            await this.prisma.syncOutboxAudit.create({
              data: {
                mutationId: mut.mutationId,
                clientUuid: mut.clientUuid,
                deviceInfo: deviceId,
                entity: 'IncidenteTecnico',
                action: 'UPDATE',
                payload: mut as any,
                syncedAt: now,
              },
            });
            results.push({
              mutationId: mut.mutationId,
              clientUuid: mut.clientUuid,
              serverAssignedId: updatedIncident.id,
              status: 'APPLIED',
              syncedAt: now.toISOString(),
            });
            continue;
          }
          let maquinariaId = mutData.maquinariaId;
          if (maquinariaId) {
            const maquinariaPorId = await this.prisma.maquinaria.findUnique({ where: { id: String(maquinariaId) } });
            maquinariaId = maquinariaPorId?.id;
          }
          if (!maquinariaId && mutData.maquinariaCodigo) {
            const maq = await this.prisma.maquinaria.findUnique({
              where: { codigo: mutData.maquinariaCodigo },
            });
            if (maq) maquinariaId = maq.id;
          }
          if (!maquinariaId) {
            const primeraMaq = await this.prisma.maquinaria.findFirst();
            maquinariaId = primeraMaq?.id;
          }
          if (!maquinariaId) {
            throw new BadRequestException('No existe maquinaria registrada para vincular el incidente técnico.');
          }

          const gravedad = mutData.gravedad || 'MEDIA';
          if (gravedad === 'ALTA' || gravedad === 'CRITICA') {
            await this.prisma.maquinaria.update({
              where: { id: maquinariaId },
              data: { estadoOperativo: 'EN_MANTENIMIENTO' },
            });
          }

          const inc = await this.prisma.incidenteTecnico.create({
            data: {
              clientUuid: mut.clientUuid,
              maquinariaId,
              reportadoPorId: userId,
              titulo: mutData.titulo || 'Incidente reportado desde App Móvil',
              descripcion: mutData.descripcion || 'Reporte de incidente técnico en campo',
              gravedad,
              estado: 'ABIERTO',
              fotoEvidenciaUrl: mutData.fotoEvidenciaUrl || mutData.fileUrl || undefined,
            },
          });

          if (gravedad === 'ALTA' || gravedad === 'CRITICA') {
            await this.notifications?.notificarIncidenteCritico({
              incidenteId: inc.id,
              titulo: inc.titulo,
              gravedad,
              maquinariaCodigo: mutData.maquinariaCodigo || 'Equipo Taller',
            });
          }

          await this.prisma.syncOutboxAudit.create({
            data: {
              clientUuid: mut.clientUuid,
              mutationId: mut.mutationId,
              deviceInfo: deviceId,
              entity: 'IncidenteTecnico',
              action: 'CREATE',
              payload: mut as any,
              syncedAt: now,
            },
          });

          results.push({
            mutationId: mut.mutationId,
            clientUuid: mut.clientUuid,
            serverAssignedId: inc.id,
            status: 'APPLIED',
            syncedAt: now.toISOString(),
          });
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
                syncedAt: (existing.syncedAt || existing.createdAt).toISOString(),
              });
              continue;
            }

            let targetAgenciaId = mutData.agenciaId || currentUser?.agenciaId;
            if (!targetAgenciaId) {
              throw new BadRequestException('Debe indicar la agencia en la cual se realizará el servicio especial.');
            }
            const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(currentUser?.role?.namerol || '');
            if (!isAdmin && currentUser?.agenciaId && targetAgenciaId !== currentUser.agenciaId) {
              targetAgenciaId = currentUser.agenciaId;
            }

            const vInfo = mutData.vehiculoInfo || mutData;
            const placa = String(vInfo.placa || mutData.placa || '').toUpperCase().trim();
            if (!placa) {
              throw new BadRequestException('La placa del vehículo es obligatoria.');
            }
            const marca = vInfo.marca || mutData.marca || null;
            const modelo = vInfo.modelo || mutData.modelo || null;
            const color = vInfo.color || mutData.color || null;
            const clienteNombre = vInfo.cliente || vInfo.clienteNombre || mutData.cliente || null;

            const tipoServicio = String(mutData.tipoServicio || mutData.servicioNombre || '').trim();
            if (!tipoServicio) {
              throw new BadRequestException('El tipo de servicio especial es obligatorio.');
            }

            const codigoSE = mutData.codigoSE || `SE-${Date.now().toString().slice(-6)}`;
            const created = await this.prisma.servicioEspecial.create({
              data: {
                clientUuid: mut.clientUuid,
                codigoSE,
                tipoServicio,
                placa,
                marca,
                modelo,
                color,
                clienteNombre,
                agenciaId: targetAgenciaId,
                operadorId: userId,
                prioridad: mutData.prioridad || 'Media',
                estado: mutData.estado || 'Pendiente',
                recetaInsumos: mutData.recetaInsumos || null,
                evidencias: mutData.evidencias || null,
                calificacionCalidad: mutData.calificacionCalidad ? Number(mutData.calificacionCalidad) : null,
                observaciones: mutData.observaciones || null,
                syncedAt: now,
              },
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
              throw new NotFoundException(`Servicio especial ${mut.clientUuid} no encontrado para actualizar`);
            }

            const updateData: any = {
              version: existing.version + 1,
              syncedAt: now,
            };
            if (mutData.estado) updateData.estado = mutData.estado;
            if (mutData.fechaInicio) updateData.fechaInicio = new Date(mutData.fechaInicio);
            if (mutData.fechaFin) updateData.fechaFin = new Date(mutData.fechaFin);
            if (mutData.evidencias) updateData.evidencias = mutData.evidencias;
            if (mutData.calificacionCalidad !== undefined) updateData.calificacionCalidad = Number(mutData.calificacionCalidad);
            if (mutData.observaciones) updateData.observaciones = mutData.observaciones;

            const updated = await this.prisma.servicioEspecial.update({
              where: { id: existing.id },
              data: updateData,
            });

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
          throw new BadRequestException(`Entidad de sincronización no soportada: ${mut.entity}`);
        }
      } catch (err: any) {
        this.logger.error(`Error procesando mutación ${mut.mutationId}: ${err.message}`);
        const intentos = Number(mut.attempts || mut.data?.attempts || 1);
        const isPoisonPill = intentos >= 5 || err.message?.includes('no existe') || err.message?.includes('inválido');

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
              },
            });
          } catch (dlqErr) {
            this.logger.error(`Error registrando en DLQ: ${dlqErr}`);
          }

          results.push({
            mutationId: mut.mutationId,
            clientUuid: mut.clientUuid,
            serverAssignedId: '',
            status: 'DEAD_LETTER' as any,
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
      const sinceDate = isNaN(Number(query.since)) ? new Date(query.since) : new Date(Number(query.since));
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

    // Scoping por Permisos y Sede
    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { role: true },
      });

      if (user && !['SUPER_ADMIN', 'ADMIN'].includes(user.role?.namerol || '')) {
        if (user.role?.namerol === 'SUPERVISOR' && user.regionId) {
          whereClause.bahia = { agencia: { regionId: user.regionId } };
        } else if (user.agenciaId) {
          whereClause.bahia = { agenciaId: user.agenciaId };
        }
      }
    }

    const limit = Math.min(200, Math.max(1, Number(query.limit || query.pageSize || 50)));

    // Cursor Pagination & DataGrid Pagination
    const findArgs: any = {
      where: whereClause,
      include: {
        bahia: { include: { agencia: true } },
        catalogo: true,
        operador: { select: { id: true, name: true, lastname: true, email: true } },
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
    const servicios = hasMore ? serviciosConExtra.slice(0, limit) : serviciosConExtra;
    const nextCursor = hasMore && servicios.length > 0 ? servicios[servicios.length - 1].id : null;
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
        role: { select: { id: true, namerol: true, permisos: true } },
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
            unidadConsumo: { select: { id: true, codigo: true, nombre: true, simbolo: true } },
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
        unidadMedida: { select: { id: true, codigo: true, nombre: true, simbolo: true } },
      },
      orderBy: { nombre: 'asc' },
    });

    // Bahías: si el usuario tiene agencia, las de su agencia; sino todas las activas
    const bahias =
      user?.agencia?.bahias?.length
        ? user.agencia.bahias
        : await this.prisma.bahia.findMany({
            where: { activa: true },
            select: { id: true, codigo: true, nombre: true, activa: true, agenciaId: true },
          });

    return {
      serverTime: new Date().toISOString(),
      syncToken: new Date().toISOString(),
      user: {
        id: user?.id,
        email: user?.email,
        nombre: `${user?.name} ${user?.lastname}`.trim(),
        role: user?.role?.namerol,
        permisos: user?.role?.permisos || [],
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
          cantidad: Number(r.cantidadUsada),
          unidad: r.unidadConsumo.codigo,
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
    incidenteId?: string;
    contentType?: string;
  }) {
    let agenciaId = body.agenciaId;
    let servicioId = body.servicioId;
    let maquinariaId = body.maquinariaId;
    let incidenteId = body.incidenteId;
    if (body.category === 'MAQUINARIA_INCIDENTE' && (body.incidenteId || body.clientUuid)) {
      const incidentReference = body.incidenteId || body.clientUuid;
      const incident = await this.prisma.incidenteTecnico.findFirst({
        where: { OR: [{ id: incidentReference }, { clientUuid: incidentReference }] },
        select: { id: true, maquinariaId: true, maquinaria: { select: { agenciaId: true } } },
      });
      if (incident) {
        incidenteId = incident.id;
        maquinariaId = incident.maquinariaId;
        agenciaId = incident.maquinaria.agenciaId || agenciaId;
      }
    }
    if (body.clientUuid) {
      const service = await this.prisma.servicioLavado.findFirst({
        where: { OR: [{ clientUuid: body.clientUuid }, { id: body.clientUuid }] },
        select: { ordenTrabajoOT: true, bahia: { select: { agenciaId: true } } },
      });
      if (service) {
        if (!agenciaId && service.bahia?.agenciaId) {
          agenciaId = service.bahia.agenciaId;
        }
        if (!servicioId && (body.category === 'SERVICIOS_GENERALES' || !body.category)) {
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
        select: { id: true, clientUuid: true, codigoSE: true, ordenTrabajoOT: true, agenciaId: true },
      });
      if (specialService) {
        agenciaId = specialService.agenciaId || agenciaId;
        servicioId = specialService.ordenTrabajoOT || specialService.codigoSE || specialService.id;
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
      incidenteId,
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

  async confirmMediaUpload(body: {
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
  }, currentUser?: any) {
    const specialServiceKey = body.servicioId || body.clientUuid;
    if (body.category === 'SERVICIOS_ESPECIALES' && body.specialAction === 'START') {
      const updated = await this.serviciosEspecialesService.iniciar({
        id: specialServiceKey,
        operadorId: body.specialOperatorId,
        videoInicialUrl: body.fileUrl,
      }, currentUser);
      return { success: true, action: 'START', ...body, service: updated };
    }

    if (body.category === 'SERVICIOS_ESPECIALES' && body.specialAction === 'PAUSE') {
      if (!body.pauseReason?.trim()) {
        throw new BadRequestException('El motivo de la pausa es obligatorio.');
      }
      const updated = await this.serviciosEspecialesService.pausar({
        id: specialServiceKey,
        motivo: body.pauseReason.trim(),
        videoPausaUrl: body.fileUrl,
      }, currentUser);
      return { success: true, action: 'PAUSE', ...body, service: updated };
    }

    if (body.category === 'SERVICIOS_ESPECIALES' && body.specialAction === 'RESUME') {
      const updated = await this.serviciosEspecialesService.reanudar({
        id: specialServiceKey,
        videoReanudarUrl: body.fileUrl,
        observaciones: body.resumeNotes,
      }, currentUser);
      return { success: true, action: 'RESUME', ...body, service: updated };
    }

    if (body.category === 'SERVICIOS_ESPECIALES' && body.specialAction === 'FINISH') {
      const updated = await this.serviciosEspecialesService.completar({
        id: specialServiceKey,
        videoFinalUrl: body.fileUrl,
        observaciones: body.resumeNotes,
      }, currentUser);
      return { success: true, action: 'FINISH', ...body, service: updated };
    }

    if (body.category === 'MAQUINARIA_INCIDENTE') {
      const incidenteId = body.incidenteId || body.clientUuid;
      const incidente = await this.prisma.incidenteTecnico.findFirst({
        where: { OR: [{ id: incidenteId }, { clientUuid: incidenteId }] },
      });
      if (!incidente) {
        throw new BadRequestException(`No se encontró el incidente con id: ${incidenteId}`);
      }
      const resolvedIncidentId = incidente.id;
      const existing = await this.prisma.evidenciaIncidente.findFirst({
        where: { incidenteId: resolvedIncidentId, tipo: body.type, url: body.fileUrl },
      });
      if (existing) return { success: true, status: 'ALREADY_EXISTS', evidenciaId: existing.id, ...body };

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
        await this.prisma.incidenteTecnico.update({ where: { id: resolvedIncidentId }, data: { fotoEvidenciaUrl: body.fileUrl } });
      }
      return { success: true, incidenteId: resolvedIncidentId, evidenciaId: evidencia.id, type: body.type, fileUrl: body.fileUrl };
    }

    const service = await this.prisma.servicioLavado.findFirst({
      where: {
        OR: [{ clientUuid: body.clientUuid }, { id: body.clientUuid }],
      },
      include: { evidencias: true },
    });

    if (!service) {
      throw new BadRequestException(`No se encontró el servicio con clientUuid: ${body.clientUuid}`);
    }

    // Idempotencia Zero-Trust: Si la foto ya está vinculada en evidencias o en columnas principales
    const yaVinculadaEnEvidencias = service.evidencias?.some(
      (e) => e.url === body.fileUrl && e.tipo === body.type,
    );
    const yaVinculadaEnColumnas =
      (body.type === 'FOTO_INGRESO' && service.fotoIngresoUrl === body.fileUrl) ||
      (body.type === 'FOTO_SALIDA' && service.fotoSalidaUrl === body.fileUrl);

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

    const isIngreso = ['FOTO_INGRESO', 'INGRESO', 'VIDEO_INICIAL', 'VIDEO_INGRESO'].includes(body.type);
    const isSalida = ['FOTO_SALIDA', 'SALIDA', 'VIDEO_FINAL', 'VIDEO_SALIDA'].includes(body.type);

    const dataToUpdate: any = {};
    if (isIngreso) {
      dataToUpdate.fotoIngresoUrl = body.fileUrl;
      if (body.type.includes('VIDEO')) dataToUpdate.videoInicialUrl = body.fileUrl;
    } else if (isSalida) {
      dataToUpdate.fotoSalidaUrl = body.fileUrl;
      if (body.type.includes('VIDEO')) dataToUpdate.videoFinalUrl = body.fileUrl;
    }

    const updated = await this.prisma.servicioLavado.update({
      where: { id: service.id },
      data: dataToUpdate,
    });

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

  async listDeadLetterQueue(resuelto?: boolean) {
    const where: any = {};
    if (resuelto !== undefined) {
      where.resuelto = resuelto;
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

  async resolveDeadLetterItem(id: string, resuelto: boolean = true) {
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

    return {
      success: true,
      id: updated.id,
      resuelto: updated.resuelto,
    };
  }

  // Punto 3: Replay y Reingreso de Mutaciones en Dead-Letter Queue (/sync/dlq/replay)
  async replayDeadLetterItem(dlqId: string, payloadCorregido?: any, userId?: string) {
    const item = await this.prisma.syncDeadLetterQueue.findUnique({
      where: { id: dlqId },
    });

    if (!item) {
      throw new BadRequestException(`Registro DLQ ${dlqId} no encontrado`);
    }

    // Combinar payload original con correcciones del administrador
    const originalPayload =
      typeof item.payload === 'object' && item.payload !== null ? (item.payload as any) : {};
    const mergedData = payloadCorregido ? { ...originalPayload, ...payloadCorregido } : originalPayload;

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
    if (firstResult && (firstResult.status === 'APPLIED' || firstResult.status === 'ALREADY_EXISTS')) {
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

      throw new BadRequestException(`No se pudo reaplicar la mutación de DLQ: ${errorMsg}`);
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
        const missingSalida = s.estado === ServiceStatus.FINALIZADO && !s.fotoSalidaUrl;
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


