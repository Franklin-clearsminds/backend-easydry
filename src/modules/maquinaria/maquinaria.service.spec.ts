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
const coordBodega: Actor = { id: 'coord-bod-1', rol: 'COORD_BODEGA', regionId: null, agenciaId: null };
const coordComercialCosta: Actor = { id: 'coord-com-1', rol: 'COORD_COMERCIAL', regionId: 'costa', agenciaId: null };

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
      update: vi.fn().mockImplementation(async ({ data }: any) => ({ id: 'inc-1', ...data })),
    },
    movimientoMaquinaria: { create: vi.fn().mockResolvedValue({ id: 'mov-1' }) },
    limpiezaMaquinaria: {
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: 'lim-1', ...data })),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data })),
      delete: vi.fn().mockResolvedValue({}),
    },
  };
  const prisma: Record<string, any> = {
    maquinaria: {
      findUnique: vi.fn().mockResolvedValue(maquina()),
      findUniqueOrThrow: vi.fn().mockResolvedValue(maquina()),
    },
    incidenteTecnico: { findMany: vi.fn(), findUnique: vi.fn(), groupBy: vi.fn().mockResolvedValue([]) },
    mantenimientoMaquinaria: { findUnique: vi.fn(), groupBy: vi.fn().mockResolvedValue([]) },
    limpiezaMaquinaria: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    user: { findMany: vi.fn().mockResolvedValue([]) },
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
    resolverDestinatariosPorRol: vi.fn().mockResolvedValue([]),
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

      await service.ejecutarMantenimiento({ mantenimientoId: 'mt1', evidencias, costoTotal: 50 } as never, tecnico);

      const update = tx.mantenimientoMaquinaria.update.mock.calls[0][0].data;
      expect(update.estado).toBe('FINALIZADO');
      expect(update.ejecutadoPorId).toBe('tec-1');
      expect(update.costoTotal).toBe(50);
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

    it('permite ejecutar sin evidencias cuando el rol no tiene permiso para subirlas', async () => {
      const { service, prisma, tx } = build();
      prisma.mantenimientoMaquinaria.findUnique.mockResolvedValue(mantenimiento(0));

      await service.ejecutarMantenimiento(
        { mantenimientoId: 'mt1', costoTotal: 50, evidencias: [] } as never,
        tecnico,
        false,
      );

      expect(tx.mantenimientoMaquinaria.update.mock.calls[0][0].data.estado).toBe('FINALIZADO');
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

    it('permite reportar sin evidencia cuando el rol no tiene permiso para subirla', async () => {
      const { service, prisma } = build();
      prisma.maquinaria.findUnique.mockResolvedValue(maquina({ operadorAsignadoId: 'pul-1' }));
      await expect(service.reportarIncidente(
        { maquinariaId: 'm1', titulo: 't', descripcion: 'd', evidencias: [] } as never,
        pulidor,
        false,
      )).resolves.toBeDefined();
    });

    it('rechaza evidencias recibidas si el rol no puede subirlas', async () => {
      const { service, prisma } = build();
      prisma.maquinaria.findUnique.mockResolvedValue(maquina({ operadorAsignadoId: 'pul-1' }));
      await expect(service.reportarIncidente(
        { maquinariaId: 'm1', titulo: 't', descripcion: 'd', evidencias: [{ url: 'maquinaria/mq-01/incidentes/i1/reporte/a.jpg' }] } as never,
        pulidor,
        false,
      )).rejects.toThrow(/no puede adjuntar evidencias/);
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

    it('un rol propio reporta cualquier máquina de su ámbito, no solo la asignada a él', async () => {
      const { service, prisma } = build();
      prisma.maquinaria.findUnique.mockResolvedValue(maquina({ agenciaId: 'ag-2', operadorAsignadoId: 'pul-9' }));
      prisma.maquinaria.count = vi.fn().mockResolvedValue(1);
      const rolPropio: Actor = { id: 'u-propio', rol: 'ROL_ACTIVOS_Y_TALLER', regionId: null, agenciaId: null, ambito: 'GLOBAL' };
      await expect(service.reportarIncidente(
        { maquinariaId: 'm1', titulo: 't', descripcion: 'd', evidencias: [{ url: 'maquinaria/mq-01/incidentes/i1/reporte/a.jpg' }] } as never,
        rolPropio,
      )).resolves.toBeDefined();
      expect(prisma.maquinaria.count).toHaveBeenCalledTimes(1);
    });

    it('un rol oficial conserva su regla: el técnico no reporta lo que no tiene asignado', async () => {
      const { service, prisma } = build();
      prisma.maquinaria.findUnique.mockResolvedValue(maquina({ operadorAsignadoId: 'otro-pulidor' }));
      await expect(service.reportarIncidente(
        { maquinariaId: 'm1', titulo: 't', descripcion: 'd', evidencias: [] } as never,
        tecnico,
      )).rejects.toThrow(/asignadas/);
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

    it('no acepta nombres de rol antiguos como PULIDOR_FIJO o PULIDOR_MOVIL: solo el rol PULIDOR', async () => {
      for (const namerol of ['PULIDOR_FIJO', 'PULIDOR_MOVIL']) {
        const { service } = build({
          user: { findUnique: vi.fn().mockResolvedValue({ id: 'pul-3', estado: 1, role: { namerol } }) },
        });
        await expect(
          service.asignarOperador({ maquinariaId: 'm1', operadorId: 'pul-3' } as never, admin),
        ).rejects.toThrow(/solo.*pulidor/i);
      }
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

    it('al dar de baja, avisa al líder de la agencia + coordinador de mantenimiento/supervisor de su región + admin/super admin', async () => {
      const { service, prisma, notifications } = build();
      prisma.user.findMany.mockResolvedValue([{ id: 'lider-1' }]);
      notifications.resolverDestinatariosPorRol.mockResolvedValue(['coord-mant-1', 'sup-costa-1', 'adm-1']);

      await service.setActiva({ maquinariaId: 'm1', activa: false, motivo: 'Irreparable' } as never, admin);

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { estado: 1, agenciaId: 'ag-1', role: { namerol: { in: ['LIDER', 'BACKUP'] } } },
        select: { id: true },
      });
      expect(notifications.resolverDestinatariosPorRol).toHaveBeenCalledWith({
        global: ['ADMIN', 'SUPER_ADMIN'],
        regionales: ['COORD_MANTENIMIENTO', 'SUPERVISOR'],
        regionId: 'costa',
      });
      const [ids] = notifications.notificarUsuarios.mock.calls[0];
      expect(ids).toEqual(expect.arrayContaining(['lider-1', 'coord-mant-1', 'sup-costa-1', 'adm-1']));
    });

    it('al reactivar una máquina no se notifica (no se perdió ningún equipo)', async () => {
      const { service, notifications, prisma } = build();
      prisma.maquinaria.findUnique.mockResolvedValue({ ...maquina(), activa: false });
      await service.setActiva({ maquinariaId: 'm1', activa: true } as never, admin);
      expect(notifications.notificarUsuarios).not.toHaveBeenCalled();
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

    it('un coordinador no puede mover una máquina a una agencia de otra región (solo admin cambia de región)', async () => {
      const { service, prisma } = build({
        agencia: { findUnique: vi.fn().mockResolvedValue({ id: 'ag-9', nombre: 'Quito', tipoUbicacion: 'OPERATIVA', regionId: 'sierra' }) },
      });
      await expect(service.transferirMaquinaria(
        { maquinariaId: 'm1', destinoAgenciaId: 'ag-9', motivo: 'x' } as never,
        coordCosta,
      )).rejects.toThrow(/fuera de tu región/);
    });

    it('un admin sí puede mover una máquina a una agencia de otra región (cambiar región)', async () => {
      const { service } = build({
        agencia: { findUnique: vi.fn().mockResolvedValue({ id: 'ag-9', nombre: 'Quito', tipoUbicacion: 'OPERATIVA', regionId: 'sierra' }) },
      });
      await expect(service.transferirMaquinaria(
        { maquinariaId: 'm1', destinoAgenciaId: 'ag-9', motivo: 'x' } as never,
        admin,
      )).resolves.toBeDefined();
    });

    it('un coordinador no puede asignar la máquina a un pulidor de otra región', async () => {
      const { service } = build({
        user: { findUnique: vi.fn().mockResolvedValue({ id: 'pul-9', estado: 1, regionId: null, agencia: { regionId: 'sierra' }, role: { namerol: 'PULIDOR' } }) },
      });
      await expect(
        service.asignarOperador({ maquinariaId: 'm1', operadorId: 'pul-9' } as never, coordCosta),
      ).rejects.toThrow(/tu región/);
    });

    it('un coordinador sí puede asignar la máquina a un pulidor de su misma región', async () => {
      const { service } = build({
        user: { findUnique: vi.fn().mockResolvedValue({ id: 'pul-costa', estado: 1, regionId: null, agencia: { regionId: 'costa' }, role: { namerol: 'PULIDOR' } }) },
      });
      await expect(
        service.asignarOperador({ maquinariaId: 'm1', operadorId: 'pul-costa' } as never, coordCosta),
      ).resolves.toBeDefined();
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

  describe('limpieza de maquinaria', () => {
    const fotoReal = 'maquinaria/mq-01/limpiezas/foto1.jpg';

    it('el pulidor asignado registra la limpieza de su máquina como tipo PULIDOR', async () => {
      const { service, tx } = build(); // maquina() por defecto tiene operadorAsignadoId: 'pul-1'
      const r: any = await service.registrarLimpieza(
        { maquinariaId: 'm1', fotos: [{ url: fotoReal }] } as never,
        pulidor,
      );
      expect(r.success).toBe(true);
      expect(tx.limpiezaMaquinaria.create).toHaveBeenCalledTimes(1);
      const data = tx.limpiezaMaquinaria.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ maquinariaId: 'm1', tipo: 'PULIDOR', fotos: [fotoReal], registradoPorId: 'pul-1' });
    });

    it('otro pulidor no puede registrar la limpieza de una máquina que no tiene asignada', async () => {
      const { service } = build();
      const otroPulidor: Actor = { id: 'pul-2', rol: 'PULIDOR', regionId: null, agenciaId: null };
      await expect(
        service.registrarLimpieza({ maquinariaId: 'm1', fotos: [{ url: fotoReal }] } as never, otroPulidor),
      ).rejects.toThrow(ForbiddenException);
    });

    it('el líder registra la limpieza de una máquina de su agencia (sin pulidor asignado) como tipo AGENCIA', async () => {
      const { service, prisma, tx } = build();
      prisma.maquinaria.findUnique.mockResolvedValue(maquina({ operadorAsignadoId: null }));
      prisma.maquinaria.count = vi.fn().mockResolvedValue(1); // la máquina está en su ámbito
      const r: any = await service.registrarLimpieza(
        { maquinariaId: 'm1', fotos: [{ url: fotoReal }], observaciones: 'Todo en orden' } as never,
        lider,
      );
      expect(r.success).toBe(true);
      const data = tx.limpiezaMaquinaria.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ tipo: 'AGENCIA', registradoPorId: 'lider-1', observaciones: 'Todo en orden' });
    });

    it('el líder de otra agencia no puede registrar la limpieza', async () => {
      const { service, prisma } = build();
      prisma.maquinaria.findUnique.mockResolvedValue(maquina({ operadorAsignadoId: null }));
      prisma.maquinaria.count = vi.fn().mockResolvedValue(0); // fuera de su ámbito
      const otroLider: Actor = { id: 'lider-2', rol: 'LIDER', regionId: null, agenciaId: 'ag-9' };
      await expect(
        service.registrarLimpieza({ maquinariaId: 'm1', fotos: [{ url: fotoReal }] } as never, otroLider),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rechaza si la máquina no tiene agencia ni pulidor asignado (sin regla)', async () => {
      const { service, prisma } = build();
      prisma.maquinaria.findUnique.mockResolvedValue(maquina({ agenciaId: null, operadorAsignadoId: null, agencia: null }));
      await expect(
        service.registrarLimpieza({ maquinariaId: 'm1', fotos: [{ url: fotoReal }] } as never, admin),
      ).rejects.toThrow(/no le aplica/);
    });

    it('si ya hay un registro del mismo día, las fotos nuevas se agregan a las que ya estaban', async () => {
      const { service, tx } = build({
        limpiezaMaquinaria: {
          findUnique: vi.fn().mockResolvedValue({ id: 'lim-0', fotos: ['foto-previa.jpg'], observaciones: null }),
        },
      });
      await service.registrarLimpieza({ maquinariaId: 'm1', fotos: [{ url: fotoReal }] } as never, pulidor);
      expect(tx.limpiezaMaquinaria.create).not.toHaveBeenCalled();
      expect(tx.limpiezaMaquinaria.update).toHaveBeenCalledTimes(1);
      const data = tx.limpiezaMaquinaria.update.mock.calls[0][0].data;
      expect(data.fotos).toEqual(['foto-previa.jpg', fotoReal]);
    });

    it('ni admin ni super admin pueden registrar la limpieza: solo la registra quien de verdad la hace', async () => {
      const { service } = build(); // maquina() por defecto sí tiene regla (operadorAsignadoId: 'pul-1')
      const superAdmin: Actor = { id: 'sa-1', rol: 'SUPER_ADMIN', regionId: null, agenciaId: null };
      await expect(
        service.registrarLimpieza({ maquinariaId: 'm1', fotos: [{ url: fotoReal }] } as never, admin),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.registrarLimpieza({ maquinariaId: 'm1', fotos: [{ url: fotoReal }] } as never, superAdmin),
      ).rejects.toThrow(ForbiddenException);
    });

    it('listLimpiezas acota por el alcance del actor (coordinador: su región)', async () => {
      const { service, prisma } = build();
      await service.listLimpiezas({} as never, coordCosta);
      const where = prisma.limpiezaMaquinaria.findMany.mock.calls[0][0].where;
      expect(JSON.stringify(where)).toContain('"regionId":"costa"');
    });

    it('listLimpiezas no acota al coordinador de bodega (ve todo el país)', async () => {
      const { service, prisma } = build();
      await service.listLimpiezas({} as never, coordBodega);
      const where = prisma.limpiezaMaquinaria.findMany.mock.calls[0][0].where;
      expect(where.maquinaria).toEqual({});
    });

    it('listLimpiezas acota al coordinador comercial por su región', async () => {
      const { service, prisma } = build();
      await service.listLimpiezas({} as never, coordComercialCosta);
      const where = prisma.limpiezaMaquinaria.findMany.mock.calls[0][0].where;
      expect(JSON.stringify(where)).toContain('"regionId":"costa"');
    });

    it('listLimpiezas acota al líder por su agencia (puede ver el historial de la máquina que registra)', async () => {
      const { service, prisma } = build();
      await service.listLimpiezas({} as never, lider);
      const where = prisma.limpiezaMaquinaria.findMany.mock.calls[0][0].where;
      expect(JSON.stringify(where)).toContain('"agenciaId":"ag-1"');
    });

    it('listLimpiezas acota al pulidor a lo que tiene asignado', async () => {
      const { service, prisma } = build();
      await service.listLimpiezas({} as never, pulidor);
      const where = prisma.limpiezaMaquinaria.findMany.mock.calls[0][0].where;
      expect(JSON.stringify(where)).toContain('"operadorAsignadoId":"pul-1"');
    });

    it('resumenLimpiezas cuenta solo las máquinas atrasadas dentro del alcance del actor', async () => {
      const unDiaMs = 86_400_000;
      const hoy = new Date();
      const { service, prisma } = build({
        maquinaria: {
          findMany: vi.fn().mockResolvedValue([
            { id: 'm1', agenciaId: null, operadorAsignadoId: 'pul-1' }, // regla PULIDOR
            { id: 'm2', agenciaId: 'ag-1', operadorAsignadoId: null }, // regla AGENCIA
          ]),
        },
        limpiezaMaquinaria: {
          groupBy: vi.fn().mockResolvedValue([
            { maquinariaId: 'm1', _max: { fecha: new Date(hoy.getTime() - unDiaMs) } }, // ayer: atrasada (regla diaria)
            // m2 sin ninguna limpieza registrada: también cuenta como atrasada
          ]),
        },
      });
      const r: any = await service.resumenLimpiezas(pulidor);
      expect(prisma.maquinaria.findMany).toHaveBeenCalledTimes(1);
      expect(r).toEqual({ success: true, pendientes: 2 });
    });

    describe('editar, eliminar y exportar', () => {
      const registro = (over: Record<string, unknown> = {}) => ({
        id: 'lim-1',
        maquinariaId: 'm1',
        fecha: new Date('2026-01-01T00:00:00.000Z'),
        tipo: 'PULIDOR',
        fotos: ['foto1.jpg'],
        observaciones: 'Obs original',
        registradoPorId: 'pul-1',
        maquinaria: maquina(),
        registradoPor: { id: 'pul-1', name: 'P', lastname: 'U' },
        ...over,
      });

      it('el coordinador de mantenimiento de la misma región puede editar las observaciones', async () => {
        const { service, tx } = build({
          limpiezaMaquinaria: { findUnique: vi.fn().mockResolvedValue(registro()) },
        });
        const r: any = await service.editarLimpieza(
          { limpiezaId: 'lim-1', observaciones: 'Nueva observación' } as never,
          coordCosta,
        );
        expect(r.success).toBe(true);
        expect(tx.limpiezaMaquinaria.update).toHaveBeenCalledWith(
          expect.objectContaining({ where: { id: 'lim-1' }, data: { observaciones: 'Nueva observación' } }),
        );
        expect(tx.maquinariaEvento.create).toHaveBeenCalledTimes(1);
      });

      it('un coordinador de otra región no puede editar', async () => {
        const { service } = build({
          limpiezaMaquinaria: { findUnique: vi.fn().mockResolvedValue(registro()) },
        });
        const otroCoord: Actor = { id: 'coord-sierra', rol: 'COORD_MANTENIMIENTO', regionId: 'sierra', agenciaId: null };
        await expect(
          service.editarLimpieza({ limpiezaId: 'lim-1', observaciones: 'x' } as never, otroCoord),
        ).rejects.toThrow(ForbiddenException);
      });

      it('sin "observaciones" en el dto no hay cambios (no toca el registro)', async () => {
        const { service, tx } = build({
          limpiezaMaquinaria: { findUnique: vi.fn().mockResolvedValue(registro()) },
        });
        const r: any = await service.editarLimpieza({ limpiezaId: 'lim-1' } as never, admin);
        expect(r.sinCambios).toBe(true);
        expect(tx.limpiezaMaquinaria.update).not.toHaveBeenCalled();
      });

      it('observaciones en blanco borran el valor existente (null)', async () => {
        const { service, tx } = build({
          limpiezaMaquinaria: { findUnique: vi.fn().mockResolvedValue(registro()) },
        });
        await service.editarLimpieza({ limpiezaId: 'lim-1', observaciones: '   ' } as never, admin);
        expect(tx.limpiezaMaquinaria.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: { observaciones: null } }),
        );
      });

      it('admin puede eliminar un registro de limpieza de cualquier región', async () => {
        const { service, tx } = build({
          limpiezaMaquinaria: { findUnique: vi.fn().mockResolvedValue(registro()) },
        });
        const r: any = await service.eliminarLimpieza({ limpiezaId: 'lim-1', motivo: 'Duplicado' } as never, admin);
        expect(r).toEqual({ success: true });
        expect(tx.limpiezaMaquinaria.delete).toHaveBeenCalledWith({ where: { id: 'lim-1' } });
        expect(tx.maquinariaEvento.create).toHaveBeenCalledTimes(1);
      });

      it('un supervisor de otra región no puede eliminar', async () => {
        const { service } = build({
          limpiezaMaquinaria: { findUnique: vi.fn().mockResolvedValue(registro()) },
        });
        const otroSup: Actor = { id: 'sup-2', rol: 'SUPERVISOR', regionId: 'sierra', agenciaId: null };
        await expect(
          service.eliminarLimpieza({ limpiezaId: 'lim-1' } as never, otroSup),
        ).rejects.toThrow(ForbiddenException);
      });

      it('exportarLimpiezas devuelve hasta 5000 filas dentro del alcance del actor', async () => {
        const { service, prisma } = build();
        prisma.limpiezaMaquinaria.findMany.mockResolvedValue([registro()]);
        const r: any = await service.exportarLimpiezas({} as never, coordCosta);
        expect(r.success).toBe(true);
        expect(r.data).toHaveLength(1);
        expect(prisma.limpiezaMaquinaria.findMany.mock.calls[0][0].take).toBe(5000);
      });
    });
  });
});

describe('MaquinariaService — costo de mantenimiento e incidencias', () => {
  const evidenciasCompletas = [
    { url: 'maquinaria/mq-01/incidentes/inc-1/multimedia/a.jpg' },
    { url: 'maquinaria/mq-01/incidentes/inc-1/documento/a.pdf' },
  ];

  const incidente = (over: Record<string, unknown> = {}) => ({
    id: 'inc-1',
    maquinariaId: 'm1',
    estado: 'ABIERTO',
    tecnicoAsignadoId: 'tec-1',
    resueltoPorId: null,
    reportadoPorId: 'user-reporta',
    fechaReporte: new Date(),
    titulo: 'Fuga de aceite',
    descripcion: 'Fuga visible en el pistón 2',
    gravedad: 'MEDIA',
    solucion: null,
    costoTotal: null,
    maquinaria: maquina(),
    ...over,
  });

  describe('resolverIncidente', () => {
    it('exige el costo para marcar la incidencia como RESUELTO', async () => {
      const { service, prisma } = build();
      prisma.incidenteTecnico.findUnique.mockResolvedValue(incidente());
      await expect(
        service.resolverIncidente({ incidenteId: 'inc-1', solucion: 'Se cambió el retén', evidencias: evidenciasCompletas } as never, tecnico),
      ).rejects.toThrow(/costo de la reparación es obligatorio/);
    });

    it('no exige costo para cancelarla (no hubo reparación que costear)', async () => {
      const { service, prisma, tx } = build();
      prisma.incidenteTecnico.findUnique.mockResolvedValue(incidente());
      await service.resolverIncidente({ incidenteId: 'inc-1', solucion: 'No se pudo atender', estado: 'CANCELADO' } as never, tecnico);
      expect(tx.incidenteTecnico.update.mock.calls[0][0].data.estado).toBe('CANCELADO');
      expect(tx.incidenteTecnico.update.mock.calls[0][0].data.costoTotal).toBeUndefined();
    });

    it('congela el costo informado al resolver', async () => {
      const { service, prisma, tx } = build();
      prisma.incidenteTecnico.findUnique.mockResolvedValue(incidente());
      await service.resolverIncidente(
        { incidenteId: 'inc-1', solucion: 'Se cambió el retén', evidencias: evidenciasCompletas, costoTotal: 35.5 } as never,
        tecnico,
      );
      expect(tx.incidenteTecnico.update.mock.calls[0][0].data.costoTotal).toBe(35.5);
    });

    it('permite resolver sin evidencias cuando el rol no tiene permiso para subirlas', async () => {
      const { service, prisma, tx } = build();
      prisma.incidenteTecnico.findUnique.mockResolvedValue(incidente());
      await service.resolverIncidente(
        { incidenteId: 'inc-1', solucion: 'Se reparó', costoTotal: 35.5, evidencias: [] } as never,
        tecnico,
        false,
      );
      expect(tx.incidenteTecnico.update.mock.calls[0][0].data.estado).toBe('RESUELTO');
    });
  });

  describe('editarMantenimiento — corrección de costo restringida', () => {
    const cargado = (over: Record<string, unknown> = {}) => ({
      id: 'mt1', maquinariaId: 'm1', tecnicoId: 'tec-1', ejecutadoPorId: 'tec-1', estado: 'FINALIZADO',
      observaciones: null, repuestosUsados: null, costoTotal: 50, frecuenciaDias: 30,
      fechaProgramada: new Date(), maquinaria: maquina(), ...over,
    });

    it('el técnico no puede corregir el costo después de ejecutado (se ignora, no hay cambios)', async () => {
      const { service, prisma, tx } = build();
      prisma.mantenimientoMaquinaria.findUnique.mockResolvedValue(cargado());
      const r: any = await service.editarMantenimiento({ mantenimientoId: 'mt1', costoTotal: 999 } as never, tecnico);
      expect(r.sinCambios).toBe(true);
      expect(tx.mantenimientoMaquinaria.update).not.toHaveBeenCalled();
    });

    it('el coordinador de mantenimiento de la misma región sí puede corregirlo', async () => {
      const { service, prisma, tx } = build();
      prisma.mantenimientoMaquinaria.findUnique.mockResolvedValue(cargado());
      await service.editarMantenimiento({ mantenimientoId: 'mt1', costoTotal: 75 } as never, coordCosta);
      expect(tx.mantenimientoMaquinaria.update.mock.calls[0][0].data.costoTotal).toBe(75);
    });

    it('un admin también puede corregirlo', async () => {
      const { service, prisma, tx } = build();
      prisma.mantenimientoMaquinaria.findUnique.mockResolvedValue(cargado());
      await service.editarMantenimiento({ mantenimientoId: 'mt1', costoTotal: 80 } as never, admin);
      expect(tx.mantenimientoMaquinaria.update.mock.calls[0][0].data.costoTotal).toBe(80);
    });
  });

  describe('editarIncidente — corrección de costo restringida', () => {
    const cargado = (over: Record<string, unknown> = {}) => incidente({ estado: 'RESUELTO', resueltoPorId: 'tec-1', costoTotal: 35.5, ...over });

    it('el técnico no puede corregir el costo después de resuelta (se ignora, no hay cambios)', async () => {
      const { service, prisma, tx } = build();
      prisma.incidenteTecnico.findUnique.mockResolvedValue(cargado());
      const r: any = await service.editarIncidente({ incidenteId: 'inc-1', costoTotal: 999 } as never, tecnico);
      expect(r.sinCambios).toBe(true);
      expect(tx.incidenteTecnico.update).not.toHaveBeenCalled();
    });

    it('el coordinador de mantenimiento de la misma región sí puede corregirlo', async () => {
      const { service, prisma, tx } = build();
      prisma.incidenteTecnico.findUnique.mockResolvedValue(cargado());
      await service.editarIncidente({ incidenteId: 'inc-1', costoTotal: 42 } as never, coordCosta);
      expect(tx.incidenteTecnico.update.mock.calls[0][0].data.costoTotal).toBe(42);
    });
  });
});
describe('MaquinariaService — alcance de un rol propio (manda el ámbito del rol)', () => {
  // Un rol creado desde la pantalla de Roles no es ninguno de los oficiales del módulo: antes caía en «no ve nada».
  const propio = (ambito: string, extra: Partial<Actor> = {}): Actor => ({
    id: 'u-propio',
    rol: 'ROL_ACTIVOS_Y_TALLER',
    regionId: null,
    agenciaId: null,
    ambito,
    ...extra,
  });

  it('con ámbito GLOBAL (país) ve toda la maquinaria', () => {
    const { service } = build();
    expect((service as any).scopeMaquinaria(propio('GLOBAL'))).toEqual({});
  });

  it('REGION y AGENCIA acotan por los datos del usuario', () => {
    const { service } = build();
    expect((service as any).scopeMaquinaria(propio('REGION', { regionId: 'costa' }))).toEqual({ agencia: { regionId: 'costa' } });
    expect((service as any).scopeMaquinaria(propio('AGENCIA', { agenciaId: 'ag-1' }))).toEqual({ agenciaId: 'ag-1' });
  });

  it('PROPIO solo deja ver lo que tiene asignado', () => {
    const { service } = build();
    expect((service as any).scopeMaquinaria(propio('PROPIO'))).toEqual({ operadorAsignadoId: 'u-propio' });
  });

  it('sin ámbito no ve nada (falla cerrado)', () => {
    const { service } = build();
    expect((service as any).scopeMaquinaria(propio(undefined as never))).toEqual({ id: '__ninguno__' });
  });

  it('el mismo criterio aplica a incidentes y mantenimientos', () => {
    const { service } = build();
    expect((service as any).scopeIncidentes(propio('REGION', { regionId: 'costa' }))).toEqual({ maquinaria: { agencia: { regionId: 'costa' } } });
    expect((service as any).scopeMantenimientos(propio('AGENCIA', { agenciaId: 'ag-1' }))).toEqual({ maquinaria: { agenciaId: 'ag-1' } });
  });
});