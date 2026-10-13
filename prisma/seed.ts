import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { ROLES_BASE } from '../src/common/permisos/roles-base.js';
import { accionesLegacy } from '../src/common/permisos/acciones-legacy.js';
import { modulosDeCapacidades } from '../src/common/permisos/modulos-navegacion.js';

/**
 * Seed idempotente de EasyDry.
 *
 * Por defecto NO borra nada: crea lo que falta (módulos, los 15 roles oficiales con sus permisos, catálogos base de inventario
 * y las cuentas Super Admin y Admin) y deja intacto lo que ya existe.
 *
 * Variables de entorno:
 *   SEED_SUPERADMIN_EMAIL / SEED_SUPERADMIN_PASSWORD   cuenta Super Admin (la contraseña es obligatoria)
 *   SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD             cuenta Admin (la contraseña es obligatoria)
 *   SEED_ACTUALIZAR_ROLES=SI     restablece los permisos de los roles oficiales a los valores de fábrica
 *   SEED_RESET=SI                VACÍA toda la base antes de sembrar (en producción exige además SEED_CONFIRMAR_PRODUCCION=SI)
 */
const prisma = new PrismaClient();

const esProduccion = process.env.NODE_ENV === 'production';

function credencial(nombre: string, valorPorDefecto?: string): string {
  const valor = process.env[nombre]?.trim();
  if (valor) return valor;
  if (valorPorDefecto !== undefined) return valorPorDefecto;
  throw new Error(`Falta la variable de entorno ${nombre} (defínela en el .env o en el entorno).`);
}

/** Catálogo oficial de módulos — fuente de verdad sembrada en BD */
const MODULOS_DATA = [
  { codigo: 'dashboard', nombre: 'Dashboard Principal', descripcion: 'Métricas clave, KPIs generales, gráficos de rendimiento y alertas de la red', icono: 'layout-dashboard', rutaPrincipal: '/dashboard', grupo: 'Panel Principal', disponibleEnApp: true, orden: 10 },
  { codigo: 'notificaciones', nombre: 'Centro de Notificaciones', descripcion: 'Alertas operativas, aprobaciones pendientes, inventario y avisos del sistema', icono: 'bell', rutaPrincipal: '/notificaciones', grupo: 'Panel Principal', disponibleEnApp: true, orden: 30 },
  { codigo: 'agencias', nombre: 'Control de Agencias', descripcion: 'Gestión y estado operativo de las agencias de la red', icono: 'building-2', rutaPrincipal: '/agencias', grupo: 'Operación & Agencias', disponibleEnApp: false, orden: 40 },
  { codigo: 'operadores', nombre: 'Gestión de Lavadores', descripcion: 'Directorio, métricas y estado del personal de lavado', icono: 'user-check', rutaPrincipal: '/operadores', grupo: 'Operación & Agencias', disponibleEnApp: true, orden: 50 },
  { codigo: 'asignaciones', nombre: 'Asignación de Bahías', descripcion: 'Matriz dinámica para asignar operadores a bahías con historial', icono: 'check-circle-2', rutaPrincipal: '/asignaciones', grupo: 'Operación & Agencias', disponibleEnApp: false, orden: 60 },
  { codigo: 'configuracion/servicios', nombre: 'Catálogo de Servicios', descripcion: 'Tarifario, tipos de lavado y políticas de evidencias (foto/video)', icono: 'file-text', rutaPrincipal: '/configuracion/servicios', grupo: 'Servicios de Lavado', disponibleEnApp: false, orden: 70 },
  { codigo: 'servicios', nombre: 'Servicios de Lavado (OT)', descripcion: 'Digitalización de Hoja de Control, ingreso de placas y registro de vehículos', icono: 'car', rutaPrincipal: '/servicios', grupo: 'Servicios de Lavado', disponibleEnApp: true, orden: 80 },
  { codigo: 'aprobaciones', nombre: 'Aprobaciones y Cierre Diario', descripcion: 'Auditoría gerencial de evidencias y aprobación de servicios para cierre de día', icono: 'shield-check', rutaPrincipal: '/aprobaciones', grupo: 'Servicios de Lavado', disponibleEnApp: true, orden: 90 },
  { codigo: 'productividad', nombre: 'Productividad & Reto EasyDry', descripcion: 'Comparativa de agencias y ranking mensual de operarios', icono: 'trophy', rutaPrincipal: '/productividad', grupo: 'Servicios de Lavado', disponibleEnApp: false, orden: 100 },
  { codigo: 'maquinaria', nombre: 'Maquinaria & Equipos', descripcion: 'Inventario de activos industriales y trazabilidad de transferencias', icono: 'hard-drive', rutaPrincipal: '/maquinaria', grupo: 'Gestión de Activos', disponibleEnApp: true, orden: 110 },
  { codigo: 'taller-tecnico', nombre: 'Taller Técnico e Incidentes', descripcion: 'Control de mantenimientos preventivos y reporte/resolución de incidencias', icono: 'wrench', rutaPrincipal: '/taller-tecnico', grupo: 'Gestión de Activos', disponibleEnApp: true, orden: 120 },
  { codigo: 'inventario', nombre: 'Inventario de Insumos & Bodega', descripcion: 'Control de stock central vs sucursales, tipos de producto, envases, transferencias y alertas', icono: 'boxes', rutaPrincipal: '/inventario', grupo: 'Gestión de Activos', disponibleEnApp: true, orden: 130 },
  { codigo: 'envios', nombre: 'Envíos & Confirmación', descripcion: 'Control logístico de envíos de suministros y confirmación de recepción en agencia', icono: 'send', rutaPrincipal: '/envios', grupo: 'Gestión de Activos', disponibleEnApp: true, orden: 140 },
  { codigo: 'reportes', nombre: 'Reportes Operativos', descripcion: 'Generación e impresión de informes consolidados de servicios y rendimiento', icono: 'file-bar-chart', rutaPrincipal: '/reportes', grupo: 'Administración', disponibleEnApp: false, orden: 150 },
  { codigo: 'usuarios', nombre: 'Usuarios, Roles y Permisos', descripcion: 'Directorio de colaboradores y matriz de creación/configuración de roles dinámicos', icono: 'users', rutaPrincipal: '/usuarios', grupo: 'Administración', disponibleEnApp: false, orden: 160 },
  { codigo: 'perfil', nombre: 'Mi Perfil de Usuario', descripcion: 'Información personal, credenciales y datos de sucursal', icono: 'user', rutaPrincipal: '/perfil', grupo: 'Mi Cuenta', disponibleEnApp: true, orden: 170 },
];


async function main() {
  const reset = process.env.SEED_RESET === 'SI';

  if (reset) {
    if (esProduccion && process.env.SEED_CONFIRMAR_PRODUCCION !== 'SI') {
      throw new Error('SEED_RESET vaciaría la base de PRODUCCIÓN. Si es lo que quieres, define también SEED_CONFIRMAR_PRODUCCION=SI.');
    }
    console.log('🧹 Vaciando toda la base de datos EasyDry (SEED_RESET=SI)...');
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename != '_prisma_migrations';
    `;
    for (const { tablename } of tables) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${tablename}" CASCADE;`);
    }
    console.log('✅ Base de datos vaciada.');
  }

  // 1. Módulos del sistema
  console.log('📦 Sembrando catálogo de módulos del sistema...');
  for (const m of MODULOS_DATA) {
    await prisma.moduloSistema.upsert({
      where: { codigo: m.codigo },
      update: { nombre: m.nombre, descripcion: m.descripcion, icono: m.icono, rutaPrincipal: m.rutaPrincipal, grupo: m.grupo, orden: m.orden, disponibleEnApp: m.disponibleEnApp },
      create: {
        id: randomUUID(),
        codigo: m.codigo,
        nombre: m.nombre,
        descripcion: m.descripcion,
        icono: m.icono,
        rutaPrincipal: m.rutaPrincipal,
        grupo: m.grupo,
        orden: m.orden,
        disponibleEnApp: m.disponibleEnApp,
        estado: 1,
      },
    });
  }

  // 2. Los 15 roles oficiales, con los permisos que exige el backend
  console.log('🛡️ Sembrando roles oficiales con permisos, ámbito y acciones...');
  const actualizarRoles = reset || process.env.SEED_ACTUALIZAR_ROLES === 'SI';
  const rolesMap = new Map<string, string>();
  for (const r of ROLES_BASE) {
    const datos = {
      descripcion: r.descripcion,
      estado: 1,
      permisos: modulosDeCapacidades(r.capacidades, r.namerol),
      capacidades: r.capacidades,
      ambito: r.ambito,
      esSistema: true,
      acciones: accionesLegacy(r.capacidades, r.ambito) as unknown as Prisma.InputJsonValue,
    };
    const existente = await prisma.role.findUnique({ where: { namerol: r.namerol } });
    if (!existente) {
      const creado = await prisma.role.create({ data: { namerol: r.namerol, ...datos } });
      rolesMap.set(r.namerol, creado.id);
    } else if (actualizarRoles) {
      await prisma.role.update({ where: { id: existente.id }, data: datos });
      rolesMap.set(r.namerol, existente.id);
    } else {
      // Se respetan los permisos que el Super Admin haya ajustado; solo se marca como rol oficial.
      // El ámbito NO es una preferencia ajustable: es una invariante estructural del rol (define qué
      // región/agencia/registros propios puede ver y asignar), así que el seed lo fuerza siempre,
      // aunque no se pida actualizar el resto de permisos. Si difiere, también se recalculan las
      // acciones legacy con las capacidades actuales (las del Super Admin) y el ámbito correcto.
      const datosForzados: Prisma.RoleUpdateInput = { esSistema: true };
      if (existente.ambito !== r.ambito) {
        datosForzados.ambito = r.ambito;
        datosForzados.acciones = accionesLegacy(existente.capacidades, r.ambito) as unknown as Prisma.InputJsonValue;
      }
      await prisma.role.update({ where: { id: existente.id }, data: datosForzados });
      rolesMap.set(r.namerol, existente.id);
    }
  }

  // 2b. Roles tal como estaban en la base (prisma/roles-actuales.json), para no perder los ajustes hechos en la plataforma.
  if (process.env.SEED_ROLES_ACTUALES === 'SI') {
    const archivo = fileURLToPath(new URL('./roles-actuales.json', import.meta.url));
    const guardados = JSON.parse(fs.readFileSync(archivo, 'utf8')) as Array<{
      namerol: string; descripcion: string | null; estado: number; permisos: string[];
      capacidades: string[]; ambito: string; esSistema: boolean; acciones: Prisma.InputJsonValue | null;
    }>;
    for (const r of guardados) {
      const datos = {
        descripcion: r.descripcion, estado: r.estado, permisos: r.permisos, capacidades: r.capacidades,
        ambito: r.ambito, esSistema: r.esSistema, acciones: (r.acciones ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      };
      const existente = await prisma.role.findUnique({ where: { namerol: r.namerol } });
      if (existente) {
        await prisma.role.update({ where: { id: existente.id }, data: datos });
      } else {
        const creado = await prisma.role.create({ data: { namerol: r.namerol, ...datos } });
        rolesMap.set(r.namerol, creado.id);
      }
      rolesMap.set(r.namerol, (await prisma.role.findUnique({ where: { namerol: r.namerol } }))!.id);
    }
    console.log(`🛡️ Roles restaurados desde roles-actuales.json (${guardados.length})`);
  }

  // 3. Cuentas Super Admin y Admin
  console.log('👥 Verificando cuentas Super Admin y Admin...');
  const cuentas = [
    {
      rol: 'SUPER_ADMIN',
      email: credencial('SEED_SUPERADMIN_EMAIL', 'superadmin@easydry.com').toLowerCase(),
      password: credencial('SEED_SUPERADMIN_PASSWORD'),
      name: 'Super',
      lastname: 'Admin',
    },
    {
      rol: 'ADMIN',
      email: credencial('SEED_ADMIN_EMAIL', 'admin@easydry.com').toLowerCase(),
      password: credencial('SEED_ADMIN_PASSWORD'),
      name: 'Administrador',
      lastname: 'EasyDry',
    },
  ];
  for (const c of cuentas) {
    const existe = await prisma.user.findUnique({ where: { email: c.email } });
    if (existe) continue;
    await prisma.user.create({
      data: {
        email: c.email,
        passwordHash: await bcrypt.hash(c.password, 10),
        name: c.name,
        lastname: c.lastname,
        roleId: rolesMap.get(c.rol)!,
        agenciaId: null,
        agenciasIds: [],
        regionId: null,
        estado: 1,
      },
    });
    console.log(`   ✔ Creada la cuenta ${c.rol}: ${c.email}`);
  }

  // 4. Catálogos base de inventario (solo si están vacíos)
  console.log('📦 Sembrando catálogos dinámicos de inventario...');

  const tiposProductoData = [
    { codigo: 'LIQUIDO', nombre: 'Líquido', descripcion: 'Productos en estado líquido de dosificación volumétrica', estado: 1 },
    { codigo: 'POLVO', nombre: 'Polvo', descripcion: 'Insumos en polvo de disolución o aplicación directa', estado: 1 },
    { codigo: 'SOLIDO', nombre: 'Sólido', descripcion: 'Pastas, ceras duras o bloques sólidos', estado: 1 },
    { codigo: 'UNIDAD', nombre: 'Unidad', descripcion: 'Piezas, herramientas o accesorios unitarios', estado: 1 },
    { codigo: 'TEXTIL', nombre: 'Textil / Microfibra', descripcion: 'Paños, toallas y aplicadores textiles', estado: 1 },
  ];
  if ((await prisma.tipoProducto.count()) === 0) {
    for (const tp of tiposProductoData) await prisma.tipoProducto.create({ data: tp });
  }

  const unidadesData = [
    { codigo: 'ML', nombre: 'Mililitro', simbolo: 'ml', tipo: 'VOLUMEN', factorBase: 0.001, estado: 1 },
    { codigo: 'L', nombre: 'Litro', simbolo: 'L', tipo: 'VOLUMEN', factorBase: 1.0, estado: 1 },
    { codigo: 'GAL', nombre: 'Galón', simbolo: 'gal', tipo: 'VOLUMEN', factorBase: 3.78541, estado: 1 },
    { codigo: 'G', nombre: 'Gramo', simbolo: 'g', tipo: 'MASA', factorBase: 0.001, estado: 1 },
    { codigo: 'KG', nombre: 'Kilogramo', simbolo: 'kg', tipo: 'MASA', factorBase: 1.0, estado: 1 },
    { codigo: 'UND', nombre: 'Unidad', simbolo: 'und', tipo: 'UNITARIO', factorBase: 1.0, estado: 1 },
  ];
  if ((await prisma.unidadMedida.count()) === 0) {
    for (const u of unidadesData) await prisma.unidadMedida.create({ data: u });
  }

  const tiposMovData = [
    { codigo: 'ENTRY', nombre: 'Ingreso', descripcion: 'Ingreso físico de producto al inventario (compra / abastecimiento)', esEntrada: true, estado: 1 },
    { codigo: 'CONSUMPTION', nombre: 'Consumo', descripcion: 'Consumo o gasto de producto en operaciones', esEntrada: false, estado: 1 },
    { codigo: 'POSITIVE_ADJUSTMENT', nombre: 'Ajuste (+)', descripcion: 'Incremento de stock por corrección física', esEntrada: true, estado: 1 },
    { codigo: 'NEGATIVE_ADJUSTMENT', nombre: 'Ajuste (−)', descripcion: 'Disminución de stock por corrección o faltante', esEntrada: false, estado: 1 },
    { codigo: 'WASTE', nombre: 'Merma', descripcion: 'Baja de producto por daño, derrame o caducidad', esEntrada: false, estado: 1 },
    { codigo: 'RETURN', nombre: 'Devolución', descripcion: 'Devolución de producto al proveedor o almacén', esEntrada: true, estado: 1 },
    { codigo: 'TRANSFER', nombre: 'Envío / Transferencia', descripcion: 'Movimiento entre bodegas o ubicaciones', esEntrada: false, estado: 1 },
  ];
  if ((await prisma.tipoMovimientoInventario.count()) === 0) {
    for (const tm of tiposMovData) await prisma.tipoMovimientoInventario.create({ data: tm });
  }

  // 5. Checklist de mantenimiento: plantillas base de seguridad (solo si no hay ninguna). Se editan desde la plataforma:
  //    cada cambio crea una versión nueva.
  if ((await prisma.checklistPlantilla.count()) === 0) {
    const base: Array<{ tipo: string; nombre: string; pasos: Array<[string, boolean]> }> = [
      {
        tipo: 'PREVENTIVO',
        nombre: 'Checklist de mantenimiento preventivo',
        pasos: [
          ['Desconectar el equipo de la energía y bloquearlo antes de intervenir', true],
          ['Revisar el estado de cables, enchufes y conexiones eléctricas', true],
          ['Revisar mangueras, acoples y uniones: sin fugas ni desgaste', true],
          ['Inspeccionar y limpiar los filtros; reemplazarlos si están dañados', true],
          ['Revisar cepillos, pads y accesorios; reemplazar los desgastados', false],
          ['Lubricar y ajustar las partes móviles según las indicaciones del fabricante', false],
          ['Probar el funcionamiento del equipo antes de devolverlo a operación', true],
          ['Dejar el equipo y el área de trabajo limpios y ordenados', false],
        ],
      },
      {
        tipo: 'CORRECTIVO',
        nombre: 'Checklist de mantenimiento correctivo',
        pasos: [
          ['Desconectar el equipo de la energía y bloquearlo antes de intervenir', true],
          ['Confirmar y registrar la falla reportada (qué ocurre y cuándo)', true],
          ['Identificar el componente o la causa de la falla', true],
          ['Reparar o reemplazar el componente defectuoso', true],
          ['Verificar que la causa de la falla quedó resuelta', true],
          ['Probar el funcionamiento completo del equipo antes de devolverlo a operación', true],
          ['Registrar los repuestos utilizados', false],
        ],
      },
    ];
    for (const p of base) {
      await prisma.checklistPlantilla.create({
        data: {
          tipo: p.tipo,
          nombre: p.nombre,
          version: 1,
          activa: true,
          creadaPorNombre: 'Sistema (plantilla base)',
          pasos: { create: p.pasos.map(([texto, obligatorio], i) => ({ orden: i + 1, texto, obligatorio })) },
        },
      });
    }
    console.log('✅ Plantillas base de checklist de mantenimiento creadas');
  }

  console.log('=====================================================');
  console.log('🚀 Seed ejecutado con éxito');
  console.log(`📦 Módulos: ${MODULOS_DATA.length} | 🛡️ Roles oficiales: ${rolesMap.size}`);
  console.log('=====================================================');
}

main()
  .catch((e) => {
    console.error('❌ Error ejecutando seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
