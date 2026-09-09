import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // 1. Role LIDER_OPERADOR
  const liderOperador = await prisma.role.upsert({
    where: { namerol: 'LIDER_OPERADOR' },
    update: {
      descripcion: 'Líder Operador con acceso a la plataforma para registrar servicios y OTs de su sucursal',
      estado: 1,
      permisos: ['servicios', 'bahias', 'maquinaria', 'taller-tecnico', 'inventario', 'sync']
    },
    create: {
      namerol: 'LIDER_OPERADOR',
      descripcion: 'Líder Operador con acceso a la plataforma para registrar servicios y OTs de su sucursal',
      estado: 1,
      permisos: ['servicios', 'bahias', 'maquinaria', 'taller-tecnico', 'inventario', 'sync']
    }
  });
  console.log('✅ Rol LIDER_OPERADOR:', liderOperador.namerol);

  // 2. Role OPERADOR
  const operador = await prisma.role.upsert({
    where: { namerol: 'OPERADOR' },
    update: {
      descripcion: 'Personal técnico de bahía registrado para trazabilidad operativa de servicios y bahías',
      estado: 1,
      permisos: ['servicios', 'bahias', 'sync']
    },
    create: {
      namerol: 'OPERADOR',
      descripcion: 'Personal técnico de bahía registrado para trazabilidad operativa de servicios y bahías',
      estado: 1,
      permisos: ['servicios', 'bahias', 'sync']
    }
  });
  console.log('✅ Rol OPERADOR:', operador.namerol);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
