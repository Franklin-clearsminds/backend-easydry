import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { dentroDeVentanaRetoque, finVentanaRetoque } from './retoque.js';

/** Estados de un servicio especial que ya terminó (solo estos admiten retoque). */
const ESTADOS_COMPLETADO = ['Completado'];

/**
 * Retoque de un servicio especial: nace ligado a uno ya completado, con su mismo número de OT, y solo hasta el final del
 * segundo día después de completarlo. Como el código `SE-…` de cada fila es único, el retoque lleva el del original más
 * `-R1`, `-R2`… (cada retoque nuevo suma uno).
 */
export async function prepararRetoqueEspecial(
  prisma: PrismaService,
  datos: { codigoBase: string; servicioCatalogoId?: number; ahora: Date },
) {
  const codigoBase = datos.codigoBase.trim().toUpperCase().replace(/-R\d+$/, '');
  const base = await prisma.servicioEspecial.findFirst({
    where: { codigoSE: { equals: codigoBase, mode: 'insensitive' }, deletedAt: null },
    include: { operadoresAsignados: { select: { operadorId: true } } },
  });
  if (!base) throw new NotFoundException(`No existe el servicio especial ${codigoBase} para agregarle un retoque.`);

  if (!ESTADOS_COMPLETADO.includes(base.estado)) {
    throw new BadRequestException(`El servicio especial ${base.codigoSE} aún no está completado: el retoque se agrega cuando ya terminó.`);
  }

  const catalogo = datos.servicioCatalogoId
    ? await prisma.catalogoServicio.findUnique({ where: { id: Number(datos.servicioCatalogoId) }, select: { nombre: true, categoria: true, esRetoque: true } })
    : null;
  if (!catalogo?.esRetoque || catalogo.categoria !== 'ESPECIAL') {
    throw new BadRequestException('Sobre un servicio especial ya completado solo se puede agregar un retoque especial.');
  }

  const completadoEn = base.fechaFin ?? base.updatedAt;
  if (!dentroDeVentanaRetoque(completadoEn, datos.ahora)) {
    throw new BadRequestException(
      `Ya pasó el plazo para agregar un retoque a ${base.codigoSE}: terminó el ${finVentanaRetoque(completadoEn).toISOString().slice(0, 10)}.`,
    );
  }

  const previos = await prisma.servicioEspecial.count({
    where: { codigoSE: { startsWith: `${base.codigoSE}-R`, mode: 'insensitive' }, deletedAt: null },
  });
  return { base, codigoSE: `${base.codigoSE}-R${previos + 1}`, operadoresBase: base.operadoresAsignados.map((o) => o.operadorId) };
}
