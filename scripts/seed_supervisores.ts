import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Sembrando supervisores demo de USUARIOS-DEMO.md...');

  const supervisorRole = await prisma.role.findFirst({
    where: { namerol: 'SUPERVISOR' }
  });

  if (!supervisorRole) {
    console.error('❌ Rol SUPERVISOR no encontrado');
    return;
  }

  const passHash = await bcrypt.hash('Admin123*', 10);

  const supervisores = [
    {
      email: 'supervisor.costa@easydry.com',
      name: 'Carlos',
      lastname: 'Mendoza (Supervisor Costa)',
      roleId: supervisorRole.id,
      passwordHash: passHash,
      estado: 1
    },
    {
      email: 'supervisor.sierra@easydry.com',
      name: 'Andrés',
      lastname: 'Morales (Supervisor Sierra)',
      roleId: supervisorRole.id,
      passwordHash: passHash,
      estado: 1
    },
    {
      email: 'supervisor.austro@easydry.com',
      name: 'David',
      lastname: 'Ochoa (Supervisor Austro)',
      roleId: supervisorRole.id,
      passwordHash: passHash,
      estado: 1
    }
  ];

  for (const sup of supervisores) {
    const existing = await prisma.user.findUnique({
      where: { email: sup.email }
    });

    if (!existing) {
      const created = await prisma.user.create({
        data: sup
      });
      console.log(`✅ Supervisor creado: ${created.name} ${created.lastname} (${created.email})`);
    } else {
      console.log(`ℹ️ Supervisor ya existe: ${existing.email}`);
    }
  }

  console.log('🎉 Supervisores listos.');
}

main()
  .catch((e) => {
    console.error('Error al sembrar supervisores:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
