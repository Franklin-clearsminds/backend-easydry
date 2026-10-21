import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * Reglas de los lavadores de una OT cuando la app manda varios (`operadorIds`):
 *  - todos existen, están activos y son de la agencia de la bahía;
 *  - no pueden ser más que el máximo de lavadores por bahía que tiene configurado la agencia;
 *  - si la bahía tiene lavadores asignados, solo se puede elegir entre ellos (marcar todos o una parte);
 *    si no tiene ninguno asignado, se puede elegir cualquiera de la agencia (uno o más).
 */
export async function validarLavadoresDeLaOT(
  prisma: PrismaService,
  datos: { bahiaId: string; agenciaId: string | null | undefined; operadorIds: string[] },
): Promise<void> {
  const ids = [...new Set(datos.operadorIds.filter(Boolean))];
  if (ids.length === 0) return;

  const [usuarios, agencia, asignaciones] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, agenciaId: true, estado: true } }),
    datos.agenciaId
      ? prisma.agencia.findUnique({ where: { id: datos.agenciaId }, select: { maxLavadoresPorBahia: true } })
      : Promise.resolve(null),
    prisma.bahiaOperador.findMany({ where: { bahiaId: datos.bahiaId, activo: true }, select: { operadorId: true } }),
  ]);

  if (usuarios.length !== ids.length) {
    throw new BadRequestException('Uno o más lavadores seleccionados ya no existen.');
  }
  if (usuarios.some((u) => String(u.agenciaId || '') !== String(datos.agenciaId || ''))) {
    throw new BadRequestException('Todos los lavadores seleccionados deben pertenecer a la agencia de la bahía.');
  }
  if (usuarios.some((u) => u.estado !== 1)) {
    throw new BadRequestException('Uno o más lavadores seleccionados están inactivos.');
  }

  const maximo = Math.max(1, agencia?.maxLavadoresPorBahia ?? 1);
  if (ids.length > maximo) {
    throw new BadRequestException(`Esta agencia permite hasta ${maximo} lavador(es) por bahía; seleccionaste ${ids.length}.`);
  }

  const asignados = new Set(asignaciones.map((a) => a.operadorId));
  if (asignados.size > 0 && ids.some((id) => !asignados.has(id))) {
    throw new BadRequestException('Esta bahía tiene lavadores asignados: solo puedes elegir entre ellos.');
  }
}
