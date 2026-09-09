import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Migrating Role table to roles and adding descripcion...');
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS "Role" RENAME TO "roles";`);
    console.log('Renamed "Role" to "roles"');
  } catch (e) {
    console.log('Rename note:', e);
  }

  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS "roles" ADD COLUMN IF NOT EXISTS "descripcion" TEXT;`);
    console.log('Added descripcion column to "roles"');
  } catch (e) {
    console.log('Add column note:', e);
  }

  // Actualizar descripciones oficiales si están vacías
  const descripciones: Record<string, string> = {
    'SUPER_ADMIN': 'Acceso total e inmutable a todos los módulos y configuraciones avanzadas del sistema.',
    'ADMIN': 'Administrador operativo general. Gestión de usuarios, sucursales y catálogos.',
    'APROBADOR': 'Gerente de Sucursal. Responsable de la aprobación y control de servicios en agencia.',
    'SUPERVISOR': 'Supervisor Regional. Control operativo y auditoría de agencias asignadas.',
    'COORD_MANTENIMIENTO': 'Coordinación y gestión técnica de maquinaria, talleres y reparaciones.',
    'TECNICO': 'Técnico de maquinaria. Ejecución de mantenimientos preventivos y correctivos.',
    'LIDER_AGENCIA': 'Líder encargado de la operación diaria, bahías e inventario en sucursal.',
    'JEFE_COMERCIAL': 'Gestión estratégica comercial, metas y rendimiento de sucursales.',
    'COORD_COMERCIAL': 'Supervisión y coordinación comercial regional de servicios y retos.',
    'COORD_SERVICIOS_ESPECIALES': 'Gestión y coordinación de pulidores y servicios especiales de detallado.',
    'PULIDOR_FIJO': 'Operador especialista en pulido y servicios especiales en sucursal fija.',
    'PULIDOR_MOVIL': 'Operador especialista móvil para servicios especiales en diversas sedes.',
    'COORD_BODEGA': 'Administración central de inventario, stock, compras y despachos a agencias.',
    'ASISTENTE_BODEGA': 'Recepción, despacho y control físico de insumos y productos en bodega.'
  };

  for (const [code, desc] of Object.entries(descripciones)) {
    await prisma.$executeRawUnsafe(`UPDATE "roles" SET "descripcion" = $1 WHERE "namerol" = $2 AND ("descripcion" IS NULL OR "descripcion" = '');`, desc, code);
  }

  console.log('✅ Migración de tabla roles completada con éxito.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
