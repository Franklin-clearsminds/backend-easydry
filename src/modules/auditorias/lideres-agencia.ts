import type { PrismaService } from '../prisma/prisma.service.js';

type Persona = { id: string; nombre: string };

/**
 * Agrega a cada agencia su líder de bahía (el usuario activo con rol LIDER de esa agencia) y su auxiliar (rol AUXILIAR, uno por agencia)
 * para que los formularios de auditoría los marquen o los ofrezcan al elegir la agencia. Solo nombre e id: nunca correo ni teléfono.
 */
export async function agenciasConLider<T extends { id: string }>(prisma: PrismaService, agencias: T[]): Promise<(T & { lider: Persona | null; auxiliar: Persona | null })[]> {
  if (!agencias.length) return [];
  const personas = await prisma.user.findMany({
    where: { estado: 1, agenciaId: { in: agencias.map((a) => a.id) }, role: { namerol: { in: ['LIDER', 'AUXILIAR'] } } },
    select: { id: true, name: true, lastname: true, agenciaId: true, role: { select: { namerol: true } } },
    orderBy: [{ createdAt: 'asc' }],
  });
  const de = (agenciaId: string, rol: string): Persona | null => {
    const u = personas.find((x) => x.agenciaId === agenciaId && x.role?.namerol === rol);
    return u ? { id: u.id, nombre: `${u.name} ${u.lastname}`.trim() } : null;
  };
  return agencias.map((a) => ({ ...a, lider: de(a.id, 'LIDER'), auxiliar: de(a.id, 'AUXILIAR') }));
}
