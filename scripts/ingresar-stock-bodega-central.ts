/**
 * Ingresa stock a la Bodega Central como una compra (mismo efecto que `registrarCompra`): una guía ING-AAAA-NNNN,
 * el stock de cada insumo activo y su línea en el kardex.
 *
 * Uso:  pnpm ingresar-stock-central [unidades]      (por defecto 25 unidades por insumo)
 *
 * Las unidades son envases físicos, como en los despachos: 25 de un insumo de 5.000 ml suman 125.000 ml.
 * Cada ejecución SUMA al stock existente (no lo fija): correrlo dos veces ingresa el doble.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const unidades = Number(process.argv[2] ?? 25);
  if (!Number.isInteger(unidades) || unidades <= 0) {
    throw new Error(`Cantidad inválida "${process.argv[2]}": usa un entero mayor a 0.`);
  }

  const central = await prisma.bodega.findFirst({ where: { OR: [{ tipo: 'CENTRAL' }, { esCentral: true }] } });
  if (!central) throw new Error('No existe la Bodega Central.');

  const usuario = await prisma.user.findFirst({ where: { role: { namerol: 'SUPER_ADMIN' } }, select: { id: true } });
  if (!usuario) throw new Error('No hay un usuario SUPER_ADMIN para registrar el movimiento.');

  const insumos = await prisma.insumo.findMany({ where: { estado: 1 }, orderBy: { nombre: 'asc' } });
  if (insumos.length === 0) throw new Error('No hay insumos activos.');

  const anio = new Date().getFullYear();
  const previos = await prisma.movimientoInventario.count({ where: { numeroGuia: { startsWith: `ING-${anio}` } } });
  const guia = `ING-${anio}-${String(previos + 1).padStart(4, '0')}`;

  await prisma.$transaction(async (tx) => {
    const movimiento = await tx.movimientoInventario.create({
      data: {
        numeroGuia: guia,
        tipo: 'COMPRA_PROVEEDOR',
        estadoDespacho: 'RECIBIDO',
        origenUbicacion: 'Carga inicial de stock',
        destinoUbicacion: central.nombre,
        destinoBodegaId: central.id,
        usuarioDespachaId: usuario.id,
        fechaRecepcion: new Date(),
        observaciones: `Ingreso de ${unidades} unidades por insumo (script ingresar-stock-bodega-central).`,
        detalles: {
          create: insumos.map((i) => ({ insumoId: i.id, cantidadEnviada: unidades, cantidadRecibida: unidades })),
        },
      },
    });

    for (const ins of insumos) {
      const contenido = Number(ins.contenidoNeto) || 1;
      const cantidadBase = Math.round(unidades * contenido * 1000) / 1000;

      const existente = await tx.stockUbicacion.findFirst({
        where: { insumoId: ins.id, tipoUbicacion: 'BODEGA_CENTRAL', OR: [{ bodegaId: central.id }, { bodegaId: null }] },
      });
      const anterior = existente ? Number(existente.cantidadActual) : 0;

      if (existente) {
        await tx.stockUbicacion.update({
          where: { id: existente.id },
          data: { cantidadActual: { increment: cantidadBase }, bodegaId: central.id },
        });
      } else {
        await tx.stockUbicacion.create({
          data: { insumoId: ins.id, tipoUbicacion: 'BODEGA_CENTRAL', bodegaId: central.id, cantidadActual: cantidadBase },
        });
      }

      await tx.kardexMovimiento.create({
        data: {
          insumoId: ins.id,
          ubicacionId: 'BODEGA_CENTRAL',
          tipoMovimiento: 'COMPRA_INGRESO',
          cantidad: cantidadBase,
          stockAnterior: anterior,
          stockPosterior: anterior + cantidadBase,
          referenciaId: movimiento.numeroGuia,
          usuarioId: usuario.id,
        },
      });
    }
  }, { timeout: 120_000, maxWait: 20_000 }); // la base remota (Supabase) tarda más que los 5 s por defecto

  console.log(`✅ Guía ${guia}: ${unidades} unidades de cada uno de los ${insumos.length} insumos ingresadas en "${central.nombre}".`);
}

main()
  .catch((e) => {
    console.error('❌', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
