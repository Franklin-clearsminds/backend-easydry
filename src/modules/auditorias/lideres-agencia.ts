import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * Agrega a cada agencia su líder de bahía (el usuario activo con rol LIDER de esa agencia) para que los formularios de auditoría lo
 * marquen solos al elegir la agencia. Solo nombre e id: nunca correo ni teléfono.
 */
export async function agenciasConLider<T extends { id: string }>(prisma: PrismaService, agencias: T[]): Promise<(T & { lider: { id: string; nombre: string } | null })[]> {
  if (!agencias.length) return [];
  const lideres = await prisma.user.findMany({
    where: { estado: 1, agenciaId: { in: agencias.map((a) => a.id) }, role: { namerol: 'LIDER' } },
    select: { id: true, name: true, lastname: true, agenciaId: true },
    orderBy: [{ createdAt: 'asc' }],
  });
  return agencias.map((a) => {
    const l = lideres.find((x) => x.agenciaId === a.id);
    return { ...a, lider: l ? { id: l.id, nombre: `${l.name} ${l.lastname}`.trim() } : null };
  });
}
