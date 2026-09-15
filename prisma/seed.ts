import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

type AccionesRol = {
  verTodasSucursales: boolean;
  crearSucursal: boolean;
  editarSucursal: boolean;
  crearUsuarios: boolean;
  asignarRoles: boolean;
  verOtrosSucursales: boolean;
  cambiarSucursalOperador: boolean;
  cambiarBahiaOperador: boolean;
  aprobarServicios: boolean;
  rechazarServicios: boolean;
  cerrarDia: boolean;
  registrarServicio: boolean;
  verTodosServicios: boolean;
  verMaquinaria: boolean;
  gestionarMantenimiento: boolean;
  registrarIncidente: boolean;
  verReportes: boolean;
  verProductividadGlobal: boolean;
  verConfiguracion: boolean;
  gestionarInventario: boolean;
  despacharSuministros: boolean;
  accionesEnvios: boolean;
};

const ACCIONES_VACIAS: AccionesRol = {
  verTodasSucursales: false,
  crearSucursal: false,
  editarSucursal: false,
  crearUsuarios: false,
  asignarRoles: false,
  verOtrosSucursales: false,
  cambiarSucursalOperador: false,
  cambiarBahiaOperador: false,
  aprobarServicios: false,
  rechazarServicios: false,
  cerrarDia: false,
  registrarServicio: false,
  verTodosServicios: false,
  verMaquinaria: false,
  gestionarMantenimiento: false,
  registrarIncidente: false,
  verReportes: false,
  verProductividadGlobal: false,
  verConfiguracion: false,
  gestionarInventario: false,
  despacharSuministros: false,
  accionesEnvios: false,
};

const ACCIONES_FULL: AccionesRol = {
  verTodasSucursales: true,
  crearSucursal: true,
  editarSucursal: true,
  crearUsuarios: true,
  asignarRoles: true,
  verOtrosSucursales: true,
  cambiarSucursalOperador: true,
  cambiarBahiaOperador: true,
  aprobarServicios: true,
  rechazarServicios: true,
  cerrarDia: true,
  registrarServicio: true,
  verTodosServicios: true,
  verMaquinaria: true,
  gestionarMantenimiento: true,
  registrarIncidente: true,
  verReportes: true,
  verProductividadGlobal: true,
  verConfiguracion: true,
  gestionarInventario: true,
  despacharSuministros: true,
  accionesEnvios: true,
};

/** Catálogo oficial de módulos — fuente de verdad sembrada en BD */
const MODULOS_DATA = [
  { codigo: 'dashboard', nombre: 'Dashboard Principal', descripcion: 'Métricas clave, KPIs generales, gráficos de rendimiento y alertas de la red', icono: 'layout-dashboard', rutaPrincipal: '/dashboard', grupo: 'Panel Principal', orden: 10 },
  { codigo: 'mapa-operativo', nombre: 'Mapa Operativo en Vivo', descripcion: 'Trazabilidad visual jerárquica: Agencias, Bahías, Operadores y Maquinaria en tiempo real', icono: 'sliders', rutaPrincipal: '/mapa-operativo', grupo: 'Panel Principal', orden: 20 },
  { codigo: 'notificaciones', nombre: 'Centro de Notificaciones', descripcion: 'Alertas operativas, aprobaciones pendientes, inventario y avisos del sistema', icono: 'bell', rutaPrincipal: '/notificaciones', grupo: 'Panel Principal', orden: 30 },
  { codigo: 'agencias', nombre: 'Control de Agencias', descripcion: 'Gestión y estado operativo de las agencias de la red', icono: 'building-2', rutaPrincipal: '/agencias', grupo: 'Operación & Agencias', orden: 40 },
  { codigo: 'operadores', nombre: 'Gestión de Lavadores', descripcion: 'Directorio, métricas y estado del personal de lavado', icono: 'user-check', rutaPrincipal: '/operadores', grupo: 'Operación & Agencias', orden: 50 },
  { codigo: 'asignaciones', nombre: 'Asignación de Bahías', descripcion: 'Matriz dinámica para asignar operadores a bahías con historial', icono: 'check-circle-2', rutaPrincipal: '/asignaciones', grupo: 'Operación & Agencias', orden: 60 },
  { codigo: 'configuracion/servicios', nombre: 'Catálogo de Servicios', descripcion: 'Tarifario, tipos de lavado y políticas de evidencias (foto/video)', icono: 'file-text', rutaPrincipal: '/configuracion/servicios', grupo: 'Servicios de Lavado', orden: 70 },
  { codigo: 'servicios', nombre: 'Servicios de Lavado (OT)', descripcion: 'Digitalización de Hoja de Control, ingreso de placas y registro de vehículos', icono: 'car', rutaPrincipal: '/servicios', grupo: 'Servicios de Lavado', orden: 80 },
  { codigo: 'aprobaciones', nombre: 'Aprobaciones y Cierre Diario', descripcion: 'Auditoría gerencial de evidencias y aprobación de servicios para cierre de día', icono: 'shield-check', rutaPrincipal: '/aprobaciones', grupo: 'Servicios de Lavado', orden: 90 },
  { codigo: 'productividad', nombre: 'Productividad & Reto EasyDry', descripcion: 'Comparativa de agencias y ranking mensual de operarios', icono: 'trophy', rutaPrincipal: '/productividad', grupo: 'Servicios de Lavado', orden: 100 },
  { codigo: 'maquinaria', nombre: 'Maquinaria & Equipos', descripcion: 'Inventario de activos industriales y trazabilidad de transferencias', icono: 'hard-drive', rutaPrincipal: '/maquinaria', grupo: 'Gestión de Activos', orden: 110 },
  { codigo: 'taller-tecnico', nombre: 'Taller Técnico e Incidentes', descripcion: 'Control de mantenimientos preventivos y reporte/resolución de incidencias', icono: 'wrench', rutaPrincipal: '/taller-tecnico', grupo: 'Gestión de Activos', orden: 120 },
  { codigo: 'inventario', nombre: 'Inventario de Insumos & Bodega', descripcion: 'Control de stock central vs sucursales, tipos de producto, envases, transferencias y alertas', icono: 'boxes', rutaPrincipal: '/inventario', grupo: 'Gestión de Activos', orden: 130 },
  { codigo: 'envios', nombre: 'Envíos & Confirmación', descripcion: 'Control logístico de envíos de suministros y confirmación de recepción en agencia', icono: 'send', rutaPrincipal: '/envios', grupo: 'Gestión de Activos', orden: 140 },
  { codigo: 'reportes', nombre: 'Reportes Operativos', descripcion: 'Generación e impresión de informes consolidados de servicios y rendimiento', icono: 'file-bar-chart', rutaPrincipal: '/reportes', grupo: 'Administración', orden: 150 },
  { codigo: 'usuarios', nombre: 'Usuarios, Roles y Permisos', descripcion: 'Directorio de colaboradores y matriz de creación/configuración de roles dinámicos', icono: 'users', rutaPrincipal: '/usuarios', grupo: 'Administración', orden: 160 },
  { codigo: 'perfil', nombre: 'Mi Perfil de Usuario', descripcion: 'Información personal, credenciales y datos de sucursal', icono: 'user', rutaPrincipal: '/perfil', grupo: 'Mi Cuenta', orden: 170 },
];

const ALL_MODULOS = MODULOS_DATA.map((m) => m.codigo);

type RoleSeed = {
  namerol: string;
  descripcion: string;
  estado: number;
  permisos: string[];
  acciones: AccionesRol;
};

const ROLES_DATA: RoleSeed[] = [
  {
    namerol: 'SUPER_ADMIN',
    descripcion: 'Nivel máximo de la plataforma. Acceso global inmutable: supervisión nacional, auditoría y gobierno del sistema.',
    estado: 1,
    permisos: ALL_MODULOS,
    acciones: ACCIONES_FULL,
  },
  {
    namerol: 'ADMIN',
    descripcion: 'Administrador operativo de la plataforma. Gestiona usuarios, configuración y módulos asignados.',
    estado: 1,
    permisos: ALL_MODULOS,
    acciones: ACCIONES_FULL,
  },
  {
    namerol: 'APROBADOR',
    descripcion: 'Aprobador de agencia. Audita evidencias y aprueba servicios de lavado.',
    estado: 1,
    permisos: ['dashboard', 'notificaciones', 'aprobaciones', 'perfil'],
    acciones: { ...ACCIONES_VACIAS, aprobarServicios: true, rechazarServicios: true },
  },
  {
    namerol: 'SUPERVISOR',
    descripcion: 'Control operativo regional de agencias, operadores, bahías y mapa en vivo.',
    estado: 1,
    permisos: [
      'dashboard', 'notificaciones', 'mapa-operativo', 'agencias', 'operadores', 'asignaciones',
      'servicios', 'configuracion/servicios', 'productividad', 'maquinaria', 'taller-tecnico',
      'inventario', 'envios', 'reportes', 'perfil',
    ],
    acciones: {
      ...ACCIONES_VACIAS,
      cambiarBahiaOperador: true,
      registrarServicio: true,
      verTodosServicios: true,
      verMaquinaria: true,
      registrarIncidente: true,
      verReportes: true,
    },
  },
  {
    namerol: 'COORD_MANTENIMIENTO',
    descripcion: 'Gestión de maquinaria, mantenimientos, incidentes y técnicos.',
    estado: 1,
    permisos: ['dashboard', 'notificaciones', 'maquinaria', 'taller-tecnico', 'inventario', 'perfil'],
    acciones: {
      ...ACCIONES_VACIAS,
      verMaquinaria: true,
      gestionarMantenimiento: true,
      registrarIncidente: true,
      gestionarInventario: true,
    },
  },
  {
    namerol: 'TECNICO',
    descripcion: 'Ejecución de mantenimientos e incidentes en taller.',
    estado: 1,
    permisos: ['dashboard', 'notificaciones', 'maquinaria', 'taller-tecnico', 'inventario', 'perfil'],
    acciones: {
      ...ACCIONES_VACIAS,
      verMaquinaria: true,
      gestionarMantenimiento: true,
      registrarIncidente: true,
    },
  },
  {
    namerol: 'LIDER',
    descripcion: 'Líder con acceso a plataforma para registrar OTs y coordinar bahías e inventario.',
    estado: 1,
    permisos: [
      'dashboard', 'notificaciones', 'servicios', 'configuracion/servicios', 'maquinaria',
      'inventario', 'envios', 'operadores', 'asignaciones', 'perfil',
    ],
    acciones: {
      ...ACCIONES_VACIAS,
      cambiarBahiaOperador: true,
      registrarServicio: true,
      verTodosServicios: true,
      verMaquinaria: true,
      registrarIncidente: true,
      gestionarInventario: true,
      accionesEnvios: true,
    },
  },
  {
    namerol: 'LIDER_AGENCIA',
    descripcion: 'Líder de agencia: OTs, bahías, maquinaria e inventario de su sede.',
    estado: 1,
    permisos: [
      'dashboard', 'notificaciones', 'servicios', 'configuracion/servicios', 'maquinaria',
      'inventario', 'envios', 'operadores', 'asignaciones', 'perfil',
    ],
    acciones: {
      ...ACCIONES_VACIAS,
      cambiarBahiaOperador: true,
      registrarServicio: true,
      verTodosServicios: true,
      verMaquinaria: true,
      registrarIncidente: true,
      gestionarInventario: true,
      accionesEnvios: true,
    },
  },
  {
    namerol: 'JEFE_COMERCIAL',
    descripcion: 'Visibilidad comercial nacional, productividad y reportes.',
    estado: 1,
    permisos: ['dashboard', 'notificaciones', 'productividad', 'servicios', 'configuracion/servicios', 'reportes', 'perfil'],
    acciones: {
      ...ACCIONES_VACIAS,
      verTodasSucursales: true,
      verOtrosSucursales: true,
      verTodosServicios: true,
      verReportes: true,
      verProductividadGlobal: true,
    },
  },
  {
    namerol: 'COORD_COMERCIAL',
    descripcion: 'Control comercial, metas, productividad y reportes.',
    estado: 1,
    permisos: ['dashboard', 'notificaciones', 'productividad', 'servicios', 'configuracion/servicios', 'reportes', 'perfil'],
    acciones: {
      ...ACCIONES_VACIAS,
      verTodasSucursales: true,
      verOtrosSucursales: true,
      verTodosServicios: true,
      verReportes: true,
      verProductividadGlobal: true,
    },
  },
  {
    namerol: 'COORD_SERVICIOS_ESPECIALES',
    descripcion: 'Creación, asignación y supervisión de servicios premium.',
    estado: 1,
    permisos: [
      'dashboard', 'notificaciones', 'servicios', 'configuracion/servicios', 'aprobaciones',
      'operadores', 'asignaciones', 'productividad', 'maquinaria', 'perfil',
    ],
    acciones: {
      ...ACCIONES_VACIAS,
      cambiarBahiaOperador: true,
      aprobarServicios: true,
      rechazarServicios: true,
      registrarServicio: true,
      verTodosServicios: true,
      verMaquinaria: true,
      registrarIncidente: true,
      verReportes: true,
      verProductividadGlobal: true,
    },
  },
  {
    namerol: 'PULIDOR',
    descripcion: 'Especialista en pulido y servicios especiales (fijo o móvil según agencia).',
    estado: 1,
    permisos: ['dashboard', 'notificaciones', 'servicios', 'inventario', 'perfil'],
    acciones: {
      ...ACCIONES_VACIAS,
      registrarServicio: true,
      registrarIncidente: true,
      gestionarInventario: true,
      accionesEnvios: true,
    },
  },
  {
    namerol: 'LAVADOR',
    descripcion: 'Personal de lavado en bahía para trazabilidad de productividad.',
    estado: 1,
    permisos: ['dashboard', 'inventario', 'envios', 'perfil'],
    acciones: { ...ACCIONES_VACIAS },
  },
  {
    namerol: 'COORD_BODEGA',
    descripcion: 'Inventario nacional, recepción de compras y despachos multi-región.',
    estado: 1,
    permisos: ['dashboard', 'inventario', 'envios', 'perfil'],
    acciones: {
      ...ACCIONES_VACIAS,
      verTodasSucursales: true,
      verOtrosSucursales: true,
      verReportes: true,
      gestionarInventario: true,
      despacharSuministros: true,
      accionesEnvios: true,
    },
  },
  {
    namerol: 'ASISTENTE_BODEGA',
    descripcion: 'Opera bodega regional: entradas y despachos a agencias de su región.',
    estado: 1,
    permisos: ['dashboard', 'inventario', 'envios', 'perfil'],
    acciones: {
      ...ACCIONES_VACIAS,
      gestionarInventario: true,
      despacharSuministros: true,
      accionesEnvios: true,
    },
  },
];

async function main() {
  console.log('🧹 Limpiando toda la base de datos EasyDry...');

  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename != '_prisma_migrations';
  `;

  for (const { tablename } of tables) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${tablename}" CASCADE;`);
  }

  console.log('✅ Base de datos vaciada con éxito.');

  // 1. Módulos del sistema
  console.log('📦 Sembrando catálogo de módulos del sistema...');
  for (const m of MODULOS_DATA) {
    await prisma.moduloSistema.create({
      data: {
        id: randomUUID(),
        codigo: m.codigo,
        nombre: m.nombre,
        descripcion: m.descripcion,
        icono: m.icono,
        rutaPrincipal: m.rutaPrincipal,
        grupo: m.grupo,
        orden: m.orden,
        estado: 1,
      },
    });
  }

  // 2. Roles oficiales
  console.log('🛡️ Creando roles oficiales con permisos y acciones desde BD...');
  const rolesMap = new Map<string, string>();
  for (const r of ROLES_DATA) {
    const role = await prisma.role.create({
      data: {
        namerol: r.namerol,
        descripcion: r.descripcion,
        estado: r.estado,
        permisos: r.permisos,
        acciones: r.acciones as unknown as Prisma.InputJsonValue,
      },
    });
    rolesMap.set(r.namerol, role.id);
  }

  // 3. Solo Super Admin y Admin
  console.log('👥 Creando usuarios Super Admin y Admin...');
  const superAdminPassHash = await bcrypt.hash('Super123*', 10);
  const adminPassHash = await bcrypt.hash('Admin123*', 10);

  const superAdmin = await prisma.user.create({
    data: {
      email: 'superadmin@easydry.com',
      passwordHash: superAdminPassHash,
      name: 'Super',
      lastname: 'Admin',
      roleId: rolesMap.get('SUPER_ADMIN')!,
      agenciaId: null,
      agenciasIds: [],
      regionId: null,
      estado: 1,
    },
  });

  const admin = await prisma.user.create({
    data: {
      email: 'admin@easydry.com',
      passwordHash: adminPassHash,
      name: 'Administrador',
      lastname: 'EasyDry',
      roleId: rolesMap.get('ADMIN')!,
      agenciaId: null,
      agenciasIds: [],
      regionId: null,
      estado: 1,
    },
  });

  // 4. Catálogos base de inventario
  console.log('📦 Sembrando catálogos dinámicos de inventario...');

  const tiposProductoData = [
    { codigo: 'LIQUIDO', nombre: 'Líquido', descripcion: 'Productos en estado líquido de dosificación volumétrica', estado: 1 },
    { codigo: 'POLVO', nombre: 'Polvo', descripcion: 'Insumos en polvo de disolución o aplicación directa', estado: 1 },
    { codigo: 'SOLIDO', nombre: 'Sólido', descripcion: 'Pastas, ceras duras o bloques sólidos', estado: 1 },
    { codigo: 'UNIDAD', nombre: 'Unidad', descripcion: 'Piezas, herramientas o accesorios unitarios', estado: 1 },
    { codigo: 'TEXTIL', nombre: 'Textil / Microfibra', descripcion: 'Paños, toallas y aplicadores textiles', estado: 1 },
  ];
  for (const tp of tiposProductoData) {
    await prisma.tipoProducto.create({ data: tp });
  }

  const unidadesData = [
    { codigo: 'ML', nombre: 'Mililitro', simbolo: 'ml', tipo: 'VOLUMEN', factorBase: 0.001, estado: 1 },
    { codigo: 'L', nombre: 'Litro', simbolo: 'L', tipo: 'VOLUMEN', factorBase: 1.0, estado: 1 },
    { codigo: 'GAL', nombre: 'Galón', simbolo: 'gal', tipo: 'VOLUMEN', factorBase: 3.78541, estado: 1 },
    { codigo: 'G', nombre: 'Gramo', simbolo: 'g', tipo: 'MASA', factorBase: 0.001, estado: 1 },
    { codigo: 'KG', nombre: 'Kilogramo', simbolo: 'kg', tipo: 'MASA', factorBase: 1.0, estado: 1 },
    { codigo: 'UND', nombre: 'Unidad', simbolo: 'und', tipo: 'UNITARIO', factorBase: 1.0, estado: 1 },
  ];
  for (const u of unidadesData) {
    await prisma.unidadMedida.create({ data: u });
  }

  const tiposMovData = [
    { codigo: 'ENTRY', nombre: 'Entrada / Compra', descripcion: 'Ingreso físico de producto al inventario', esEntrada: true, estado: 1 },
    { codigo: 'CONSUMPTION', nombre: 'Consumo Operativo', descripcion: 'Consumo o gasto de producto en operaciones', esEntrada: false, estado: 1 },
    { codigo: 'POSITIVE_ADJUSTMENT', nombre: 'Ajuste Positivo', descripcion: 'Incremento de stock por corrección física', esEntrada: true, estado: 1 },
    { codigo: 'NEGATIVE_ADJUSTMENT', nombre: 'Ajuste Negativo', descripcion: 'Disminución de stock por corrección o faltante', esEntrada: false, estado: 1 },
    { codigo: 'WASTE', nombre: 'Merma / Daño', descripcion: 'Baja de producto por daño, derrame o caducidad', esEntrada: false, estado: 1 },
    { codigo: 'RETURN', nombre: 'Devolución', descripcion: 'Devolución de producto al proveedor o almacén', esEntrada: true, estado: 1 },
    { codigo: 'TRANSFER', nombre: 'Transferencia', descripcion: 'Movimiento entre bodegas o ubicaciones', esEntrada: false, estado: 1 },
  ];
  for (const tm of tiposMovData) {
    await prisma.tipoMovimientoInventario.create({ data: tm });
  }

  console.log('=====================================================');
  console.log('🚀 Seed ejecutado con éxito');
  console.log(`📦 Módulos sembrados: ${MODULOS_DATA.length}`);
  console.log(`🛡️ Roles creados: ${rolesMap.size}`);
  console.log(`👤 Super Admin: ${superAdmin.email} | Contraseña: Super123*`);
  console.log(`👤 Admin:       ${admin.email}      | Contraseña: Admin123*`);
  console.log('📦 Catálogos base de inventario sembrados (0 productos iniciales)');
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
