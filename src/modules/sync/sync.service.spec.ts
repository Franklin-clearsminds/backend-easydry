import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SyncService } from './sync.service.js';
import { OperacionesService } from '../operaciones/operaciones.service.js';
import { ServiciosEspecialesService } from '../operaciones/servicios-especiales.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real. UNA excepción deliberada: el almacenamiento S3 es un doble que solo anota lo que le piden.
 * El `.env` trae credenciales del bucket real, y generar un ticket de subida consulta/escribe en S3; lo que se prueba aquí
 * es QUÉ le pide el servicio de sincronización (agencia y OT), no el almacenamiento.
 */
describe('SyncService media tickets (base real, S3 como borde)', () => {
  let env: Entorno;

  beforeAll(async () => {
    env = await abrirEntorno();
  });

  afterAll(async () => {
    await env.cerrar();
  });

  it('resuelve agencia y OT canónica para videos de servicios especiales', async () => {
    const region = await env.region('R1');
    const agencia = await env.agencia('A1', { regionId: region.id });
    const clientUuid = `${env.marca}-mobile-uuid`;
    const ot = `OT-${env.marca.toUpperCase()}-100`;
    await env.servicioEspecial({
      agenciaId: agencia.id,
      regionId: region.id,
      estado: 'En Proceso',
      fechaFin: null,
      datos: { clientUuid, ordenTrabajoOT: ot },
    });

    // Borde S3: anota el pedido y lo devuelve tal cual.
    const pedidos: any[] = [];
    const almacenamiento = {
      generateUploadTicket: async (dto: any) => {
        pedidos.push(dto);
        return dto;
      },
    };
    const service = new SyncService(
      env.prisma as never,
      new OperacionesService(env.prisma as never),
      new ServiciosEspecialesService(env.prisma as never),
      almacenamiento as never,
    );

    const result: any = await service.generateMediaUploadTicket({ clientUuid, type: 'VIDEO_PAUSA', category: 'SERVICIOS_ESPECIALES', fileName: 'pausa.mp4' });

    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toMatchObject({ agenciaId: agencia.id, servicioId: ot, clientUuid });
    expect(result).toMatchObject({ agenciaId: agencia.id, servicioId: ot });
  });
});
