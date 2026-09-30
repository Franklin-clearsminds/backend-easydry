import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { MaquinariaService } from './maquinaria.service.js';
import type { Actor } from './maquinaria.permisos.js';

const DAY = 86_400_000;

const coordCosta: Actor = { id: 'coord-costa', rol: 'COORD_MANTENIMIENTO', regionId: 'costa', agenciaId: null };
const tecnico: Actor = { id: 'tec-1', rol: 'TECNICO', regionId: 'costa', agenciaId: null };
const pulidor: Actor = { id: 'pul-1', rol: 'PULIDOR', regionId: null, agenciaId: 'ag-1' };
const lider: Actor = { id: 'lider-1', rol: 'LIDER', regionId: null, agenciaId: 'ag-1' };
const admin: Actor = { id: 'adm-1', rol: 'ADMIN', regionId: null, agenciaId: null };
const supervisorCosta: Actor = { id: 'sup-1', rol: 'SUPERVISOR', regionId: 'costa', agenciaId: null };
const coordEspeciales: Actor = { id: 'coord-esp-1', rol: 'COORD_SERVICIOS_ESPECIALES', regionId: null, agenciaId: null };

function maquina(over: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    codigo: 'MQ-01',
    nombre: 'Hidro',
    activa: true,
    agenciaId: 'ag-1',
    bahiaId: null,
    operadorAsignadoId: 'pul-1',
    ventanaAdelantoDias: 7,
    estadoOperativo: 'OPERATIVA',
    agencia: { id: 'ag-1', nombre: 'Agencia 1', regionId: 'costa' },
    ...over,
  };
}

function build(prismaOver: Record<string, unknown> = {}) {
  const tx = {
    maquinariaEvento: { create: vi.fn().mockResolvedValue({}) },
    mantenimientoMaquinaria: {
      update: vi.fn().mockImplementation(async ({ data }) => ({ id: 'mt1', ...data })),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({}),
    },
    maquinaria: { update: vi.fn().mockResolvedValue({ ...maquina(), activa: false }) },
    incidenteTecnico: {
      create: vi.fn().mockResolvedValue({ id: 'inc-1', titulo: 't', fechaReporte: new Date() }),
    },
  };
  const prisma: Record<string, any> = {
    maquinaria: {
      findUnique: vi.fn().mockResolvedValue(maquina()),
      findUniqueOrThrow: vi.fn().mockResolvedValue(maquina()),
    },
    incidenteTecnico: { findMany: vi.fn(), findUnique: vi.fn() },
    mantenimientoMaquinaria: { findUnique: vi.fn() },
    // sin plantilla de checklist para el tipo: la orden se cierra como siempre
    checklistRespuesta: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn() },
    checklistPlantilla: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    ...prismaOver,
  };
  const storage = {
    maquinariaPrefix: (c: string) => `maquinaria/${c.toLowerCase()}/`,
    generarVariantes: vi.fn().mockResolvedValue(undefined),
    inspectEvidence: vi.fn(async (url: string) =>
      url.endsWith('.pdf')
        ? { key: url, kind: 'DOCUMENTO', mimeType: 'application/pdf', sizeBytes: 1000 }
        : { key: url, kind: 'IMAGEN', mimeType: 'image/jpeg', sizeBytes: 1000 },
    ),
  };
  const notifications = {
    notificarCoordinadorRegion: vi.fn().mockResolvedValue(undefined),
    notificarUsuarios: vi.fn().mockResolvedValue(undefined),
  };
  const service = new MaquinariaService(prisma as never, storage as never, notifications as never);
  return { service, prisma, tx, storage, notifications };
}

describe('MaquinariaService — reglas de trazabilidad', () => {
  describe('ejecutar mantenimiento (ventana de adelanto)', () => {
    const mantenimiento = (diasHastaLaFecha: number) => ({
      id: 'mt1',
      maquinariaId: 'm1',
      tecnicoId: 'tec-1',
      estado: 'PENDIENTE',
      tipo: 'PREVENTIVO',
      frecuenciaDias: 30,
      fechaProgramada: new Date(Date.now() + diasHastaLaFecha * DAY),
      fechaMantenimiento: new Date(Date.now() + diasHastaLaFecha * DAY),
      observaciones: null,
      proximoMantenimiento: null,
      creadoPorId: 'coord-costa',
      maquinaria: maquina({ ventanaAdelantoDias: 7 }),
    });
    const evidencias = [{ url: 'maquinaria/mq-01/mantenimientos/mt1/multimedia/a.jpg' }, { url: 'maquinaria/mq-01/mantenimientos/mt1/documento/a.pdf' }];

    it('bloquea el registro cuando falta más que la ventana configurada, sin excepciones', async () => {
      const { service, prisma } = build();
      prisma.mantenimientoMaquinaria.findUnique.mockResolvedValue(mantenimiento(20));
      await expect(service.ejecutarMantenimiento({ mantenimientoId: 'mt1', evidencias } as never, tecnico))
        .rejects.toThrow(/Aún no se puede registrar/);
      // Ni siquiera el admin puede saltarse la ventana
      await expect(service.ejecutarMantenimiento({ mantenimientoId: 'mt1', evidencias } as never, admin))
        .rejects.toThrow(BadRequestException);
    });

    it('permite adelantarlo dentro de la ventana y conserva el calendario original', async () => {
      const { service, prisma, tx } = build();
      const m = mantenimiento(5);
      prisma.mantenimientoMaquinaria.findUnique.mockResolvedValue(m);

      await service.ejecutarMantenimiento({ mantenimientoId: 'mt1', evidencias } as never, tecnico);

      const update = tx.mantenimientoMaquinaria.update.mock.calls[0][0].data;
      expect(update.estado).toBe('FINALIZADO');
      expect(update.ejecutadoPorId).toBe('tec-1');
      // Fecha y hora reales de ejecución, distintas de la programada
      expect(update.fechaEjecucion).toBeInstanceOf(Date);
      expect(update.fechaProgramada).toEqual(m.fechaProgramada);
      // El siguiente sigue en programada + frecuencia, no en hoy + frecuencia
      const siguiente = tx.mantenimientoMaquinaria.create.mock.calls[0][0].data.fechaProgramada as Date;
      expect(siguiente.getTime()).toBe(new Date(m.fechaProgramada.getTime() + 30 * DAY).getTime());
      expect(tx.maquinariaEvento.create.mock.calls[0][0].data.tipo).toBe('MANTENIMIENTO_EJECUTADO');
    });

    it('exige al menos una foto o video y un documento', async () => {
      const { service, prisma } = build();
      prisma.mantenimientoMaquinaria.findUnique.mockResolvedValue(mantenimiento(0));
      await expect(service.ejecutarMantenimiento(
        { mantenimientoId: 'mt1', evidencias: [{ url: 'maquinaria/mq-01/mantenimientos/mt1/multimedia/a.jpg' }] } as never,
        tecnico,
      )).rejects.toThrow(/documento/);
      await expect(service.ejecutarMantenimiento(
        { mantenimientoId: 'mt1', evidencias: [{ url: 'maquinaria/mq-01/mantenimientos/mt1/documento/a.pdf' }] } as never,
        tecnico,
      )).rejects.toThrow(/foto o un video/);
    });

    it('solo el técnico asignado puede ejecutarlo', async () => {
      const { service, prisma } = build();
      prisma.mantenimientoMaquinaria.findUnique.mockResolvedValue(mantenimiento(0));
      await expect(service.ejecutarMantenimiento(
        { mantenimientoId: 'mt1', evidencias } as never,
        { ...tecnico, id: 'otro-tecnico' },
      )).rejects.toThrow(ForbiddenException);
    });
  });

  describe('reportar incidencia', () => {
    it('un pulidor no puede reportar una máquina que no tiene asignada', async () => {
      const { service, prisma } = build();
      prisma.maquinaria.findUnique.mockResolvedValue(maquina({ operadorAsignadoId: 'otro-pulidor' }));
      await expect(service.reportarIncidente(
        { maquinariaId: 'm1', titulo: 't', descripcion: 'd', evidencias: [] } as never,
        pulidor,
      )).rejects.toThrow(/asignadas/);
    });

    it('el supervisor de la región y el coordinador de servicios especiales sí pueden reportar (aunque no sean el operador asignado)', async () => {
      const { service, prisma } = build();
      prisma.maquinaria.findUnique.mockResolvedValue(maquina({ operadorAsignadoId: 'pul-1' }));
      prisma.maquinaria.count = vi.fn().mockResolvedValue(1);
      const evidenciasIncidente = [
        { url: 'maquinaria/mq-01/incidentes/i1/reporte/a.jpg' },
        { url: 'maquinaria/mq-01/incidentes/i1/reporte/a.pdf' },
      ];
      await service.reportarIncidente(
        { maquinariaId: 'm1', titulo: 't', descripcion: 'd', evidencias: evidenciasIncidente } as never,
        supervisorCosta,
      );
      await service.reportarIncidente(
        { maquinariaId: 'm1', titulo: 't', descripcion: 'd', evidencias: evidenciasIncidente } as never,
        coordEspeciales,
      );
      expect(prisma.maquinaria.count).toHaveBeenCalledTimes(2);
    });

    it('el supervisor fuera de su región no puede reportar', async () => {
      const { service, prisma } = build();
      prisma.maquinaria.findUnique.mockResolvedValue(maquina({ operadorAsignadoId: 'pul-1' }));
      prisma.maquinaria.count = vi.fn().mockResolvedValue(0);
      await expect(service.reportarIncidente(
        { maquinariaId: 'm1', titulo: 't', descripcion: 'd', evidencias: [] } as never,
        { ...supervisorCosta, regionId: 'sierra' },
      )).rejects.toThrow(ForbiddenException);
    });

    it('no acepta máquinas desactivadas', async () => {
      const { service, prisma } = build();
      prisma.maquinaria.findUnique.mockResolvedValue(maquina({ activa: false }));
      await expect(service.reportarIncidente(
        { maquinariaId: 'm1', titulo: 't', descripcion: 'd', evidencias: [] } as never,
        pulidor,
      )).rejects.toThrow(/desactivada/);
    });

    it('al reportar basta una foto o video: el PDF no es obligatorio (se pide recién al resolver)', async () => {
      const { service, prisma } = build();
      prisma.maquinaria.findUnique.mockResolvedValue(maquina({ operadorAsignadoId: 'pul-1' }));
      await expect(service.reportarIncidente(
        { maquinariaId: 'm1', titulo: 't', descripcion: 'd', evidencias: [{ url: 'maquinaria/mq-01/incidentes/i1/reporte/a.jpg' }] } as never,
        pulidor,
      )).resolves.toBeDefined();
    });

    it('al reportar sigue exigiendo al menos una foto o video', async () => {
      const { service, prisma } = build();
      prisma.maquinaria.findUnique.mockResolvedValue(maquina({ operadorAsignadoId: 'pul-1' }));
      await expect(service.reportarIncidente(
        { maquinariaId: 'm1', titulo: 't', descripcion: 'd', evidencias: [] } as never,
        pulidor,
      )).rejects.toThrow(/al menos una foto o un video/);
    });

    it('el líder puede reportar cualquier máquina de su agencia, no solo la asignada a él', async () => {
      const { service, prisma } = build();
      prisma.maquinaria.findUnique.mockResolvedValue(maquina({ agenciaId: 'ag-1', operadorAsignadoId: 'pul-1' }));
      prisma.maquinaria.count = vi.fn().mockResolvedValue(1); // assertPuedeVerMaquina: la máquina sí está en su agencia
      const evidenciasIncidente = [
        { url: 'maquinaria/mq-01/incidentes/i1/reporte/a.jpg' },
        { url: 'maquinaria/mq-01/incidentes/i1/reporte/a.pdf' },
      ];
      await service.reportarIncidente(
        { maquinariaId: 'm1', titulo: 't', descripcion: 'd', evidencias: evidenciasIncidente } as never,
        lider,
      );
      expect(prisma.maquinaria.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'm1', agenciaId: 'ag-1' }) }),
      );
    });

    it('el líder no puede reportar una máquina de otra agencia', async () => {
      const { service, prisma } = build();
      prisma.maquinaria.findUnique.mockResolvedValue(maquina({ agenciaId: 'ag-2', operadorAsignadoId: 'pul-9' }));
      prisma.maquinaria.count = vi.fn().mockResolvedValue(0); // no está en la agencia del líder (ag-1)
      await expect(service.reportarIncidente(
        { maquinariaId: 'm1', titulo: 't', descripcion: 'd', evidencias: [] } as never,
        lider,
      )).rejects.toThrow(ForbiddenException);
    });
  });

  describe('asignar operador', () => {
    it('acepta un pulidor (fijo o móvil)', async () => {
      const { service } = build({
        user: { findUnique: vi.fn().mockResolvedValue({ id: 'pul-2', estado: 1, role: { namerol: 'PULIDOR' } }) },
      });
      await expect(
        service.asignarOperador({ maquinariaId: 'm1', operadorId: 'pul-2' } as never, admin),
      ).resolves.toBeDefined();
    });

    it('rechaza asignarla a un líder: el líder ya ve y reporta toda la maquinaria de su agencia sin necesitar asignación individual', async () => {
      const { service } = build({
        user: { findUnique: vi.fn().mockResolvedValue({ id: 'lider-1', estado: 1, role: { namerol: 'LIDER' } }) },
      });
      await expect(
        service.asignarOperador({ maquinariaId: 'm1', operadorId: 'lider-1' } as never, admin),
      ).rejects.toThrow(/solo.*pulidor/i);
    });
  });

  describe('activar / desactivar', () => {
    it('exige motivo al desactivar y registra quién lo hizo', async () => {
      const { service, tx } = build();
      await expect(service.setActiva({ maquinariaId: 'm1', activa: false } as never, admin))
        .rejects.toThrow(/motivo/);

      await service.setActiva({ maquinariaId: 'm1', activa: false, motivo: 'Irreparable' } as never, admin);
      const data = tx.maquinaria.update.mock.calls[0][0].data;
      expect(data).toMatchObject({ activa: false, estadoOperativo: 'DE_BAJA', desactivadoPorId: 'adm-1', motivoDesactivacion: 'Irreparable' });
      const evento = tx.maquinariaEvento.create.mock.calls[0][0].data;
      expect(evento).toMatchObject({ tipo: 'MAQUINA_DESACTIVADA', actorId: 'adm-1', maquinariaId: 'm1' });
    });
  });

  describe('ficha técnica y foto (imágenes en S3)', () => {
    it('al editar verifica que la ficha sea una imagen dentro de la carpeta de la máquina', async () => {
      const { service, prisma, storage } = build();
      prisma.maquinaria.findUniqueOrThrow.mockResolvedValue({ ...maquina(), fichaTecnicaUrl: null, fotoUrl: null });
      await service.update({ id: 'm1', fichaTecnicaUrl: 'maquinaria/mq-01/perfil/ficha-tecnica/a.jpg' } as never, admin);
      expect(storage.inspectEvidence).toHaveBeenCalledWith(
        'maquinaria/mq-01/perfil/ficha-tecnica/a.jpg',
        { prefix: 'maquinaria/mq-01/perfil/ficha-tecnica/' },
      );
    });

    it('rechaza una ficha que no es imagen (por ejemplo un PDF)', async () => {
      const { service, prisma } = build();
      prisma.maquinaria.findUniqueOrThrow.mockResolvedValue({ ...maquina(), fichaTecnicaUrl: null, fotoUrl: null });
      await expect(service.update({ id: 'm1', fichaTecnicaUrl: 'maquinaria/mq-01/perfil/ficha-tecnica/a.pdf' } as never, admin))
        .rejects.toThrow(/imagen/);
    });

    it('no vuelve a verificar una ficha que no cambió', async () => {
      const { service, prisma, storage } = build();
      const ficha = 'maquinaria/mq-01/perfil/ficha-tecnica/a.jpg';
      prisma.maquinaria.findUniqueOrThrow.mockResolvedValue({ ...maquina(), fichaTecnicaUrl: ficha, fotoUrl: null });
      await service.update({ id: 'm1', fichaTecnicaUrl: ficha } as never, admin);
      expect(storage.inspectEvidence).not.toHaveBeenCalled();
    });
  });

  describe('alcance regional', () => {
    it('un coordinador no puede mover una máquina de otra región', async () => {
      const { service, prisma } = build();
      prisma.maquinaria.findUnique.mockResolvedValue(maquina({ agencia: { id: 'ag-9', nombre: 'Quito', regionId: 'sierra' } }));
      await expect(service.transferirMaquinaria(
        { maquinariaId: 'm1', destinoAgenciaId: 'ag-1', motivo: 'x' } as never,
        coordCosta,
      )).rejects.toThrow(/otra región/);
    });

    it('un técnico solo puede asignarse a técnicos de la misma región', async () => {
      const { service, prisma } = build();
      prisma.incidenteTecnico.findUnique.mockResolvedValue({
        id: 'i1', estado: 'ABIERTO', titulo: 't', tecnicoAsignadoId: null, destinoTallerId: null,
        maquinaria: maquina(),
      });
      prisma.user = {
        findUnique: vi.fn().mockResolvedValue({ id: 'tec-x', estado: 1, regionId: 'sierra', role: { namerol: 'TECNICO' } }),
      };
      await expect(service.asignarIncidente({ incidenteId: 'i1', tecnicoId: 'tec-x' } as never, coordCosta))
        .rejects.toThrow(/misma región/);
    });
  });
});
