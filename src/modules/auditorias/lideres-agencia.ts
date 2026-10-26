import type { PrismaService } from '../prisma/prisma.service.js';
import { FUNCION, funcionesDeRol, rolConFuncion, type CodigoFuncion } from '../../common/permisos/funciones.js';

type Persona = { id: string; nombre: string };
/** Quien puede firmar como líder de bahía: líder, backup asignado a la agencia o auxiliar. */
export type Firmante = Persona & { etiqueta: 'Líder' | 'Backup' | 'Auxiliar' };

/**
 * Agrega a cada agencia su líder de bahía (el usuario activo con la función de líder de esa agencia) y su auxiliar (uno por agencia)
 * para que los formularios de auditoría los marquen o los ofrezcan al elegir la agencia. `firmantes` lista además al backup asignado y a todos los
 * auxiliares (quienes pueden firmar como líder de bahía). Solo nombre e id: nunca correo ni teléfono.
 */
export async function agenciasConLider<T extends { id: string }>(prisma: PrismaService, agencias: T[]): Promise<(T & { lider: Persona | null; auxiliar: Persona | null; firmantes: Firmante[] })[]> {
  if (!agencias.length) return [];
  const personas = await prisma.user.findMany({
    where: { estado: 1, agenciaId: { in: agencias.map((a) => a.id) }, role: rolConFuncion(FUNCION.LIDER, FUNCION.BACKUP, FUNCION.AUXILIAR) },
    select: { id: true, name: true, lastname: true, agenciaId: true, role: { select: { namerol: true, capacidades: true } } },
    orderBy: [{ createdAt: 'asc' }],
  });
  const de = (agenciaId: string, funcion: CodigoFuncion): Persona | null => {
    const u = personas.find((x) => x.agenciaId === agenciaId && funcionesDeRol(x.role?.capacidades, x.role?.namerol).has(funcion));
    return u ? { id: u.id, nombre: `${u.name} ${u.lastname}`.trim() } : null;
  };
  const firmantesDe = (agenciaId: string): Firmante[] => {
    const lista: Firmante[] = [];
    for (const [funcion, etiqueta] of [[FUNCION.LIDER, 'Líder'], [FUNCION.BACKUP, 'Backup'], [FUNCION.AUXILIAR, 'Auxiliar']] as const) {
      for (const u of personas) {
        if (u.agenciaId === agenciaId && funcionesDeRol(u.role?.capacidades, u.role?.namerol).has(funcion) && !lista.some((x) => x.id === u.id)) {
          lista.push({ id: u.id, nombre: `${u.name} ${u.lastname}`.trim(), etiqueta });
        }
      }
    }
    return lista;
  };
  return agencias.map((a) => ({ ...a, lider: de(a.id, FUNCION.LIDER), auxiliar: de(a.id, FUNCION.AUXILIAR), firmantes: firmantesDe(a.id) }));
}
