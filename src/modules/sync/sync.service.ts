import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { OperacionesService } from '../operaciones/operaciones.service.js';
import { SyncPushDto } from './dto/sync-push.dto.js';
import { SyncPullQueryDto } from './dto/sync-pull.dto.js';
import { ServiceStatus } from '@prisma/client';

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

    // Obtener usuario actual para conocer su agencia
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        agencia: {
          include: { bahias: true },
        },
      },
    });

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
        const entity = String(mut.entity || '').toLowerCase();
        const isServicio =
          entity === 'servicio_lavado' ||
          entity === 'work_order' ||
          entity === 'extra_assignment';

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
              if (!b) bahiaId = null;
            }
            if (!bahiaId) {
              // Usar primera bahía de la agencia asignada al operador
              bahiaId = currentUser?.agencia?.bahias?.[0]?.id;
            }
            if (!bahiaId) {
              // Fallback a primera bahía del sistema
              const primeraBahia = await this.prisma.bahia.findFirst({ where: { activa: true } });
              bahiaId = primeraBahia?.id;
            }

            if (!bahiaId) {
              throw new BadRequestException('No hay bahías activas disponibles en el sistema.');
            }

            // 3. Determinar Servicio de Catálogo
            let servicioCatalogoId = Number(mut.data?.servicioCatalogoId || mut.data?.serviceId || 1);
            const catalogo = await this.prisma.catalogoServicio.findUnique({
              where: { id: servicioCatalogoId },
            });

            if (!catalogo) {
              const primerCat = await this.prisma.catalogoServicio.findFirst();
              if (primerCat) servicioCatalogoId = primerCat.id;
            }

            const placa = (mut.data?.placa || mut.data?.vehiclePlate || 'ABC-0000').toUpperCase().trim();
            const modelo = (mut.data?.modelo || mut.data?.vehicleModel || 'Vehículo General').trim();
            const estadoFinal: ServiceStatus =
              mut.data?.estado === 'FINALIZADO' || mut.data?.status === 'COMPLETED'
                ? ServiceStatus.FINALIZADO
                : mut.data?.estado === 'EN_PROCESO' || mut.data?.status === 'IN_PROGRESS'
                ? ServiceStatus.EN_PROCESO
                : ServiceStatus.EN_ESPERA;

            const nuevoServicio = await this.prisma.servicioLavado.create({
              data: {
                clientUuid: mut.clientUuid,
                placa,
                modelo,
                color: mut.data?.color?.trim(),
                cliente: mut.data?.cliente?.trim() || mut.data?.clientName?.trim(),
                estado: estadoFinal,
                bahiaId,
                servicioCatalogoId,
                operadorId: userId,
                horaIngreso: mut.data?.horaIngreso ? new Date(mut.data.horaIngreso) : now,
                horaSalida: estadoFinal === ServiceStatus.FINALIZADO ? now : null,
                fotoIngresoUrl: mut.data?.fotoIngresoUrl || mut.data?.evidenceInLocalUri,
                fotoSalidaUrl: mut.data?.fotoSalidaUrl || mut.data?.evidenceOutLocalUri,
                observaciones: mut.data?.observaciones || mut.data?.notes,
                syncedAt: now,
              },
            });

            // Si se creó directamente como finalizado, invocar descuento de insumos
            if (estadoFinal === ServiceStatus.FINALIZADO) {
              try {
                await this.operacionesService.update(nuevoServicio.id, {
                  id: nuevoServicio.id,
                  estado: ServiceStatus.FINALIZADO,
                });
              } catch (e: any) {
                this.logger.warn(`Advertencia al descontar insumos de orden offline: ${e.message}`);
              }
            }

            // Auditoría
            await this.prisma.syncOutboxAudit.create({
              data: {
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

            // Matriz de Resolución de Conflictos:
            // Si el servicio en servidor fue cancelado pero el operador en campo lo finalizó físicamente:
            // "Gana la Operación en Campo"
            let overrideWarning: string | null = null;
            if (existing.estado === ServiceStatus.CANCELADO && (action === 'COMPLETE' || mut.data?.estado === 'FINALIZADO')) {
              overrideWarning = 'Revertida cancelación administrativa previa: prevaleció finalización física en campo.';
              this.logger.warn(`[ConflictResolution] ${overrideWarning} (Servicio: ${existing.id})`);
            }

            const estadoNuevo =
              action === 'COMPLETE' || mut.data?.estado === 'FINALIZADO' || mut.data?.status === 'COMPLETED'
                ? ServiceStatus.FINALIZADO
                : mut.data?.estado || existing.estado;

            const updated = await this.operacionesService.update(existing.id, {
              id: existing.id,
              estado: estadoNuevo,
              fotoSalidaUrl: mut.data?.fotoSalidaUrl || mut.data?.evidenceOutLocalUri || existing.fotoSalidaUrl,
              observaciones: mut.data?.observaciones || mut.data?.notes || existing.observaciones,
            });

            await this.prisma.syncOutboxAudit.create({
              data: {
                clientUuid: mut.clientUuid,
                deviceInfo: deviceId,
                entity: 'ServicioLavado',
                action: overrideWarning ? `${action}_OVERRIDE_CONFLICT` : action,
                payload: { ...(mut as any), conflictNote: overrideWarning },
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

    if (query.bahiaId) {
      whereClause.bahiaId = query.bahiaId;
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

    const servicios = await this.prisma.servicioLavado.findMany({
      where: whereClause,
      include: {
        bahia: {
          select: { id: true, nombre: true, codigo: true },
        },
        catalogo: {
          select: { id: true, codigo: true, nombre: true, precio: true },
        },
        operador: {
          select: { id: true, name: true, lastname: true, email: true },
        },
      },
      orderBy: { updatedAt: 'asc' },
      take: 100,
    });

    return {
      serverTime: new Date().toISOString(),
      count: servicios.length,
      servicios: servicios.map((s) => ({
        id: s.id,
        clientUuid: s.clientUuid,
        placa: s.placa,
        modelo: s.modelo,
        color: s.color,
        cliente: s.cliente,
        estado: s.estado,
        bahiaId: s.bahiaId,
        bahiaNombre: s.bahia.nombre,
        servicioNombre: s.catalogo.nombre,
        operadorNombre: `${s.operador.name} ${s.operador.lastname}`.trim(),
        horaIngreso: s.horaIngreso,
        horaSalida: s.horaSalida,
        fotoIngresoUrl: s.fotoIngresoUrl,
        fotoSalidaUrl: s.fotoSalidaUrl,
        version: s.version,
        updatedAt: s.updatedAt,
      })),
      hasMore: servicios.length === 100,
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
        tipoEnvase: { select: { id: true, nombre: true, capacidad: true } },
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
      syncToken: `sync_${Date.now()}`,
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

  async generateMediaUploadTicket(body: { clientUuid: string; type: 'FOTO_INGRESO' | 'FOTO_SALIDA'; fileName?: string }) {
    const ext = body.fileName?.split('.').pop() || 'jpg';
    const uniqueFile = `${body.clientUuid}_${body.type.toLowerCase()}_${Date.now()}.${ext}`;
    const uploadUrl = `/api/v1/uploads/sync-media?file=${uniqueFile}&type=${body.type}`;
    const publicUrl = `/uploads/${uniqueFile}`;

    return {
      ticketId: `tkt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      clientUuid: body.clientUuid,
      type: body.type,
      uploadUrl,
      publicUrl,
      expiresInSeconds: 3600,
      headers: {
        'Content-Type': ext === 'png' ? 'image/png' : 'image/jpeg',
      },
    };
  }

  async confirmMediaUpload(body: { clientUuid: string; type: 'FOTO_INGRESO' | 'FOTO_SALIDA'; fileUrl: string }) {
    const service = await this.prisma.servicioLavado.findFirst({
      where: {
        OR: [{ clientUuid: body.clientUuid }, { id: body.clientUuid }],
      },
    });

    if (!service) {
      throw new BadRequestException(`No se encontró el servicio con clientUuid: ${body.clientUuid}`);
    }

    const dataToUpdate: any = {};
    if (body.type === 'FOTO_INGRESO') {
      dataToUpdate.fotoIngresoUrl = body.fileUrl;
    } else {
      dataToUpdate.fotoSalidaUrl = body.fileUrl;
    }

    const updated = await this.prisma.servicioLavado.update({
      where: { id: service.id },
      data: dataToUpdate,
    });

    await this.prisma.syncOutboxAudit.create({
      data: {
        clientUuid: service.clientUuid,
        entity: 'ServicioLavado',
        action: `MEDIA_UPLOAD_CONFIRM_${body.type}`,
        payload: body as any,
        syncedAt: new Date(),
      },
    });

    return {
      success: true,
      serviceId: updated.id,
      clientUuid: updated.clientUuid,
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
}

