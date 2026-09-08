import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🧹 Limpiando toda la base de datos EasyDry...');

  // Limpieza dinámica de todas las tablas existentes en el esquema public
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename != '_prisma_migrations';
  `;

  for (const { tablename } of tables) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${tablename}" CASCADE;`);
  }

  console.log('✅ Base de datos vaciada con éxito.');

  // 1. Crear Roles Oficiales del Sistema
  console.log('🛡️ Creando los 14 roles oficiales...');
  const rolesData = [
    { namerol: 'SUPER_ADMIN', estado: 1, permisos: ['dashboard', 'usuarios', 'sucursales', 'agencias', 'regiones', 'operadores', 'servicios', 'maquinaria', 'inventario', 'reportes', 'configuracion'] },
    { namerol: 'ADMIN', estado: 1, permisos: ['dashboard', 'usuarios', 'sucursales', 'agencias', 'regiones', 'operadores', 'servicios', 'maquinaria', 'inventario', 'reportes'] },
    { namerol: 'APROBADOR', estado: 1, permisos: ['dashboard', 'notificaciones', 'servicios', 'aprobaciones', 'reportes', 'sync'] },
    { namerol: 'SUPERVISOR', estado: 1, permisos: ['dashboard', 'notificaciones', 'mapa-operativo', 'sucursales', 'agencias', 'regiones', 'operadores', 'asignaciones', 'servicios', 'productividad', 'maquinaria', 'inventario', 'reportes', 'sync'] },
    { namerol: 'COORD_MANTENIMIENTO', estado: 1, permisos: ['dashboard', 'maquinaria', 'taller-tecnico', 'inventario', 'sync'] },
    { namerol: 'TECNICO', estado: 1, permisos: ['dashboard', 'maquinaria', 'taller-tecnico', 'inventario', 'sync'] },
    { namerol: 'LIDER_AGENCIA', estado: 1, permisos: ['servicios', 'bahias', 'maquinaria', 'taller-tecnico', 'inventario', 'sync'] },
    { namerol: 'JEFE_COMERCIAL', estado: 1, permisos: ['dashboard', 'sucursales', 'agencias', 'regiones', 'reportes', 'retos', 'notificaciones'] },
    { namerol: 'COORD_COMERCIAL', estado: 1, permisos: ['dashboard', 'sucursales', 'agencias', 'regiones', 'reportes', 'retos', 'notificaciones'] },
    { namerol: 'COORD_SERVICIOS_ESPECIALES', estado: 1, permisos: ['servicios', 'pulidores', 'agenda', 'sync'] },
    { namerol: 'PULIDOR_FIJO', estado: 1, permisos: ['servicios', 'bahias', 'inventario', 'sync'] },
    { namerol: 'PULIDOR_MOVIL', estado: 1, permisos: ['servicios', 'bahias', 'inventario', 'sync'] },
    { namerol: 'COORD_BODEGA', estado: 1, permisos: ['dashboard', 'inventario', 'bodega', 'notificaciones', 'reportes', 'sync'] },
    { namerol: 'ASISTENTE_BODEGA', estado: 1, permisos: ['inventario', 'bodega', 'notificaciones', 'sync'] },
  ];

  const rolesMap = new Map<string, string>();
  for (const r of rolesData) {
    const role = await prisma.role.create({
      data: { namerol: r.namerol, estado: r.estado, permisos: r.permisos },
    });
    rolesMap.set(r.namerol, role.id);
  }

  // 2. Crear Usuarios Exclusivos: Super Admin y Admin
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

  // 3. Catálogos Dinámicos de Inventario (Base para el sistema, 100% editables desde BD)
  console.log('📦 Sembrando catálogos dinámicos de inventario...');

  // 3.1 Tipos de Producto
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

  // 3.2 Unidades de Medida
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


  // 3.4 Tipos de Movimiento de Inventario
  const tiposMovData = [
    { codigo: 'ENTRY', nombre: 'Entrada / Compra', descripcion: 'Ingreso físico de producto al inventario', esEntrada: true, estado: 1 },
    { codigo: 'CONSUMPTION', nombre: 'Consumo Operativo', descripcion: 'Consumo o gasto de producto en operaciones', esEntrada: false, estado: 1 },
    { codigo: 'POSITIVE_ADJUSTMENT', nombre: 'Ajuste Positivo', descripcion: 'Incremento de stock por corrección física', esEntrada: true, estado: 1 },
    { codigo: 'NEGATIVE_ADJUSTMENT', nombre: 'Ajuste Negativo', descripcion: 'Disminución de stock por corrección o faltante', esEntrada: false, estado: 1 },
    { codigo: 'WASTE', nombre: 'Merma / Daño', descripcion: 'Baja de producto por daño, derrame o caducidad', esEntrada: false, estado: 1 },
    { codigo: 'RETURN', nombre: 'Devolución', descripcion: 'Devolución de producto al proveedor o almacén', esEntrada: true, estado: 1 },
    { codigo: 'TRANSFER', nombre: 'Transferencia', descripcion: 'Movimiento entre bodegas o ubicaciones', esEntrada: false, estado: 1 },
  ];
  const tiposMovMap = new Map<string, string>();
  for (const tm of tiposMovData) {
    const created = await prisma.tipoMovimientoInventario.create({ data: tm });
    tiposMovMap.set(tm.codigo, created.id);
  }

  console.log('=====================================================');
  console.log('🚀 Seed ejecutado con éxito');
  console.log(`👤 Super Admin: ${superAdmin.email} | Contraseña: Super123*`);
  console.log(`👤 Admin:       ${admin.email}      | Contraseña: Admin123*`);
  console.log(`🛡️ Roles creados: ${rolesMap.size}`);
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
