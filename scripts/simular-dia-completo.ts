/**
 * Simulación de un día operativo completo (2026-09-28, 08:00 a 17:00) usando datos ya existentes en
 * la base de datos (agencias, líder, técnico, supervisor, pulidor, lavadores reales). Cubre:
 *   - Un líder con agencia asignada, una agencia CON aprobador (regla TITULAR) y otra SIN aprobador
 *     (regla RESPALDO → decide el supervisor de su región).
 *   - Precio por agencia (override) en servicios generales + precio de catálogo en un servicio especial.
 *   - Servicios generales: creados, finalizados (con evidencia y precio congelado) y decididos
 *     (aprobado/rechazado/aprobado), en las dos agencias.
 *   - Un servicio especial de principio a fin (pendiente → en proceso → completado).
 *   - Maquinaria: un mantenimiento preventivo ejecutado (con costo) y una incidencia técnica
 *     reportada y resuelta (con costo).
 *   - Inventario: un despacho desde bodega hacia la agencia, confirmado como recibido.
 *   - Un registro de auditoría de decisión (AuditoriaDecision) por cada aprobar/rechazar.
 *
 * Es un script de datos directos a Prisma (no pasa por la API HTTP ni por el guard de permisos):
 * el objetivo es ver un día de trabajo ya cargado en el sistema, no probar la validación de cada
 * endpoint (eso ya lo cubre la suite de vitest). Las fechas quedan ancladas al 2026-09-28 sin
 * importar cuándo se ejecute el script.
 *
 * Ejecutar con:
 *   pnpm exec node --require ./scripts/tsx-windows-userinfo.cjs --import tsx scripts/simular-dia-completo.ts
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();

// ─── Entidades reales reutilizadas (ver investigación previa) ───────────────
const REGION_COSTA = 'ed0fc7f3-6cec-4841-8ab9-3379b09627ba';
const REGION_SIERRA = 'a16fbffc-78c3-4b41-8179-968122eab0a4';

const AGENCIA_1 = '7b09fb29-225e-420b-b4dd-bc639191dc8b'; // AMBACAR AMERICAS (Costa) — ya tiene líder
const AGENCIA_2 = '67854c7e-5078-492c-a063-14d05800f5a1'; // ALVAREZ BARBA LABRADOR (Sierra) — sin líder

const BAHIA_1_A = 'd1bd8fa3-a056-450a-83fc-a8dd9c957e02'; // Agencia 1, Bahía 01
const BAHIA_1_B = '7c182c5a-dcdf-408c-af97-f6d9aabb3c0b'; // Agencia 1, Bahía 02
const BAHIA_2_A = '605556e3-61b8-4277-af2c-6e5665c841f9'; // Agencia 2, Bahía 01

const MAQUINA_1_MANTENIMIENTO = 'a875da1d-a7f8-4098-8add-a919f3283b2e'; // hd-20022 (Agencia 1)
const MAQUINA_1_INCIDENTE = 'e73dbff6-506c-4ca4-a59c-6da3634ffc3b'; // asulecfhtbka (Agencia 1)

const LIDER_AGENCIA_1 = 'ef5065d3-c32c-40e7-91f2-06cf1bcb794d'; // líder real ya asignado a Agencia 1
const SUPERVISOR_SIERRA_O_COSTA = '531a24f5-9053-4d2a-9c55-7dd1be3361ae'; // supervisor real, región Costa
const TECNICO = '332695ae-c627-4152-860c-4bd76366c06b'; // único técnico (hoy inactivo: se reactiva)
const PULIDOR_MOVIL = '32041af6-47cf-4562-b2d2-39e06148194f'; // pulidor móvil, región Costa
const LAVADOR_1 = 'a2e2fa3c-8aee-4f8e-8426-a9de948f3e89'; // EDISON (Agencia 1)
const LAVADOR_2 = '30392110-ae26-4854-b301-5e22a2d3a4a3'; // DARIO (Agencia 1)
const LAVADOR_3 = 'cc0d32be-771e-484f-823c-6559dd253b68'; // IVAN (Agencia 1)
const ASISTENTE_BODEGA = '1f1a17c9-0498-4c50-897f-32f9971cd108'; // Bodega Costa
const BODEGA_COSTA = 'bod_ef3fb24f';
const SUPER_ADMIN = '16f40cac-04b5-40a2-af7f-becfd85037ce';

const ROLE_APROBADOR = '14e5de40-8973-41d3-8649-42630d27425b';
const ROLE_LIDER = 'f91d285a-20e6-4689-9090-a289bc1cc8b0';

const CAT_LAVADO_EXPRESS = 18; // General, Agencia 1 y 2
const CAT_LAVADO_DELUXE = 20; // General, solo Agencia 1
const CAT_LAVADO_COMPLETO = 22; // General, solo Agencia 1
const CAT_PULIDOR_EXPRES = 26; // Especial, Agencia 1

const INSUMO_DESPACHO = 'ad8abca9-b27c-4d17-89c6-1d72eb9c7b0c'; // ACONDICIONADOR DJ, con stock real en Bodega Costa

/** Hora de Ecuador (UTC-5) fija al 2026-09-28. */
const t = (hhmm: string) => new Date(`2026-09-28T${hhmm}:00-05:00`);

function log(msg: string) {
  console.log(`\x1b[36m[SIMULACIÓN]\x1b[0m ${msg}`);
}

async function main() {
  log('Verificando agencias reales…');
  const [agencia1, agencia2] = await Promise.all([
    prisma.agencia.findUniqueOrThrow({ where: { id: AGENCIA_1 } }),
    prisma.agencia.findUniqueOrThrow({ where: { id: AGENCIA_2 } }),
  ]);
  log(`Agencia 1: "${agencia1.nombre}" (${agencia1.id}) — región Costa`);
  log(`Agencia 2: "${agencia2.nombre}" (${agencia2.id}) — región Sierra`);

  // ───────────────────────────────────────────────────────────────────────
  // SETUP: técnico activo, aprobador de Agencia 1, líder de Agencia 2, precios por agencia
  // ───────────────────────────────────────────────────────────────────────
  await prisma.user.update({ where: { id: TECNICO }, data: { estado: 1 } });
  log('Técnico reactivado (estaba inactivo).');

  const passwordHash = await bcrypt.hash('Simulacion123*', 10);

  let aprobador = await prisma.user.findFirst({ where: { agenciaId: AGENCIA_1, role: { namerol: 'APROBADOR' } } });
  if (!aprobador) {
    aprobador = await prisma.user.create({
      data: {
        email: 'aprobador.ambacar.simulacion@easydry.com',
        passwordHash,
        name: 'Aprobador',
        lastname: 'Simulación Ambacar',
        roleId: ROLE_APROBADOR,
        agenciaId: AGENCIA_1,
        estado: 1,
      },
    });
    log(`Aprobador creado para Agencia 1: ${aprobador.email} (regla TITULAR para sus servicios).`);
  } else {
    log(`Agencia 1 ya tenía aprobador: ${aprobador.email}`);
  }

  let liderAgencia2 = await prisma.user.findFirst({ where: { agenciaId: AGENCIA_2, role: { namerol: 'LIDER' } } });
  if (!liderAgencia2) {
    liderAgencia2 = await prisma.user.create({
      data: {
        email: 'lider.alvarezbarba.simulacion@easydry.com',
        passwordHash,
        name: 'Líder',
        lastname: 'Simulación Alvarez Barba',
        roleId: ROLE_LIDER,
        agenciaId: AGENCIA_2,
        estado: 1,
      },
    });
    log(`Líder creado para Agencia 2: ${liderAgencia2.email} (sin aprobador → regla RESPALDO).`);
  } else {
    log(`Agencia 2 ya tenía líder: ${liderAgencia2.email}`);
  }

  for (const [catalogoServicioId, precio] of [[CAT_LAVADO_EXPRESS, 8.5], [CAT_LAVADO_DELUXE, 12.0], [CAT_LAVADO_COMPLETO, 15.0]] as const) {
    await prisma.precioAgenciaServicio.upsert({
      where: { agenciaId_catalogoServicioId: { agenciaId: AGENCIA_1, catalogoServicioId } },
      create: { agenciaId: AGENCIA_1, catalogoServicioId, precio },
      update: { precio },
    });
  }
  log('Precios por agencia fijados para Agencia 1 (Lavado Express $8.50, Deluxe $12.00, Completo $15.00).');

  // ───────────────────────────────────────────────────────────────────────
  // 08:00 — Mantenimiento preventivo programado para hoy
  // ───────────────────────────────────────────────────────────────────────
  const mantenimiento = await prisma.mantenimientoMaquinaria.create({
    data: {
      maquinariaId: MAQUINA_1_MANTENIMIENTO,
      tecnicoId: TECNICO,
      tipo: 'PREVENTIVO',
      estado: 'PENDIENTE',
      fechaProgramada: t('08:00'),
      fechaMantenimiento: t('08:00'),
      creadoPorId: LIDER_AGENCIA_1,
      frecuenciaDias: 30,
      createdAt: t('08:00'),
    },
  });
  log(`Mantenimiento preventivo programado 08:00 (máquina ${MAQUINA_1_MANTENIMIENTO}).`);

  // ───────────────────────────────────────────────────────────────────────
  // 08:15 — Incidencia técnica reportada
  // ───────────────────────────────────────────────────────────────────────
  const incidente = await prisma.incidenteTecnico.create({
    data: {
      maquinariaId: MAQUINA_1_INCIDENTE,
      reportadoPorId: LAVADOR_1,
      titulo: 'Fuga de aceite hidráulico',
      descripcion: 'Se detectó fuga de aceite en el pistón principal durante el encendido matutino.',
      gravedad: 'MEDIA',
      estado: 'ABIERTO',
      tecnicoAsignadoId: TECNICO,
      fechaAsignacion: t('08:20'),
      fechaReporte: t('08:15'),
      createdAt: t('08:15'),
    },
  });
  log('Incidencia reportada 08:15 (fuga de aceite) y asignada al técnico.');

  // ───────────────────────────────────────────────────────────────────────
  // Servicios generales — Agencia 1 (con aprobador)
  // ───────────────────────────────────────────────────────────────────────
  const ot1 = await prisma.servicioLavado.create({
    data: {
      clientUuid: randomUUID(),
      ordenTrabajoOT: 'OT-SIM-0001',
      placa: 'GSA-0001',
      marca: 'Chevrolet',
      modelo: 'Sail',
      color: 'Blanco',
      cliente: 'Juan Pérez',
      estado: 'EN_PROCESO',
      bahiaId: BAHIA_1_A,
      servicioCatalogoId: CAT_LAVADO_EXPRESS,
      precio: 8.5,
      operadorId: LAVADOR_1,
      horaIngreso: t('08:30'),
      horaInicio: t('08:30'),
      fotoIngresoUrl: 'servicios/generales/OT-SIM-0001/ingreso/foto1.jpg',
      createdAt: t('08:30'),
    },
  });
  log('OT-SIM-0001 creada 08:30 (Lavado Express, Agencia 1, precio congelado $8.50).');

  const ot2 = await prisma.servicioLavado.create({
    data: {
      clientUuid: randomUUID(),
      ordenTrabajoOT: 'OT-SIM-0002',
      placa: 'GSA-0002',
      marca: 'Toyota',
      modelo: 'Hilux',
      color: 'Gris',
      cliente: 'María Gómez',
      estado: 'EN_PROCESO',
      bahiaId: BAHIA_1_B,
      servicioCatalogoId: CAT_LAVADO_DELUXE,
      precio: 12.0,
      operadorId: LAVADOR_2,
      horaIngreso: t('09:45'),
      horaInicio: t('09:45'),
      fotoIngresoUrl: 'servicios/generales/OT-SIM-0002/ingreso/foto1.jpg',
      createdAt: t('09:45'),
    },
  });
  log('OT-SIM-0002 creada 09:45 (Lavado Deluxe, Agencia 1, precio congelado $12.00).');

  // ───────────────────────────────────────────────────────────────────────
  // 09:00 — Servicio especial (pulidor móvil)
  // ───────────────────────────────────────────────────────────────────────
  const codigoSE = 'SE-SIM-0001';
  const catalogoEspecial = await prisma.catalogoServicio.findUniqueOrThrow({ where: { id: CAT_PULIDOR_EXPRES }, select: { precio: true } });
  const servicioEspecial = await prisma.servicioEspecial.create({
    data: {
      id: codigoSE,
      clientUuid: randomUUID(),
      codigoSE,
      ordenTrabajoOT: codigoSE,
      tipoServicio: 'LAVADO PULIDOR EXPRES',
      servicioCatalogoId: CAT_PULIDOR_EXPRES,
      precio: catalogoEspecial.precio, // congelado del catálogo, igual que el flujo real
      placa: 'GSA-0010',
      marca: 'Mazda',
      modelo: 'CX-5',
      color: 'Rojo',
      clienteNombre: 'Pedro Salazar',
      cliente: 'Pedro Salazar',
      agenciaId: AGENCIA_1,
      regionId: REGION_COSTA,
      operadorId: PULIDOR_MOVIL,
      creadoPorId: LIDER_AGENCIA_1,
      creadoPorNombre: 'Líder Operador',
      prioridad: 'Media',
      estado: 'En Proceso',
      horaIngreso: '09:00',
      fechaInicio: t('09:10'),
      videoInicialUrl: 'servicios/especiales/SE-SIM-0001/inicial/video1.mp4',
      createdAt: t('09:00'),
    },
  });
  log('SE-SIM-0001 creado e iniciado 09:00-09:10 (pulidor móvil asignado, Agencia 1).');

  // ───────────────────────────────────────────────────────────────────────
  // 09:30 — Despacho de inventario: Bodega Costa → Agencia 1
  // ───────────────────────────────────────────────────────────────────────
  const guia = 'GUI-SIM-0001';
  const movimiento = await prisma.movimientoInventario.create({
    data: {
      numeroGuia: guia,
      tipo: 'DESPACHO_BODEGA' as never,
      estadoDespacho: 'EN_TRANSITO' as never,
      origenUbicacion: 'Bodega Costa',
      destinoUbicacion: agencia1.nombre,
      origenBodegaId: BODEGA_COSTA,
      destinoAgenciaId: AGENCIA_1,
      usuarioDespachaId: ASISTENTE_BODEGA,
      observaciones: 'Reposición quincenal de insumos — simulación.',
      fechaDespacho: t('09:30'),
      createdAt: t('09:30'),
    } as never,
  });
  await prisma.movimientoDetalle.create({
    data: {
      movimientoId: movimiento.id,
      insumoId: INSUMO_DESPACHO,
      cantidadEnviada: 2000,
    } as never,
  });
  log('Despacho GUI-SIM-0001 creado 09:30 (Bodega Costa → Agencia 1, EN_TRANSITO).');

  // ───────────────────────────────────────────────────────────────────────
  // 09:50 — OT-1 finalizada
  // ───────────────────────────────────────────────────────────────────────
  await prisma.servicioLavado.update({
    where: { id: ot1.id },
    data: {
      estado: 'FINALIZADO',
      horaSalida: t('09:50'),
      fotoSalidaUrl: 'servicios/generales/OT-SIM-0001/salida/foto1.jpg',
    },
  });
  log('OT-SIM-0001 finalizada 09:50 (con evidencia de salida).');

  // ───────────────────────────────────────────────────────────────────────
  // 10:00 — Mantenimiento ejecutado (con costo)
  // ───────────────────────────────────────────────────────────────────────
  await prisma.mantenimientoMaquinaria.update({
    where: { id: mantenimiento.id },
    data: {
      estado: 'FINALIZADO',
      fechaEjecucion: t('10:00'),
      fechaMantenimiento: t('10:00'),
      ejecutadoPorId: TECNICO,
      observaciones: 'Cambio de aceite hidráulico y revisión de mangueras.',
      costoTotal: 45.0,
      proximoMantenimiento: new Date('2026-10-28T08:00:00-05:00'),
    },
  });
  log('Mantenimiento ejecutado 10:00 — costo $45.00.');

  // ───────────────────────────────────────────────────────────────────────
  // 10:40 — OT-2 finalizada
  // ───────────────────────────────────────────────────────────────────────
  await prisma.servicioLavado.update({
    where: { id: ot2.id },
    data: {
      estado: 'FINALIZADO',
      horaSalida: t('10:40'),
      fotoSalidaUrl: 'servicios/generales/OT-SIM-0002/salida/foto1.jpg',
    },
  });
  log('OT-SIM-0002 finalizada 10:40.');

  // ───────────────────────────────────────────────────────────────────────
  // 11:00 — Servicio general en Agencia 2 (sin aprobador propio)
  // ───────────────────────────────────────────────────────────────────────
  const ot3 = await prisma.servicioLavado.create({
    data: {
      clientUuid: randomUUID(),
      ordenTrabajoOT: 'OT-SIM-0003',
      placa: 'GSB-0001',
      marca: 'Kia',
      modelo: 'Rio',
      color: 'Negro',
      cliente: 'Lucía Torres',
      estado: 'FINALIZADO',
      bahiaId: BAHIA_2_A,
      servicioCatalogoId: CAT_LAVADO_EXPRESS,
      precio: 0, // Agencia 2 no tiene override: rige el precio del catálogo
      operadorId: liderAgencia2.id,
      horaIngreso: t('11:00'),
      horaInicio: t('11:00'),
      horaSalida: t('11:40'),
      fotoIngresoUrl: 'servicios/generales/OT-SIM-0003/ingreso/foto1.jpg',
      fotoSalidaUrl: 'servicios/generales/OT-SIM-0003/salida/foto1.jpg',
      createdAt: t('11:00'),
    },
  });
  log('OT-SIM-0003 creada y finalizada 11:00-11:40 (Agencia 2, sin override de precio).');

  // ───────────────────────────────────────────────────────────────────────
  // 12:30 / 12:45 — Decisiones de Agencia 1 (regla TITULAR: decide el aprobador)
  // ───────────────────────────────────────────────────────────────────────
  await prisma.servicioLavado.update({
    where: { id: ot1.id },
    data: {
      estado: 'APROBADO',
      observacionGerente: 'Aprobado',
      aprobadoPor: `${aprobador.name} ${aprobador.lastname}`,
      decididoPorId: aprobador.id,
      reglaDecision: 'TITULAR',
      fechaAprobacion: t('12:30'),
    },
  });
  await prisma.auditoriaDecision.create({
    data: {
      entidad: 'SERVICIO_LAVADO', entidadId: ot1.id, accion: 'APROBAR',
      usuarioId: aprobador.id, usuarioNombre: `${aprobador.name} ${aprobador.lastname}`,
      rol: 'APROBADOR', regla: 'TITULAR', agenciaId: AGENCIA_1,
      createdAt: t('12:30'),
    },
  });
  log('OT-SIM-0001 APROBADA 12:30 por el aprobador de Agencia 1 (regla TITULAR).');

  const motivoRechazo = 'Vehículo entregado con manchas en la tapicería: se reprocesará sin costo para el cliente.';
  await prisma.servicioLavado.update({
    where: { id: ot2.id },
    data: {
      estado: 'RECHAZADO',
      motivoRechazo,
      observacionGerente: motivoRechazo,
      aprobadoPor: `${aprobador.name} ${aprobador.lastname}`,
      decididoPorId: aprobador.id,
      reglaDecision: 'TITULAR',
      fechaAprobacion: t('12:45'),
    },
  });
  await prisma.auditoriaDecision.create({
    data: {
      entidad: 'SERVICIO_LAVADO', entidadId: ot2.id, accion: 'RECHAZAR',
      usuarioId: aprobador.id, usuarioNombre: `${aprobador.name} ${aprobador.lastname}`,
      rol: 'APROBADOR', regla: 'TITULAR', motivo: motivoRechazo, agenciaId: AGENCIA_1,
      createdAt: t('12:45'),
    },
  });
  log('OT-SIM-0002 RECHAZADA 12:45 (falta de calidad en tapicería).');

  // ───────────────────────────────────────────────────────────────────────
  // 13:00 / 13:50 — Tercera OT de Agencia 1
  // ───────────────────────────────────────────────────────────────────────
  const ot4 = await prisma.servicioLavado.create({
    data: {
      clientUuid: randomUUID(),
      ordenTrabajoOT: 'OT-SIM-0004',
      placa: 'GSA-0004',
      marca: 'Ford',
      modelo: 'Ranger',
      color: 'Azul',
      cliente: 'Andrés Vera',
      estado: 'FINALIZADO',
      bahiaId: BAHIA_1_A,
      servicioCatalogoId: CAT_LAVADO_COMPLETO,
      precio: 15.0,
      operadorId: LAVADOR_3,
      horaIngreso: t('13:00'),
      horaInicio: t('13:00'),
      horaSalida: t('13:50'),
      fotoIngresoUrl: 'servicios/generales/OT-SIM-0004/ingreso/foto1.jpg',
      fotoSalidaUrl: 'servicios/generales/OT-SIM-0004/salida/foto1.jpg',
      createdAt: t('13:00'),
    },
  });
  log('OT-SIM-0004 creada y finalizada 13:00-13:50 (Lavado Completo, precio congelado $15.00).');

  // ───────────────────────────────────────────────────────────────────────
  // 14:00 — Incidencia resuelta (con costo)
  // ───────────────────────────────────────────────────────────────────────
  await prisma.incidenteTecnico.update({
    where: { id: incidente.id },
    data: {
      estado: 'RESUELTO',
      solucion: 'Se cambió el retén del pistón principal y se purgó el circuito hidráulico.',
      resueltoPorId: TECNICO,
      fechaSolucion: t('14:00'),
      costoTotal: 35.0,
    },
  });
  log('Incidencia resuelta 14:00 — costo $35.00.');

  // ───────────────────────────────────────────────────────────────────────
  // 14:30 — Servicio especial completado
  // ───────────────────────────────────────────────────────────────────────
  await prisma.servicioEspecial.update({
    where: { id: servicioEspecial.id },
    data: {
      estado: 'Completado',
      fechaFin: t('14:30'),
      tiempoEfectivoSeg: Math.round((t('14:30').getTime() - t('09:10').getTime()) / 1000),
      videoFinalUrl: 'servicios/especiales/SE-SIM-0001/final/video1.mp4',
    },
  });
  log('SE-SIM-0001 completado 14:30.');

  // ───────────────────────────────────────────────────────────────────────
  // 15:00 — Despacho confirmado RECIBIDO (con movimiento real de stock)
  // ───────────────────────────────────────────────────────────────────────
  await prisma.$transaction(async (tx) => {
    await tx.movimientoDetalle.updateMany({
      where: { movimientoId: movimiento.id },
      data: { cantidadRecibida: 2000 },
    });
    await tx.movimientoInventario.update({
      where: { id: movimiento.id },
      data: { estadoDespacho: 'RECIBIDO' as never, usuarioRecibeId: LIDER_AGENCIA_1, fechaRecepcion: t('15:00') } as never,
    });
    const stockBodega = await tx.stockUbicacion.findFirst({ where: { insumoId: INSUMO_DESPACHO, bodegaId: BODEGA_COSTA } });
    if (stockBodega) {
      await tx.stockUbicacion.update({ where: { id: stockBodega.id }, data: { cantidadActual: { decrement: 2000 } } });
      await tx.kardexMovimiento.create({
        data: {
          insumoId: INSUMO_DESPACHO, ubicacionId: BODEGA_COSTA, tipoMovimiento: 'DESPACHO_SALIDA',
          cantidad: -2000, stockAnterior: Number(stockBodega.cantidadActual), stockPosterior: Number(stockBodega.cantidadActual) - 2000,
          costoUnitario: 0, costoTotal: 0, referenciaId: guia, usuarioId: ASISTENTE_BODEGA, fecha: t('15:00'),
        },
      });
    }
    const stockAgenciaExistente = await tx.stockUbicacion.findFirst({ where: { insumoId: INSUMO_DESPACHO, agenciaId: AGENCIA_1 } });
    if (stockAgenciaExistente) {
      await tx.stockUbicacion.update({ where: { id: stockAgenciaExistente.id }, data: { cantidadActual: { increment: 2000 } } });
    } else {
      await tx.stockUbicacion.create({
        data: { insumoId: INSUMO_DESPACHO, tipoUbicacion: 'AGENCIA', agenciaId: AGENCIA_1, cantidadActual: 2000, cantidadMinima: 500 },
      });
    }
    await tx.kardexMovimiento.create({
      data: {
        insumoId: INSUMO_DESPACHO, ubicacionId: AGENCIA_1, tipoMovimiento: 'DESPACHO_ENTRADA',
        cantidad: 2000, stockAnterior: Number(stockAgenciaExistente?.cantidadActual ?? 0),
        stockPosterior: Number(stockAgenciaExistente?.cantidadActual ?? 0) + 2000,
        costoUnitario: 0, costoTotal: 0, referenciaId: guia, usuarioId: LIDER_AGENCIA_1, fecha: t('15:00'),
      },
    });
  });
  log('Despacho GUI-SIM-0001 confirmado RECIBIDO 15:00 (stock movido: -2000 bodega, +2000 agencia).');

  // ───────────────────────────────────────────────────────────────────────
  // 16:00 — Decisión de Agencia 2 (regla RESPALDO: decide el supervisor, no hay aprobador propio)
  // ───────────────────────────────────────────────────────────────────────
  const supervisor = await prisma.user.findUnique({ where: { id: SUPERVISOR_SIERRA_O_COSTA } });
  const decisorAgencia2 = supervisor?.regionId === agencia2.regionId ? supervisor : await prisma.user.findUniqueOrThrow({ where: { id: SUPER_ADMIN } });
  const reglaAgencia2 = supervisor?.regionId === agencia2.regionId ? 'RESPALDO' : 'ADMIN';
  await prisma.servicioLavado.update({
    where: { id: ot3.id },
    data: {
      estado: 'APROBADO',
      observacionGerente: 'Aprobado',
      aprobadoPor: `${decisorAgencia2!.name} ${decisorAgencia2!.lastname}`,
      decididoPorId: decisorAgencia2!.id,
      reglaDecision: reglaAgencia2,
      fechaAprobacion: t('16:00'),
    },
  });
  await prisma.auditoriaDecision.create({
    data: {
      entidad: 'SERVICIO_LAVADO', entidadId: ot3.id, accion: 'APROBAR',
      usuarioId: decisorAgencia2!.id, usuarioNombre: `${decisorAgencia2!.name} ${decisorAgencia2!.lastname}`,
      rol: reglaAgencia2 === 'RESPALDO' ? 'SUPERVISOR' : 'ADMIN', regla: reglaAgencia2, agenciaId: AGENCIA_2,
      createdAt: t('16:00'),
    },
  });
  log(`OT-SIM-0003 (Agencia 2) APROBADA 16:00 — regla ${reglaAgencia2} (sin aprobador propio en la agencia).`);

  // ───────────────────────────────────────────────────────────────────────
  // 16:30 — Decisión final de Agencia 1
  // ───────────────────────────────────────────────────────────────────────
  await prisma.servicioLavado.update({
    where: { id: ot4.id },
    data: {
      estado: 'APROBADO',
      observacionGerente: 'Aprobado',
      aprobadoPor: `${aprobador.name} ${aprobador.lastname}`,
      decididoPorId: aprobador.id,
      reglaDecision: 'TITULAR',
      fechaAprobacion: t('16:30'),
    },
  });
  await prisma.auditoriaDecision.create({
    data: {
      entidad: 'SERVICIO_LAVADO', entidadId: ot4.id, accion: 'APROBAR',
      usuarioId: aprobador.id, usuarioNombre: `${aprobador.name} ${aprobador.lastname}`,
      rol: 'APROBADOR', regla: 'TITULAR', agenciaId: AGENCIA_1,
      createdAt: t('16:30'),
    },
  });
  log('OT-SIM-0004 APROBADA 16:30 (cierre del día en Agencia 1).');

  log('\n✅ Simulación completa: 08:00–17:00, 2026-09-28.');
  log(`   Servicios generales: OT-SIM-0001 (APROBADO $8.50), OT-SIM-0002 (RECHAZADO $12.00), OT-SIM-0003 (APROBADO Agencia 2, regla ${reglaAgencia2}), OT-SIM-0004 (APROBADO $15.00)`);
  log('   Servicio especial: SE-SIM-0001 (Completado)');
  log('   Mantenimiento: ejecutado, costo $45.00');
  log('   Incidencia: resuelta, costo $35.00');
  log('   Despacho: GUI-SIM-0001 recibido, 2000 unidades base movidas');
}

main()
  .catch((err) => {
    console.error('\n❌ Error en la simulación:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
