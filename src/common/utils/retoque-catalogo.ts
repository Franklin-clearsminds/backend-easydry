import type { PrismaClient } from '@prisma/client';

/** Tiempo estimado del retoque, en minutos. */
export const TIEMPO_RETOQUE_MIN = 15;

/**
 * Servicios de catálogo que sostienen el retoque (ver `retoque.ts` y `retoque-especial.ts`). La migración `retoque_servicio` los crea
 * (con 30 y 60 min) y el seed los deja como deben estar. La API no deja cambiarles el código ni la categoría, ni desactivarlos: sin
 * ellos no hay retoque.
 *  - GENERAL: el líder de agencia lo agrega a una OT general ya finalizada.
 *  - ESPECIAL: el pulidor lo agrega a un servicio especial ya completado.
 * Se crean sin receta de insumos (por ahora no descuentan nada).
 * `anteriores`: códigos con los que se crearon a mano en algunas bases; se adoptan o se retiran para no dejar duplicados.
 * `tiempoMigracion`: el tiempo con que los crea la migración; si sigue así, nadie lo ajustó y pasa a 15 min.
 */
export const SERVICIOS_RETOQUE = [
  { codigo: 'RETOQUE-GEN', nombre: 'RETOQUE', categoria: 'GENERAL', anteriores: ['SER-RETOQUE'], tiempoMigracion: 30 },
  { codigo: 'RETOQUE-ESP', nombre: 'RETOQUE ESPECIAL', categoria: 'ESPECIAL', anteriores: ['SER-RETOQUE-ESP'], tiempoMigracion: 60 },
] as const;

export const CODIGOS_RETOQUE: readonly string[] = SERVICIOS_RETOQUE.flatMap((s) => [s.codigo, ...s.anteriores]);

/**
 * Deja los servicios de retoque como deben estar y los ofrece a las agencias. Idempotente:
 *  - los crea si faltan (15 min, sin receta, precio 0: el precio de cada agencia lo fija un administrador);
 *  - si solo existe uno con el código anterior, lo adopta (le pone el código oficial) y si hay duplicados sin uso los retira;
 *  - en los que ya existen restablece lo que no se debe tocar (`esRetoque`, categoría y estado Activo) y baja a 15 min el tiempo que
 *    dejó la migración; no pisa el nombre, el precio ni la receta que un administrador haya ajustado;
 *  - suma el retoque general a todas las agencias y el especial a las que tienen servicios especiales.
 */
export async function asegurarServiciosRetoque(prisma: PrismaClient): Promise<void> {
  const ids: Record<string, number> = {};
  const retirados: number[] = [];

  for (const s of SERVICIOS_RETOQUE) {
    let fila = await prisma.catalogoServicio.findUnique({ where: { codigo: s.codigo }, select: { id: true, tiempoEstimadoMin: true } });
    const anteriores = await prisma.catalogoServicio.findMany({
      where: { codigo: { in: [...s.anteriores] } },
      orderBy: { id: 'asc' },
      select: { id: true, codigo: true },
    });

    if (!fila && anteriores.length > 0) {
      const adoptado = anteriores.shift()!;
      fila = await prisma.catalogoServicio.update({ where: { id: adoptado.id }, data: { codigo: s.codigo }, select: { id: true, tiempoEstimadoMin: true } });
    }

    if (!fila) {
      fila = await prisma.catalogoServicio.create({
        data: {
          codigo: s.codigo,
          nombre: s.nombre,
          categoria: s.categoria,
          descripcion: 'Retoque de una OT finalizada: se agrega hasta 2 días después de finalizada y se puede repetir.',
          precio: 0,
          tiempoEstimadoMin: TIEMPO_RETOQUE_MIN,
          esRetoque: true,
          estado: 'Activo',
        },
        select: { id: true, tiempoEstimadoMin: true },
      });
    } else {
      await prisma.catalogoServicio.update({
        where: { id: fila.id },
        data: {
          esRetoque: true,
          categoria: s.categoria,
          estado: 'Activo',
          ...(fila.tiempoEstimadoMin === s.tiempoMigracion ? { tiempoEstimadoMin: TIEMPO_RETOQUE_MIN } : {}),
        },
      });
    }
    ids[s.categoria] = fila.id;

    // Duplicados con el código anterior: solo se retiran si nadie los usa.
    for (const dup of anteriores) {
      const [lavado, especial, recetas, precios, retos] = await Promise.all([
        prisma.servicioLavado.count({ where: { servicioCatalogoId: dup.id } }),
        prisma.servicioEspecial.count({ where: { servicioCatalogoId: dup.id } }),
        prisma.recetaInsumo.count({ where: { catalogoServicioId: dup.id } }),
        prisma.precioAgenciaServicio.count({ where: { catalogoServicioId: dup.id } }),
        prisma.reto.count({ where: { catalogoServicioId: dup.id } }).catch(() => 0),
      ]);
      if (lavado + especial + recetas + precios + retos === 0) {
        await prisma.catalogoServicio.delete({ where: { id: dup.id } });
        retirados.push(dup.id);
      } else {
        console.warn(`   ⚠ El servicio ${dup.codigo} (id ${dup.id}) duplica al retoque oficial pero tiene uso: revísalo a mano.`);
      }
    }
  }

  const agencias = await prisma.agencia.findMany({ select: { id: true, servicioIds: true, serviciosNombres: true, tieneServiciosEspeciales: true } });
  for (const a of agencias) {
    const actuales = Array.isArray(a.servicioIds) ? (a.servicioIds as unknown[]).map(Number) : [];
    const sinRetirados = actuales.filter((id) => !retirados.includes(id));
    const deseados = [ids.GENERAL, ...(a.tieneServiciosEspeciales ? [ids.ESPECIAL] : [])];
    const faltan = deseados.filter((id) => !sinRetirados.includes(id));
    if (faltan.length === 0 && sinRetirados.length === actuales.length) continue;
    const nuevos = [...sinRetirados, ...faltan];
    const catalogo = await prisma.catalogoServicio.findMany({ where: { id: { in: nuevos } }, select: { nombre: true } });
    await prisma.agencia.update({
      where: { id: a.id },
      data: { servicioIds: nuevos, serviciosNombres: catalogo.map((c) => c.nombre) },
    });
  }
}

/** Ids de los servicios de retoque de una categoría (para no quitarlos de la lista de servicios de una agencia). */
export async function idsServiciosRetoque(prisma: Pick<PrismaClient, 'catalogoServicio'>, categoria?: 'GENERAL' | 'ESPECIAL'): Promise<number[]> {
  const filas = await prisma.catalogoServicio.findMany({
    where: { codigo: { in: SERVICIOS_RETOQUE.map((s) => s.codigo) }, ...(categoria ? { categoria } : {}) },
    select: { id: true },
  });
  return filas.map((f) => f.id);
}
