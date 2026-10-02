import { PrismaClient, ServiceStatus } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

function randomDate(start: Date, end: Date) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function getRandomItem(arr: any[]) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomNumber(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function main() {
  console.log('Iniciando poblado de datos ficticios para el dashboard...');

  // 1. Obtener datos base
  const agencias = await prisma.agencia.findMany({ include: { bahias: true } });
  if (agencias.length === 0) throw new Error('No hay agencias en la BD.');

  const operadores = await prisma.user.findMany({ where: { role: { namerol: 'PULIDOR' } } });
  if (operadores.length === 0) throw new Error('No hay operadores (PULIDOR) en la BD.');

  const catalogos = await prisma.catalogoServicio.findMany();
  if (catalogos.length === 0) throw new Error('No hay servicios en el catálogo.');

  const insumos = await prisma.insumo.findMany();
  if (insumos.length === 0) throw new Error('No hay insumos.');

  const maquinarias = await prisma.maquinaria.findMany();
  if (maquinarias.length === 0) {
    console.log('No hay maquinarias, creando algunas...');
    for (const ag of agencias) {
      await prisma.maquinaria.create({
        data: {
          codigo: `MQ-${ag.codigo}-${getRandomNumber(100, 999)}`,
          nombre: `Hidrolavadora Industrial ${getRandomNumber(1, 10)}`,
          tipo: 'HIDROLAVADORA',
          agenciaId: ag.id,
          estadoOperativo: getRandomItem(['OPERATIVA', 'EN_MANTENIMIENTO', 'OPERATIVA'])
        }
      });
      await prisma.maquinaria.create({
        data: {
          codigo: `MQ-${ag.codigo}-${getRandomNumber(100, 999)}`,
          nombre: `Aspiradora Seco Húmedo ${getRandomNumber(1, 10)}`,
          tipo: 'ASPIRADORA',
          agenciaId: ag.id,
          estadoOperativo: getRandomItem(['OPERATIVA', 'OPERATIVA', 'DE_BAJA'])
        }
      });
    }
  }
  const allMaquinarias = await prisma.maquinaria.findMany();

  // 2. Generar Servicios Lavado para los últimos 30 días
  const today = new Date();
  const past30Days = new Date(today);
  past30Days.setDate(past30Days.getDate() - 30);

  console.log('Generando 1500 servicios de lavado ficticios...');
  const serviciosData = [];
  const consumosData = [];

  for (let i = 0; i < 1500; i++) {
    const agencia = getRandomItem(agencias);
    if (agencia.bahias.length === 0) continue;
    const bahia = getRandomItem(agencia.bahias);
    const operador = getRandomItem(operadores);
    const catalogo = getRandomItem(catalogos);
    
    // Distribuir más servicios históricos
    const isHoy = Math.random() > 0.9; // Solo 10% de los servicios son estrictamente de hoy
    
    let fechaBase: Date;
    if (isHoy) {
      fechaBase = new Date(today.getFullYear(), today.getMonth(), today.getDate(), getRandomNumber(7, 20), getRandomNumber(0, 59));
    } else {
      fechaBase = randomDate(past30Days, today);
      fechaBase.setHours(getRandomNumber(7, 20));
    }

    const estado = getRandomItem([ServiceStatus.FINALIZADO, ServiceStatus.FINALIZADO, ServiceStatus.EN_PROCESO, ServiceStatus.CANCELADO, ServiceStatus.FINALIZADO]);
    
    let horaInicio = null;
    let horaSalida = null;
    
    if (estado !== ServiceStatus.EN_ESPERA && estado !== ServiceStatus.CANCELADO) {
      horaInicio = new Date(fechaBase.getTime() + getRandomNumber(1, 15) * 60000); // 1-15 min después del ingreso
      if (estado === ServiceStatus.FINALIZADO) {
        horaSalida = new Date(horaInicio.getTime() + getRandomNumber(20, 60) * 60000); // 20-60 min de lavado
      }
    }

    const servicioId = crypto.randomUUID();
    
    await prisma.servicioLavado.create({
      data: {
        id: servicioId,
        clientUuid: crypto.randomUUID(),
        ordenTrabajoOT: `OT-SIM-${getRandomNumber(1000, 9999)}`,
        placa: `SIM-${getRandomNumber(100, 999)}`,
        marca: getRandomItem(['Toyota', 'Chevrolet', 'Kia', 'Hyundai', 'Nissan']),
        modelo: 'Generico',
        color: getRandomItem(['Rojo', 'Azul', 'Blanco', 'Negro', 'Gris']),
        estado,
        bahiaId: bahia.id,
        servicioCatalogoId: catalogo.id,
        operadorId: operador.id,
        horaIngreso: fechaBase,
        horaInicio,
        horaSalida
      }
    });

    if (estado === ServiceStatus.FINALIZADO) {
      // Generar consumos
      const qtyInsumos = getRandomNumber(1, 4);
      for (let j = 0; j < qtyInsumos; j++) {
        const insumo = getRandomItem(insumos);
        await prisma.consumoServicio.create({
          data: {
            servicioId,
            insumoId: insumo.id,
            cantidadUsada: getRandomNumber(1, 5) / 10,
            agenciaId: agencia.id,
            insumoNombre: insumo.nombre,
            insumoSKU: insumo.codigoSKU,
            createdAt: horaSalida || new Date()
          }
        });
      }
    }
  }

  // 3. Generar Incidentes
  console.log('Generando 20 incidentes técnicos ficticios...');
  for (let i = 0; i < 20; i++) {
    const maquina = getRandomItem(allMaquinarias);
    const operador = getRandomItem(operadores);
    const fechaReporte = randomDate(past30Days, today);
    const estado = getRandomItem(['ABIERTO', 'EN_PROCESO', 'RESUELTO', 'RESUELTO']);
    
    await prisma.incidenteTecnico.create({
      data: {
        maquinariaId: maquina.id,
        reportadoPorId: operador.id,
        titulo: `Falla en ${maquina.nombre}`,
        descripcion: 'Simulación de daño reportado.',
        gravedad: getRandomItem(['BAJA', 'MEDIA', 'ALTA', 'CRITICA']),
        estado,
        fechaReporte,
        fechaSolucion: estado === 'RESUELTO' ? new Date(fechaReporte.getTime() + getRandomNumber(24, 72) * 3600000) : null,
        createdAt: fechaReporte
      }
    });
  }

  // 4. Generar Alertas Stock
  console.log('Generando 15 alertas de stock ficticias...');
  for (let i = 0; i < 15; i++) {
    const agencia = getRandomItem(agencias);
    const insumo = getRandomItem(insumos);
    const operador = getRandomItem(operadores);
    const fecha = randomDate(past30Days, today);
    const nivel = getRandomItem(['BAJO', 'CRITICO', 'AGOTADO']);
    
    await prisma.alertaStock.create({
      data: {
        insumoId: insumo.id,
        nivel,
        estado: getRandomItem(['PENDIENTE', 'DESPACHADO', 'RESUELTO']),
        agenciaId: agencia.id,
        usuarioEmisorId: operador.id,
        mensaje: `Stock ${nivel} en ${insumo.nombre}`,
        stockReportado: getRandomNumber(0, 5),
        createdAt: fecha
      }
    });
  }

  console.log('✅ Poblamiento finalizado con éxito.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
