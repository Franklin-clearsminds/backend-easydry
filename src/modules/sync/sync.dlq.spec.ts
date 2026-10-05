import { describe, expect, it, vi } from 'vitest';
import { SyncService } from './sync.service.js';
import { ROLES_BASE } from '../../common/permisos/roles-base.js';

const usuario = (namerol: string) => {
  const r = ROLES_BASE.find((x) => x.namerol === namerol)!;
  return { id: `id-${namerol}`, name: 'Ana', lastname: namerol, roleDetails: { namerol, capacidades: r.capacidades, ambito: r.ambito } };
};

function armar() {
  const prisma: any = {
    syncDeadLetterQueue: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue({ id: 'd1', mutationId: 'm1', clientUuid: 'c1', payload: {}, entityType: 'servicio_lavado' }),
      update: vi.fn().mockResolvedValue({ id: 'd1', resuelto: true }),
    },
    auditoriaDecision: { create: vi.fn().mockResolvedValue({}) },
  };
  return { prisma, service: new SyncService(prisma, {} as any, {} as any, {} as any) };
}
const donde = (prisma: any) => prisma.syncDeadLetterQueue.findMany.mock.calls[0][0].where;

describe('cola de errores de sincronización (DLQ)', () => {
  it('cada usuario ve solo los errores de su propia sincronización', async () => {
    for (const rol of ['LIDER', 'PULIDOR', 'APROBADOR', 'TECNICO']) {
      const { prisma, service } = armar();
      await service.listDeadLetterQueue(false, usuario(rol));
      expect(donde(prisma)).toMatchObject({ resuelto: false, usuarioId: `id-${rol}` });
    }
  });

  it('administradores y súper administradores ven los de todos', async () => {
    for (const rol of ['ADMIN', 'SUPER_ADMIN']) {
      const { prisma, service } = armar();
      await service.listDeadLetterQueue(undefined, usuario(rol));
      expect(donde(prisma)).not.toHaveProperty('usuarioId');
    }
  });

  it('sin usuario no se ve ningún error', async () => {
    const { prisma, service } = armar();
    await service.listDeadLetterQueue();
    expect(donde(prisma).usuarioId).toBe('__ninguno__');
  });

  it('resolver un error deja registrado quién lo hizo', async () => {
    const { prisma, service } = armar();
    await service.resolveDeadLetterItem('d1', true, usuario('ADMIN'));
    expect(prisma.auditoriaDecision.create.mock.calls[0][0].data).toMatchObject({
      entidad: 'SYNC_DLQ', entidadId: 'd1', accion: 'RESOLVER', usuarioId: 'id-ADMIN', rol: 'ADMIN',
    });
  });
});
