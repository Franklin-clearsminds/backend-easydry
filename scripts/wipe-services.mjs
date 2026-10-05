import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const evidencias = await prisma.evidenciaServicio.deleteMany({});
  const consumos = await prisma.consumoServicio.deleteMany({});
  const generales = await prisma.servicioLavado.deleteMany({});
  const especiales = await prisma.servicioEspecial.deleteMany({});
  console.log(
    JSON.stringify({
      evidencias: evidencias.count,
      consumos: consumos.count,
      generales: generales.count,
      especiales: especiales.count,
    }),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
