import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Iniciando siembra de Insumos y Servicios EasyDry ---');

  // 1. Obtener Unidades de Medida y Tipos de Producto
  const unidades = await prisma.unidadMedida.findMany();
  const unidadL = unidades.find(u => u.simbolo.toLowerCase() === 'l') || unidades[0];
  const unidadML = unidades.find(u => u.simbolo.toLowerCase() === 'ml') || unidadL;
  const unidadKG = unidades.find(u => u.simbolo.toLowerCase() === 'kg') || unidadL;
  const unidadUND = unidades.find(u => u.simbolo.toLowerCase() === 'und') || unidadL;

  const tipos = await prisma.tipoProducto.findMany();
  const tipoLiquido = tipos.find(t => t.codigo === 'LIQUIDO') || tipos[0];
  const tipoSolido = tipos.find(t => t.codigo === 'SOLIDO') || tipoLiquido;
  const tipoTextil = tipos.find(t => t.codigo === 'TEXTIL') || tipoLiquido;
  const tipoUnidad = tipos.find(t => t.codigo === 'UNIDAD') || tipoLiquido;

  // 2. Definir los insumos requeridos
  const insumosData = [
    {
      codigoSKU: 'INS-LAV-001',
      nombre: 'Shampoo Bio-Espuma Concentrado',
      categoria: 'QUIMICOS_LAVADO',
      descripcion: 'Shampoo biodegradable pH neutro con alta densidad de espuma para lavado en seco.',
      unidadMedidaId: unidadL.id,
      tipoProductoId: tipoLiquido.id,
      contenidoNeto: 5,
      stockActual: 150,
      stockMinimoBodega: 25,
      stockMinimoAgencia: 5,
      stockOptimoBodega: 200,
      costoUnitarioUSD: 8.5,
    },
    {
      codigoSKU: 'INS-CER-002',
      nombre: 'Cera Carnauba Líquida High Gloss',
      categoria: 'CERAS_SELLADORES',
      descripcion: 'Emulsión de cera carnauba natural con polímeros sintéticos de brillo profundo.',
      unidadMedidaId: unidadL.id,
      tipoProductoId: tipoLiquido.id,
      contenidoNeto: 1,
      stockActual: 80,
      stockMinimoBodega: 15,
      stockMinimoAgencia: 3,
      stockOptimoBodega: 100,
      costoUnitarioUSD: 14.2,
    },
    {
      codigoSKU: 'INS-DES-003',
      nombre: 'Desengrasante Multiuso Citrus Cleaner',
      categoria: 'DESENGRASANTES',
      descripcion: 'Desengrasante biodegradable concentrado a base de d-limoneno para llantas y chasis.',
      unidadMedidaId: unidadL.id,
      tipoProductoId: tipoLiquido.id,
      contenidoNeto: 20,
      stockActual: 120,
      stockMinimoBodega: 20,
      stockMinimoAgencia: 4,
      stockOptimoBodega: 150,
      costoUnitarioUSD: 9.8,
    },
    {
      codigoSKU: 'INS-VID-004',
      nombre: 'Limpiavidrios Anti-Empañante Pro',
      categoria: 'QUIMICOS_LAVADO',
      descripcion: 'Fórmula sin amoniaco con efecto repelente de lluvia y anti-empañante.',
      unidadMedidaId: unidadL.id,
      tipoProductoId: tipoLiquido.id,
      contenidoNeto: 1,
      stockActual: 65,
      stockMinimoBodega: 10,
      stockMinimoAgencia: 2,
      stockOptimoBodega: 80,
      costoUnitarioUSD: 6.0,
    },
    {
      codigoSKU: 'INS-LLA-005',
      nombre: 'Acondicionador de Llantas Black Shine',
      categoria: 'CERAS_SELLADORES',
      descripcion: 'Gel restaurador de caucho y plásticos exteriores con protección UV y acabado satinado.',
      unidadMedidaId: unidadL.id,
      tipoProductoId: tipoLiquido.id,
      contenidoNeto: 1,
      stockActual: 90,
      stockMinimoBodega: 15,
      stockMinimoAgencia: 3,
      stockOptimoBodega: 110,
      costoUnitarioUSD: 11.5,
    },
    {
      codigoSKU: 'INS-AMB-006',
      nombre: 'Neutralizador y Ambientador Fresh Car',
      categoria: 'QUIMICOS_LAVADO',
      descripcion: 'Desodorizante de interiores que elimina bacterias de raíz con aroma cítrico fresco.',
      unidadMedidaId: unidadML.id,
      tipoProductoId: tipoLiquido.id,
      contenidoNeto: 500,
      stockActual: 5000,
      stockMinimoBodega: 800,
      stockMinimoAgencia: 200,
      stockOptimoBodega: 8000,
      costoUnitarioUSD: 0.05,
    },
    {
      codigoSKU: 'INS-PUL-007',
      nombre: 'Pasta de Pulir Heavy Cut (Paso 1)',
      categoria: 'PULIMENTOS',
      descripcion: 'Compuesto abrasivo de corte agresivo para eliminar rayas P1500 y oxidación severa.',
      unidadMedidaId: unidadKG.id,
      tipoProductoId: tipoSolido.id,
      contenidoNeto: 1,
      stockActual: 35,
      stockMinimoBodega: 8,
      stockMinimoAgencia: 2,
      stockOptimoBodega: 40,
      costoUnitarioUSD: 32.0,
    },
    {
      codigoSKU: 'INS-PUL-008',
      nombre: 'Pasta de Pulir Final Polish (Paso 2)',
      categoria: 'PULIMENTOS',
      descripcion: 'Pulimento ultrafino para eliminación de hologramas y acabado espejo cristalino.',
      unidadMedidaId: unidadKG.id,
      tipoProductoId: tipoSolido.id,
      contenidoNeto: 1,
      stockActual: 40,
      stockMinimoBodega: 8,
      stockMinimoAgencia: 2,
      stockOptimoBodega: 45,
      costoUnitarioUSD: 35.0,
    },
    {
      codigoSKU: 'INS-CER-009',
      nombre: 'Sellador Cerámico 9H Diamond Shield',
      categoria: 'CERAS_SELLADORES',
      descripcion: 'Recubrimiento nano-cerámico de dureza 9H con durabilidad química de hasta 3 años.',
      unidadMedidaId: unidadML.id,
      tipoProductoId: tipoLiquido.id,
      contenidoNeto: 50,
      stockActual: 1200,
      stockMinimoBodega: 200,
      stockMinimoAgencia: 50,
      stockOptimoBodega: 1500,
      costoUnitarioUSD: 0.95,
    },
    {
      codigoSKU: 'INS-TAP-010',
      nombre: 'Limpiador y Nutridor de Cuero Premium',
      categoria: 'QUIMICOS_LAVADO',
      descripcion: 'Fórmula hidratante para asientos y guarnecidos de cuero con vitamina E.',
      unidadMedidaId: unidadML.id,
      tipoProductoId: tipoLiquido.id,
      contenidoNeto: 500,
      stockActual: 3000,
      stockMinimoBodega: 500,
      stockMinimoAgencia: 100,
      stockOptimoBodega: 4000,
      costoUnitarioUSD: 0.08,
    },
    {
      codigoSKU: 'INS-TEX-011',
      nombre: 'Toalla Microfibra 40x40cm 600 GSM',
      categoria: 'TEXTILES',
      descripcion: 'Toalla de microfibra de alta densidad sin bordes para secado y lustre sin rayones.',
      unidadMedidaId: unidadUND.id,
      tipoProductoId: tipoTextil.id,
      contenidoNeto: 1,
      stockActual: 400,
      stockMinimoBodega: 50,
      stockMinimoAgencia: 10,
      stockOptimoBodega: 500,
      costoUnitarioUSD: 2.2,
    },
    {
      codigoSKU: 'INS-ACC-012',
      nombre: 'Pad de Pulido Lana Espuma 5 Pulgadas',
      categoria: 'ACCESORIOS',
      descripcion: 'Almohadilla de pulido intercambiable para rotativa y roto-orbital.',
      unidadMedidaId: unidadUND.id,
      tipoProductoId: tipoUnidad.id,
      contenidoNeto: 1,
      stockActual: 80,
      stockMinimoBodega: 15,
      stockMinimoAgencia: 4,
      stockOptimoBodega: 100,
      costoUnitarioUSD: 9.5,
    }
  ];

  const insumosMap = new Map<string, any>();

  for (const ins of insumosData) {
    const existing = await prisma.insumo.findUnique({ where: { codigoSKU: ins.codigoSKU } });
    if (existing) {
      const updated = await prisma.insumo.update({
        where: { id: existing.id },
        data: ins,
      });
      insumosMap.set(ins.codigoSKU, updated);
      console.log(`[Insumo Actualizado] ${ins.codigoSKU} - ${ins.nombre}`);
    } else {
      const created = await prisma.insumo.create({
        data: ins,
      });
      insumosMap.set(ins.codigoSKU, created);
      console.log(`[Insumo Creado] ${ins.codigoSKU} - ${ins.nombre}`);
    }
  }

  // 3. Crear / Actualizar Servicios de Catálogo
  // Limpiar servicios especiales extras si existieran más de 3
  const serviciosEspecialesExistentes = await prisma.catalogoServicio.findMany({
    where: { categoria: 'ESPECIAL' },
  });
  const codigosEspecialesDeseados = ['ESP-001', 'ESP-002', 'ESP-003'];
  for (const s of serviciosEspecialesExistentes) {
    if (!codigosEspecialesDeseados.includes(s.codigo)) {
      await prisma.recetaInsumo.deleteMany({ where: { catalogoServicioId: s.id } });
      await prisma.catalogoServicio.delete({ where: { id: s.id } });
      console.log(`[Servicio Especial Excedente Eliminado] ${s.codigo} - ${s.nombre}`);
    }
  }

  // Servicios Generales
  const serviciosGeneralesData = [
    {
      codigo: 'SER-001',
      nombre: 'Lavado Express Ecológico',
      categoria: 'GENERAL',
      descripcion: 'Lavado exterior en seco con formulación bio-degradable, limpieza de rines y vidrios exteriores.',
      precio: 8.0,
      tiempoEstimadoMin: 20,
      receta: [
        { sku: 'INS-LAV-001', cant: 0.15, unidadId: unidadL.id },
        { sku: 'INS-TEX-011', cant: 1, unidadId: unidadUND.id }
      ]
    },
    {
      codigo: 'SER-002',
      nombre: 'Lavado Completo con Cera Carnauba',
      categoria: 'GENERAL',
      descripcion: 'Lavado exterior ecológico, aspirado completo de habitáculo y maletero, encerado carnauba y brillo de llantas.',
      precio: 14.0,
      tiempoEstimadoMin: 35,
      receta: [
        { sku: 'INS-LAV-001', cant: 0.25, unidadId: unidadL.id },
        { sku: 'INS-CER-002', cant: 0.20, unidadId: unidadL.id },
        { sku: 'INS-LLA-005', cant: 0.10, unidadId: unidadL.id },
        { sku: 'INS-TEX-011', cant: 1, unidadId: unidadUND.id }
      ]
    },
    {
      codigo: 'SER-003',
      nombre: 'Lavado y Desinfección de Interiores',
      categoria: 'GENERAL',
      descripcion: 'Limpieza profunda de paneles, consola central, aspirado anti-ácaros y neutralización antibacterial de cabina.',
      precio: 22.0,
      tiempoEstimadoMin: 45,
      receta: [
        { sku: 'INS-DES-003', cant: 0.15, unidadId: unidadL.id },
        { sku: 'INS-AMB-006', cant: 30, unidadId: unidadML.id },
        { sku: 'INS-TEX-011', cant: 1, unidadId: unidadUND.id }
      ]
    },
    {
      codigo: 'SER-004',
      nombre: 'Lavado de Chasis y Motor en Seco',
      categoria: 'GENERAL',
      descripcion: 'Desengrase minucioso de compartimento de motor y pasos de rueda con protección de plásticos técnicos.',
      precio: 28.0,
      tiempoEstimadoMin: 50,
      receta: [
        { sku: 'INS-DES-003', cant: 0.40, unidadId: unidadL.id },
        { sku: 'INS-LLA-005', cant: 0.15, unidadId: unidadL.id }
      ]
    },
    {
      codigo: 'SER-005',
      nombre: 'Encerado Express y Protección UV',
      categoria: 'GENERAL',
      descripcion: 'Descontaminación rápida de carrocería y sellado con cera de alta duración contra rayos UV.',
      precio: 16.0,
      tiempoEstimadoMin: 30,
      receta: [
        { sku: 'INS-CER-002', cant: 0.25, unidadId: unidadL.id },
        { sku: 'INS-TEX-011', cant: 1, unidadId: unidadUND.id }
      ]
    },
    {
      codigo: 'SER-006',
      nombre: 'Tratamiento de Llantas y Parabrisas Pro',
      categoria: 'GENERAL',
      descripcion: 'Limpieza ácida de frenado en rines, acondicionamiento de neumáticos y repelente hidrofóbico en parabrisas.',
      precio: 12.0,
      tiempoEstimadoMin: 25,
      receta: [
        { sku: 'INS-LLA-005', cant: 0.20, unidadId: unidadL.id },
        { sku: 'INS-VID-004', cant: 0.15, unidadId: unidadL.id }
      ]
    }
  ];

  // EXACTAMENTE 3 SERVICIOS ESPECIALES
  const serviciosEspecialesData = [
    {
      codigo: 'ESP-001',
      nombre: 'Corrección de Pintura y Pulido en 3 Pasos',
      categoria: 'ESPECIAL',
      descripcion: 'Eliminación quirúrgica de marcas de remolino, micro-rayas y defectos con acabado de brillo espejo.',
      precio: 85.0,
      tiempoEstimadoMin: 180,
      receta: [
        { sku: 'INS-PUL-007', cant: 0.15, unidadId: unidadKG.id },
        { sku: 'INS-PUL-008', cant: 0.10, unidadId: unidadKG.id },
        { sku: 'INS-ACC-012', cant: 2, unidadId: unidadUND.id },
        { sku: 'INS-TEX-011', cant: 2, unidadId: unidadUND.id }
      ]
    },
    {
      codigo: 'ESP-002',
      nombre: 'Tratamiento Cerámico 9H Diamond Coating',
      categoria: 'ESPECIAL',
      descripcion: 'Nano-recubrimiento cerámico grado 9H con efecto hidrofóbico extremo, protección química y garantía de 3 años.',
      precio: 180.0,
      tiempoEstimadoMin: 240,
      receta: [
        { sku: 'INS-CER-009', cant: 50, unidadId: unidadML.id },
        { sku: 'INS-PUL-008', cant: 0.08, unidadId: unidadKG.id },
        { sku: 'INS-TEX-011', cant: 2, unidadId: unidadUND.id }
      ]
    },
    {
      codigo: 'ESP-003',
      nombre: 'Detallado Integral de Tapicería y Renovación de Cuero',
      categoria: 'ESPECIAL',
      descripcion: 'Extracción de manchas en tapiz, limpieza de techo, nutrición de piel con ceras naturales y desinfección total.',
      precio: 95.0,
      tiempoEstimadoMin: 150,
      receta: [
        { sku: 'INS-TAP-010', cant: 150, unidadId: unidadML.id },
        { sku: 'INS-DES-003', cant: 0.25, unidadId: unidadL.id },
        { sku: 'INS-AMB-006', cant: 50, unidadId: unidadML.id },
        { sku: 'INS-TEX-011', cant: 2, unidadId: unidadUND.id }
      ]
    }
  ];

  const todosServicios = [...serviciosGeneralesData, ...serviciosEspecialesData];

  for (const s of todosServicios) {
    let catalogo = await prisma.catalogoServicio.findUnique({ where: { codigo: s.codigo } });
    if (catalogo) {
      catalogo = await prisma.catalogoServicio.update({
        where: { id: catalogo.id },
        data: {
          nombre: s.nombre,
          categoria: s.categoria,
          descripcion: s.descripcion,
          precio: s.precio,
          tiempoEstimadoMin: s.tiempoEstimadoMin,
        }
      });
      console.log(`[Servicio Actualizado] ${s.codigo} - ${s.nombre} (${s.categoria})`);
    } else {
      catalogo = await prisma.catalogoServicio.create({
        data: {
          codigo: s.codigo,
          nombre: s.nombre,
          categoria: s.categoria,
          descripcion: s.descripcion,
          precio: s.precio,
          tiempoEstimadoMin: s.tiempoEstimadoMin,
        }
      });
      console.log(`[Servicio Creado] ${s.codigo} - ${s.nombre} (${s.categoria})`);
    }

    // Actualizar receta
    await prisma.recetaInsumo.deleteMany({ where: { catalogoServicioId: catalogo.id } });
    for (const r of s.receta) {
      const insumo = insumosMap.get(r.sku);
      if (insumo) {
        await prisma.recetaInsumo.create({
          data: {
            catalogoServicioId: catalogo.id,
            insumoId: insumo.id,
            cantidadUsada: r.cant,
            unidadConsumoId: r.unidadId,
            esOpcional: false,
          }
        });
      }
    }
  }

  const countGen = await prisma.catalogoServicio.count({ where: { categoria: 'GENERAL' } });
  const countEsp = await prisma.catalogoServicio.count({ where: { categoria: 'ESPECIAL' } });
  const countIns = await prisma.insumo.count();

  console.log('=====================================================');
  console.log(`✅ Siembra completada:`);
  console.log(`📦 Total Insumos en BD: ${countIns}`);
  console.log(`🧼 Servicios Generales: ${countGen}`);
  console.log(`⭐ Servicios Especiales: ${countEsp} (Exactamente 3)`);
  console.log('=====================================================');
}

main()
  .catch(err => {
    console.error('Error al sembrar insumos y servicios:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
