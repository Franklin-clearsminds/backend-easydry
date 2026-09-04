import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const OFFICIAL_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'SUPERVISOR',
  'JEFE_COMERCIAL',
  'COORD_COMERCIAL',
  'APROBADOR',
  'LIDER_AGENCIA',
  'COORD_SERVICIOS_ESPECIALES',
  'PULIDOR_FIJO',
  'PULIDOR_MOVIL',
  'COORD_MANTENIMIENTO',
  'TECNICO',
  'COORD_BODEGA',
  'ASISTENTE_BODEGA',
];

async function main() {
  console.log('🧹 Eliminando roles obsoletos no oficiales de la base de datos...');

  // 1. Buscar roles que no estén en la lista oficial
  const rolesAEliminar = await prisma.role.findMany({
    where: {
      namerol: {
        notIn: OFFICIAL_ROLES,
      },
    },
    include: {
      _count: { select: { users: true } },
    },
  });

  console.log(`Encontrados ${rolesAEliminar.length} roles para eliminar:`);
  for (const r of rolesAEliminar) {
    console.log(`- ${r.namerol} (Usuarios asociados: ${r._count.users})`);
    if (r._count.users > 0) {
      console.warn(`⚠️ ALERTA: Rol ${r.namerol} tiene usuarios asignados. Reasignando a LIDER_AGENCIA antes de eliminar...`);
      const defaultRole = await prisma.role.findUnique({ where: { namerol: 'LIDER_AGENCIA' } });
      if (defaultRole) {
        await prisma.user.updateMany({
          where: { roleId: r.id },
          data: { roleId: defaultRole.id },
        });
      }
    }
    await prisma.role.delete({ where: { id: r.id } });
    console.log(`  ✅ Rol ${r.namerol} eliminado exitosamente.`);
  }

  // 2. Verificar los roles resultantes
  const rolesFinales = await prisma.role.findMany({
    orderBy: { namerol: 'asc' },
    include: { _count: { select: { users: true } } },
  });

  console.log(`\n======================================================`);
  console.log(`TOTAL ROLES ACTIVOS EN BD: ${rolesFinales.length} (Debe ser exactamente ${OFFICIAL_ROLES.length})`);
  console.log(`======================================================`);
  rolesFinales.forEach((r, idx) => {
    console.log(`${idx + 1}. [${r.namerol}] - Users: ${r._count.users} - Permisos: [${r.permisos.join(', ')}]`);
  });
}

main()
  .catch((e) => {
    console.error('❌ Error limpiando roles:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
