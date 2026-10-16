import { PrismaClient, ServiceStatus } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

function randomDate(start: Date, end: Date): Date {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function getRandomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomNumber(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function main() {
  console.log('🚀 Iniciando Siembra Integral del Dashboard para TODAS las Agencias (Mes Actual)...');

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const startOfMonth = new Date(year, month, 1, 0, 0, 0);
  const endOfPeriod = now;

  // 1. Obtener usuarios clave
  const liderGlobal = await prisma.user.findFirst({ where: { role: { namerol: 'LIDER' } } })
    || await prisma.user.findFirst({ where: { email: 'lider@easydry.com' } });
  const aprobadorGlobal = await prisma.user.findFirst({ where: { role: { namerol: 'APROBADOR' } } })
    || await prisma.user.findFirst({ where: { email: 'aprobador@easydry.com' } });
  const tecnicoGlobal = await prisma.user.findFirst({ where: { role: { namerol: { in: ['TECNICO', 'COORD_MANTENIMIENTO'] } } } })
    || await prisma.user.findFirst({ where: { email: 'tecnico@easydry.com' } });
  const adminUser = await prisma.user.findFirst({ where: { role: { namerol: { in: ['ADMIN', 'SUPER_ADMIN'] } } } });

  const pulidores = await prisma.user.findMany({ where: { role: { namerol: 'PULIDOR' } } });
  const lavadores = await prisma.user.findMany({ where: { role: { namerol: 'LAVADOR' } } });
  const allOperadores = [...pulidores, ...lavadores];

  const defaultUser = adminUser || liderGlobal;
  if (!defaultUser) throw new Error('No se encontró usuario base en la BD.');

  // 2. Catálogos e Insumos
  const catalogos = await prisma.catalogoServicio.findMany();
  const insumos = await prisma.insumo.findMany({
    include: { tipoProducto: true, unidadMedida: true }
  });

  if (catalogos.length === 0) throw new Error('No hay servicios en el catálogo.');
  if (insumos.length === 0) throw new Error('No hay insumos registrados.');

  // 3. Obtener TODAS las agencias con sus bahías
  const agencias = await prisma.agencia.findMany({
    include: {
      bahias: true,
      cliente: true,
      usuarios: true,
    }
  });

  console.log(`📌 Procesando ${agencias.length} agencias en total...`);

  let totalServiciosCreados = 0;
  let totalSolicitudesCreadas = 0;
  let totalMaquinariasCreadas = 0;
  let totalIncidentesCreados = 0;
  let totalMantenimientosCreados = 0;
  let totalStocksCreados = 0;
  let totalAlertasCreadas = 0;

  for (const ag of agencias) {
    // A. Asegurar al menos una bahía activa
    let bahias = ag.bahias;
    if (bahias.length === 0) {
      const nuevaBahia = await prisma.bahia.create({
        data: {
          codigo: `BAH-${ag.codigo || ag.id.slice(0, 8)}-01`,
          nombre: 'Bahía 01',
          agenciaId: ag.id,
          activa: true,
        }
      });
      bahias = [nuevaBahia];
    }

    const operadorAg = ag.usuarios.find(u => u.roleId && (pulidores.some(p => p.id === u.id) || lavadores.some(l => l.id === u.id)))
      || getRandomItem(allOperadores)
      || defaultUser;
    const liderAg = ag.usuarios.find(u => u.id === liderGlobal?.id) || liderGlobal || defaultUser;
    const aprobadorAg = ag.usuarios.find(u => u.id === aprobadorGlobal?.id) || aprobadorGlobal || defaultUser;
    const tecnicoAg = ag.usuarios.find(u => u.id === tecnicoGlobal?.id) || tecnicoGlobal || defaultUser;

    // B. Servicios de Lavado por cada Bahía para el mes actual
    for (const b of bahias) {
      const serviciosExistentes = await prisma.servicioLavado.findMany({
        where: { bahiaId: b.id, horaIngreso: { gte: startOfMonth, lte: endOfPeriod } },
        select: { id: true }
      });

      let servsBahia = serviciosExistentes;
      if (serviciosExistentes.length < 6) {
        const faltantes = 8 - serviciosExistentes.length;
        const nuevosServicios = [];

        for (let i = 0; i < faltantes; i++) {
          const catalogo = getRandomItem(catalogos);
          const fIngreso = randomDate(startOfMonth, endOfPeriod);
          const fInicio = new Date(fIngreso.getTime() + getRandomNumber(5, 15) * 60000);
          const fSalida = new Date(fInicio.getTime() + getRandomNumber(25, 55) * 60000);

          const estados: ServiceStatus[] = [
            ServiceStatus.FINALIZADO,
            ServiceStatus.FINALIZADO,
            ServiceStatus.FINALIZADO,
            ServiceStatus.EN_PROCESO,
            ServiceStatus.APROBADO
          ];
          const estado = getRandomItem(estados);

          const marcas = ['Toyota', 'Chevrolet', 'Kia', 'Hyundai', 'Nissan', 'Great Wall', 'Haval'];
          const colores = ['Blanco', 'Negro', 'Gris', 'Plateado', 'Azul', 'Rojo'];

          const s = await prisma.servicioLavado.create({
            data: {
              clientUuid: crypto.randomUUID(),
              ordenTrabajoOT: `OT-${ag.codigo || 'AG'}-${getRandomNumber(1000, 9999)}`,
              placa: `PBC-${getRandomNumber(1000, 9999)}`,
              marca: getRandomItem(marcas),
              modelo: 'Sedán / SUV',
              color: getRandomItem(colores),
              estado,
              bahiaId: b.id,
              servicioCatalogoId: catalogo.id,
              operadorId: operadorAg.id,
              horaIngreso: fIngreso,
              horaInicio: estado !== ServiceStatus.EN_ESPERA ? fInicio : null,
              horaSalida: estado === ServiceStatus.FINALIZADO ? fSalida : null,
              precio: catalogo.precio || 15.00,
            }
          });
          nuevosServicios.push(s);
          totalServiciosCreados++;
        }
        servsBahia = [...serviciosExistentes, ...nuevosServicios];
      }

      // C. Solicitudes de Aprobación Comercial vinculadas a esta bahía (entidadRefId)
      const titulosComerciales: Record<string, string[]> = {
        'DESCUENTO': ['Descuento por cliente corporativo', 'Descuento flota frecuente', 'Descuento autorizado por volumen'],
        'SERVICIO_ESPECIAL_PRECIO': ['Tarifa preferencial pulido y abrillantado', 'Descuento tratamiento cerámico', 'Paquete especial detailing'],
        'CORTESIA': ['Lavado de cortesía por demora en entrega', 'Cortesía cliente VIP', 'Atención por fidelización'],
        'PLACA_DUPLICADA': ['Reapertura por ingreso doble de placa', 'Autorización de servicio misma placa'],
        'ANULACION': ['Anulación por retiro del cliente', 'Cancelación por reasignación de turno']
      };

      const idsServs = servsBahia.map(s => s.id);
      const solExistentes = await prisma.solicitudAprobacion.count({
        where: {
          agenciaId: ag.id,
          entidadRefId: { in: idsServs },
          createdAt: { gte: startOfMonth, lte: endOfPeriod }
        }
      });

      if (solExistentes < 4 && idsServs.length > 0) {
        const configs = [
          { estado: 'PENDIENTE', tipo: 'DESCUENTO', monto: 15.50 },
          { estado: 'APROBADO', tipo: 'SERVICIO_ESPECIAL_PRECIO', monto: 45.00 },
          { estado: 'APROBADO', tipo: 'CORTESIA', monto: 20.00 },
          { estado: 'RECHAZADO', tipo: 'DESCUENTO', monto: 35.00, motivo: 'Excede política de descuento autorizada' },
        ];

        for (let idx = 0; idx < configs.length; idx++) {
          const cfg = configs[idx];
          const servRef = idsServs[idx % idsServs.length];
          const fSol = randomDate(startOfMonth, endOfPeriod);
          const fDecision = cfg.estado !== 'PENDIENTE' ? new Date(fSol.getTime() + getRandomNumber(20, 45) * 60000) : null;
          const titulos = titulosComerciales[cfg.tipo] || ['Solicitud comercial'];

          const sol = await prisma.solicitudAprobacion.create({
            data: {
              tipo: cfg.tipo,
              titulo: getRandomItem(titulos),
              descripcion: `Solicitud registrada en ${b.nombre} para orden de trabajo asociada.`,
              montoUSD: cfg.monto,
              estado: cfg.estado,
              solicitanteId: liderAg.id,
              aprobadorId: cfg.estado !== 'PENDIENTE' ? aprobadorAg.id : null,
              agenciaId: ag.id,
              entidadRefId: servRef,
              motivoRechazo: cfg.motivo || null,
              fechaDecision: fDecision,
              createdAt: fSol,
              updatedAt: fDecision || fSol,
            }
          });

          if (cfg.estado !== 'PENDIENTE') {
            await prisma.auditoriaDecision.create({
              data: {
                entidad: 'SOLICITUD',
                entidadId: sol.id,
                accion: cfg.estado === 'APROBADO' ? 'APROBAR' : 'RECHAZAR',
                usuarioId: aprobadorAg.id,
                usuarioNombre: `${aprobadorAg.name || 'Aprobador'} ${aprobadorAg.lastname || 'Agencia'}`.trim(),
                rol: 'APROBADOR',
                regla: 'TITULAR',
                motivo: cfg.motivo || 'Decisión comercial conforme a políticas',
                agenciaId: ag.id,
                createdAt: fDecision || fSol,
              }
            });
          }

          totalSolicitudesCreadas++;
        }
      }
    }

    // D. Maquinaria, Incidentes Técnicos y Mantenimientos para el mes actual
    let maquinasAg = await prisma.maquinaria.findMany({
      where: { agenciaId: ag.id }
    });

    if (maquinasAg.length < 2) {
      const m1 = await prisma.maquinaria.create({
        data: {
          codigo: `MQ-${ag.codigo || ag.id.slice(0, 6)}-HIDRO-${getRandomNumber(10, 99)}`,
          nombre: `Hidrolavadora Industrial ${ag.nombre}`,
          tipo: 'HIDROLAVADORA',
          agenciaId: ag.id,
          bahiaId: bahias[0]?.id || null,
          estadoOperativo: 'OPERATIVA',
        }
      });
      const m2 = await prisma.maquinaria.create({
        data: {
          codigo: `MQ-${ag.codigo || ag.id.slice(0, 6)}-ASP-${getRandomNumber(10, 99)}`,
          nombre: `Aspiradora Profesional ${ag.nombre}`,
          tipo: 'ASPIRADORA',
          agenciaId: ag.id,
          bahiaId: bahias[bahias.length > 1 ? 1 : 0]?.id || null,
          estadoOperativo: 'OPERATIVA',
        }
      });
      maquinasAg = [m1, m2];
      totalMaquinariasCreadas += 2;
    }

    for (let i = 0; i < maquinasAg.length; i++) {
      const m = maquinasAg[i];
      if (!m.bahiaId) {
        const bAsignar = bahias[i % bahias.length];
        await prisma.maquinaria.update({
          where: { id: m.id },
          data: { bahiaId: bAsignar.id }
        });
        m.bahiaId = bAsignar.id;
      }

      // Incidentes técnicos para esta máquina en el mes actual
      const incCount = await prisma.incidenteTecnico.count({
        where: { maquinariaId: m.id, createdAt: { gte: startOfMonth, lte: endOfPeriod } }
      });

      if (incCount === 0) {
        const fRep = randomDate(startOfMonth, endOfPeriod);
        const fSol = new Date(fRep.getTime() + getRandomNumber(2, 6) * 3600000);
        const costos = [45.00, 65.00, 85.00, 110.00];

        await prisma.incidenteTecnico.create({
          data: {
            maquinariaId: m.id,
            reportadoPorId: operadorAg.id,
            resueltoPorId: tecnicoAg.id,
            tecnicoAsignadoId: tecnicoAg.id,
            titulo: `Desgaste de sello en ${m.nombre}`,
            descripcion: 'Pérdida leve de presión reportada durante jornada operativa.',
            gravedad: getRandomItem(['BAJA', 'MEDIA', 'ALTA']),
            estado: 'RESUELTO',
            costoTotal: getRandomItem(costos),
            solucion: 'Reemplazo de empaquetadura y ajuste de válvula de retorno.',
            fechaReporte: fRep,
            fechaSolucion: fSol,
            createdAt: fRep,
            updatedAt: fSol,
          }
        });
        totalIncidentesCreados++;
      }

      // Mantenimientos para esta máquina en el mes actual
      const mantCount = await prisma.mantenimientoMaquinaria.count({
        where: { maquinariaId: m.id, createdAt: { gte: startOfMonth, lte: endOfPeriod } }
      });

      if (mantCount === 0) {
        const fEjec = randomDate(startOfMonth, endOfPeriod);
        await prisma.mantenimientoMaquinaria.create({
          data: {
            maquinariaId: m.id,
            tecnicoId: tecnicoAg.id,
            tipo: getRandomItem(['PREVENTIVO', 'PREVENTIVO', 'CORRECTIVO']),
            estado: 'FINALIZADO',
            observaciones: 'Calibración, limpieza de filtro y prueba de caudal satisfactoria.',
            costoTotal: getRandomItem([35.00, 50.00, 75.00]),
            fechaMantenimiento: fEjec,
            fechaProgramada: fEjec,
            fechaEjecucion: fEjec,
            createdAt: fEjec,
            updatedAt: fEjec,
          }
        });
        totalMantenimientosCreados++;
      }
    }

    // E. Abastecimiento (Inventario, Salud de Stock y Alertas)
    const stocksAg = await prisma.stockUbicacion.findMany({
      where: { agenciaId: ag.id }
    });

    if (stocksAg.length < 5) {
      const muestraInsumos = insumos.slice(0, 6);
      const perfilesStock = [
        { cant: 25, min: 5 },
        { cant: 20, min: 5 },
        { cant: 12, min: 5 },
        { cant: 4,  min: 5 },
        { cant: 2,  min: 5 },
        { cant: 0,  min: 5 },
      ];

      for (let j = 0; j < muestraInsumos.length; j++) {
        const ins = muestraInsumos[j];
        const perfil = perfilesStock[j % perfilesStock.length];

        const existe = stocksAg.find(s => s.insumoId === ins.id);
        if (!existe) {
          await prisma.stockUbicacion.create({
            data: {
              agenciaId: ag.id,
              insumoId: ins.id,
              tipoUbicacion: 'AGENCIA',
              cantidadActual: perfil.cant,
              cantidadMinima: perfil.min,
            }
          });
          totalStocksCreados++;
        } else {
          await prisma.stockUbicacion.update({
            where: { id: existe.id },
            data: {
              cantidadActual: perfil.cant,
              cantidadMinima: perfil.min,
            }
          });
        }
      }

      // Alertas de Stock para la agencia en el mes actual
      const alertasCount = await prisma.alertaStock.count({
        where: { agenciaId: ag.id, createdAt: { gte: startOfMonth, lte: endOfPeriod } }
      });

      if (alertasCount === 0) {
        const insBajo = muestraInsumos[3];
        const insAgotado = muestraInsumos[5];

        await prisma.alertaStock.create({
          data: {
            agenciaId: ag.id,
            insumoId: insBajo.id,
            nivel: 'BAJO',
            estado: 'PENDIENTE',
            usuarioEmisorId: operadorAg.id,
            mensaje: `Stock bajo en ${insBajo.nombre} en la sede`,
            stockReportado: 4,
            createdAt: randomDate(startOfMonth, endOfPeriod),
          }
        });

        await prisma.alertaStock.create({
          data: {
            agenciaId: ag.id,
            insumoId: insAgotado.id,
            nivel: 'CRITICO',
            estado: 'PENDIENTE',
            usuarioEmisorId: operadorAg.id,
            mensaje: `Stock agotado en ${insAgotado.nombre}`,
            stockReportado: 0,
            createdAt: randomDate(startOfMonth, endOfPeriod),
          }
        });
        totalAlertasCreadas += 2;
      }

      // Movimiento / Despacho de Inventario
      const movCount = await prisma.movimientoInventario.count({
        where: { destinoAgenciaId: ag.id, createdAt: { gte: startOfMonth, lte: endOfPeriod } }
      });

      if (movCount === 0) {
        const fDesp = randomDate(startOfMonth, endOfPeriod);
        await prisma.movimientoInventario.create({
          data: {
            numeroGuia: `GUIA-${ag.codigo || ag.id.slice(0, 6)}-${getRandomNumber(1000, 9999)}`,
            tipo: 'DESPACHO_AGENCIA',
            estadoDespacho: 'RECIBIDO',
            origenUbicacion: 'Bodega Central Quito',
            destinoUbicacion: ag.nombre,
            destinoAgenciaId: ag.id,
            usuarioDespachaId: defaultUser.id,
            usuarioRecibeId: liderAg.id,
            fechaDespacho: fDesp,
            fechaRecepcion: new Date(fDesp.getTime() + 24 * 3600000),
            createdAt: fDesp,
            updatedAt: fDesp,
            detalles: {
              create: [
                {
                  insumoId: muestraInsumos[0].id,
                  cantidadEnviada: 10,
                  cantidadRecibida: 10,
                },
                {
                  insumoId: muestraInsumos[1].id,
                  cantidadEnviada: 5,
                  cantidadRecibida: 5,
                }
              ]
            }
          }
        });
      }
    }
  }

  console.log('\n=============================================');
  console.log('✅ Siembra Integral del Dashboard Finalizada con Éxito!');
  console.log(`- Servicios de Lavado Creados: ${totalServiciosCreados}`);
  console.log(`- Solicitudes de Aprobación Creadas: ${totalSolicitudesCreadas}`);
  console.log(`- Maquinarias Creadas: ${totalMaquinariasCreadas}`);
  console.log(`- Incidentes Técnicos Creados: ${totalIncidentesCreados}`);
  console.log(`- Mantenimientos Creados: ${totalMantenimientosCreados}`);
  console.log(`- Posiciones de Stock Creadas: ${totalStocksCreados}`);
  console.log(`- Alertas de Stock Creadas: ${totalAlertasCreadas}`);
  console.log('=============================================\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
