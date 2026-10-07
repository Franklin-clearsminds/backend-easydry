import { PrismaClient } from '@prisma/client';
import type { TipoNotificacion } from '@prisma/client';

const prisma = new PrismaClient();
const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

const escenarios: Array<{
  key: string;
  tipo: TipoNotificacion;
  modulo: string;
  titulo: string;
  mensaje: string;
  data: Record<string, string | number | boolean>;
}> = [
  {
    key: 'stock-bajo',
    tipo: 'STOCK_CRITICO',
    modulo: 'inventario',
    titulo: 'Stock bajo: Shampoo neutro (SIMULACIÓN)',
    mensaje: 'Ambacar Américas: quedan 3 unidades; el mínimo configurado es 10.',
    data: { insumo: 'Shampoo neutro', stockActual: 3, stockMinimo: 10, nivel: 'BAJO' },
  },
  {
    key: 'mantenimiento-asignado',
    tipo: 'MANTENIMIENTO_ASIGNADO',
    modulo: 'mantenimiento',
    titulo: 'Mantenimiento asignado (SIMULACIÓN)',
    mensaje: 'Se asignó el mantenimiento preventivo de la hidrolavadora AMB-MAQ-01.',
    data: { maquinaria: 'AMB-MAQ-01', estado: 'PENDIENTE' },
  },
  {
    key: 'mantenimiento-vencido',
    tipo: 'MANTENIMIENTO_VENCIDO',
    modulo: 'mantenimiento',
    titulo: 'Mantenimiento vencido (SIMULACIÓN)',
    mensaje: 'El mantenimiento preventivo de AMB-MAQ-01 está pendiente desde hoy.',
    data: { maquinaria: 'AMB-MAQ-01', estado: 'VENCIDO' },
  },
  {
    key: 'incidente-nuevo',
    tipo: 'INCIDENTE_NUEVO',
    modulo: 'mantenimiento',
    titulo: 'Nueva incidencia técnica (SIMULACIÓN)',
    mensaje: 'Se reportó una fuga en la hidrolavadora de Ambacar Américas.',
    data: { maquinaria: 'AMB-MAQ-01', gravedad: 'MEDIA' },
  },
  {
    key: 'incidencia-asignada',
    tipo: 'INCIDENCIA_ASIGNADA',
    modulo: 'mantenimiento',
    titulo: 'Incidencia asignada (SIMULACIÓN)',
    mensaje: 'La incidencia de AMB-MAQ-01 fue asignada al técnico de turno.',
    data: { maquinaria: 'AMB-MAQ-01', tecnico: 'Técnico de turno' },
  },
  {
    key: 'incidencia-resuelta',
    tipo: 'INCIDENCIA_RESUELTA',
    modulo: 'mantenimiento',
    titulo: 'Incidencia resuelta (SIMULACIÓN)',
    mensaje: 'La fuga reportada en AMB-MAQ-01 fue reparada y verificada.',
    data: { maquinaria: 'AMB-MAQ-01', estado: 'RESUELTA' },
  },
  {
    key: 'aprobacion-pendiente',
    tipo: 'APROBACION_PENDIENTE',
    modulo: 'aprobaciones',
    titulo: 'Aprobación pendiente (SIMULACIÓN)',
    mensaje: 'El cierre de servicios de Ambacar Américas requiere revisión.',
    data: { agencia: 'Ambacar Américas', cantidadServicios: 4 },
  },
  {
    key: 'despacho-pendiente',
    tipo: 'DESPACHO_PENDIENTE',
    modulo: 'envios',
    titulo: 'Envío en tránsito (SIMULACIÓN)',
    mensaje: 'El despacho DEMO-AMB-001 salió hacia Ambacar Américas y espera recepción.',
    data: { guia: 'DEMO-AMB-001', estado: 'EN_TRANSITO' },
  },
  {
    key: 'recepcion-completa',
    tipo: 'DESPACHO_CONFIRMADO',
    modulo: 'envios',
    titulo: 'Recepción completa (SIMULACIÓN)',
    mensaje: 'Ambacar Américas recibió completas las 10 unidades del despacho DEMO-AMB-002.',
    data: { guia: 'DEMO-AMB-002', cantidadEnviada: 10, cantidadRecibida: 10, completa: true },
  },
  {
    key: 'recepcion-incompleta',
    tipo: 'DESPACHO_CONFIRMADO',
    modulo: 'envios',
    titulo: 'Recepción incompleta (SIMULACIÓN)',
    mensaje: 'Ambacar Américas recibió 8 de las 10 unidades del despacho DEMO-AMB-003.',
    data: { guia: 'DEMO-AMB-003', cantidadEnviada: 10, cantidadRecibida: 8, completa: false },
  },
  {
    key: 'limpieza-recordatorio',
    tipo: 'LIMPIEZA_RECORDATORIO',
    modulo: 'mantenimiento',
    titulo: 'Limpieza programada para hoy (SIMULACIÓN)',
    mensaje: 'La maquinaria AMB-MAQ-01 tiene limpieza programada para hoy.',
    data: { maquinaria: 'AMB-MAQ-01' },
  },
  {
    key: 'limpieza-atrasada',
    tipo: 'LIMPIEZA_ATRASADA',
    modulo: 'mantenimiento',
    titulo: 'Limpieza atrasada (SIMULACIÓN)',
    mensaje: 'La limpieza programada de AMB-MAQ-01 sigue pendiente.',
    data: { maquinaria: 'AMB-MAQ-01' },
  },
  {
    key: 'servicio-general-aprobado',
    tipo: 'SERVICIO_DECIDIDO',
    modulo: 'servicios-generales',
    titulo: 'Servicio general aprobado (SIMULACIÓN)',
    mensaje: 'El servicio general DEMO-LV-001 quedó aprobado en Ambacar Américas.',
    data: { orden: 'DEMO-LV-001', decision: 'APROBADO' },
  },
  {
    key: 'servicio-general-rechazado',
    tipo: 'SERVICIO_DECIDIDO',
    modulo: 'servicios-generales',
    titulo: 'Servicio general observado (SIMULACIÓN)',
    mensaje: 'El servicio general DEMO-LV-002 requiere corregir su evidencia.',
    data: { orden: 'DEMO-LV-002', decision: 'RECHAZADO' },
  },
  {
    key: 'servicio-especial-asignado',
    tipo: 'SERVICIO_ESPECIAL_ASIGNADO',
    modulo: 'servicios-especiales',
    titulo: 'Servicio especial asignado (SIMULACIÓN)',
    mensaje: 'El pulido DEMO-SE-001 fue asignado a un operador de Ambacar Américas.',
    data: { orden: 'DEMO-SE-001', servicio: 'Pulido' },
  },
  {
    key: 'servicio-especial-cerrado',
    tipo: 'SERVICIO_ESPECIAL_CERRADO',
    modulo: 'servicios-especiales',
    titulo: 'Servicio especial cerrado (SIMULACIÓN)',
    mensaje: 'El recubrimiento cerámico DEMO-SE-002 se completó y cerró.',
    data: { orden: 'DEMO-SE-002', servicio: 'Recubrimiento cerámico', estado: 'Completado' },
  },
  {
    key: 'reto-cerrado',
    tipo: 'RETO_CERRADO',
    modulo: 'productividad',
    titulo: 'Reto de productividad finalizado (SIMULACIÓN)',
    mensaje: 'El reto de productividad de Ambacar Américas ya tiene resultados.',
    data: { reto: 'DEMO-RETO-001', estado: 'CERRADO' },
  },
  {
    key: 'maquina-dada-de-baja',
    tipo: 'MAQUINA_DADA_DE_BAJA',
    modulo: 'maquinaria',
    titulo: 'Maquinaria dada de baja (SIMULACIÓN)',
    mensaje: 'El equipo DEMO-MAQ-002 fue dado de baja en Ambacar Américas.',
    data: { maquinaria: 'DEMO-MAQ-002', estado: 'DE_BAJA' },
  },
  {
    key: 'usuario-actualizado',
    tipo: 'USUARIO_ACTUALIZADO',
    modulo: 'usuarios',
    titulo: 'Usuario actualizado (SIMULACIÓN)',
    mensaje: 'Se actualizaron los datos de acceso de un usuario de Ambacar Américas.',
    data: { agencia: 'Ambacar Américas', camposActualizados: 'rol y estado' },
  },
];

function obtenerDiaLocal(): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Guayaquil',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const valores = Object.fromEntries(partes.map(({ type, value }) => [type, value]));
  return `${valores.year}-${valores.month}-${valores.day}`;
}

function validarDestinoLocal(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('La simulación está bloqueada cuando NODE_ENV=production.');
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Falta DATABASE_URL; no se ejecutó ningún cambio.');

  let host: string;
  try {
    host = new URL(databaseUrl).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    throw new Error('DATABASE_URL no es una URL válida; no se ejecutó ningún cambio.');
  }
  if (!LOCAL_DATABASE_HOSTS.has(host)) {
    throw new Error(`La simulación solo admite una base local; host detectado: ${host}.`);
  }
}

async function main(): Promise<void> {
  validarDestinoLocal();

  const agenciasAmbacar = await prisma.agencia.findMany({
    where: { nombre: { contains: 'Ambacar', mode: 'insensitive' } },
    select: { id: true, nombre: true, regionId: true },
  });
  const agencias = agenciasAmbacar.filter((agencia) =>
    agencia.nombre.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().includes('america'),
  );
  if (agencias.length !== 1) {
    throw new Error(
      agencias.length === 0
        ? 'No se encontró una agencia Ambacar Américas en la base local; no se crearon datos.'
        : 'Hay varias agencias candidatas de Ambacar Américas; no se crearon datos.',
    );
  }
  const agencia = agencias[0];

  const alcanceRegional = agencia.regionId
    ? [{
        role: { namerol: { in: ['COORD_MANTENIMIENTO', 'COORD_SERVICIOS_ESPECIALES', 'SUPERVISOR'] } },
        regionId: agencia.regionId,
      }]
    : [];
  const usuarios = await prisma.user.findMany({
    where: {
      estado: 1,
      OR: [
        { agenciaId: agencia.id },
        { agenciasIds: { has: agencia.id } },
        { role: { namerol: { in: ['ADMIN', 'SUPER_ADMIN', 'COORD_BODEGA'] } } },
        ...alcanceRegional,
      ],
    },
    select: { id: true, role: { select: { namerol: true } } },
  });
  if (usuarios.length === 0) {
    throw new Error('No hay usuarios activos asociados a Ambacar Américas para recibir la simulación.');
  }

  const dia = obtenerDiaLocal();
  const simulacionId = `ambacar-americas-${dia}`;
  const yaExiste = await prisma.notification.count({
    where: { data: { path: ['simulacionId'], equals: simulacionId } },
  });
  const aplicar = process.argv.includes('--apply');
  const cantidad = usuarios.length * escenarios.length;

  console.log(`Agencia: ${agencia.nombre}`);
  console.log(`Usuarios destinatarios activos: ${usuarios.length}`);
  console.log(`Escenarios de notificación: ${escenarios.length}`);
  console.log(`Filas que se crearían: ${cantidad}`);
  console.log(`Escenarios existentes para hoy: ${yaExiste}`);
  console.log(`Modo: ${aplicar ? 'APLICAR' : 'solo vista previa'}`);

  if (!aplicar) {
    console.log('Para guardar las notificaciones en esta base local, vuelve a ejecutar con --apply.');
    return;
  }
  if (yaExiste > 0) {
    throw new Error('La simulación de hoy ya existe; no se duplicaron notificaciones.');
  }

  const ahora = new Date();
  const notificaciones = usuarios.flatMap((usuario) =>
    escenarios.map((escenario) => ({
      userId: usuario.id,
      tipo: escenario.tipo,
      titulo: escenario.titulo,
      mensaje: escenario.mensaje,
      data: {
        ...escenario.data,
        simulacion: true,
        simulacionId,
        escenario: escenario.key,
        modulo: escenario.modulo,
        agenciaId: agencia.id,
        agenciaNombre: agencia.nombre,
      },
      entidadTipo: 'SIMULACION',
      entidadId: `SIM-${dia.replaceAll('-', '')}-${escenario.key}`,
      createdAt: ahora,
    })),
  );

  const resultado = await prisma.notification.createMany({ data: notificaciones });
  console.log(`Simulación guardada. Notificaciones creadas: ${resultado.count}. No se enviaron push ni eventos WebSocket.`);
  for (const escenario of escenarios) {
    console.log(`- ${escenario.tipo}: ${escenario.titulo}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(`No se pudo completar la simulación: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
