/**
 * Quita de la base toda la maquinaria que NO fue cargada con prisma/import-maquinarias-xlsx.ts: las de demostración
 * (PULID-, ASPIR-, HIDRO-, COMP-, ESPUM-…), las de prueba y cualquiera creada a mano. Se reconoce por su primer evento
 * MAQUINA_CREADA: lo cargado por el script trae datos.origen = «Importación Excel».
 *
 * Borra, de cada máquina, su línea de tiempo (que es append-only y por eso restringe el borrado) y la máquina misma con sus
 * incidentes, mantenimientos, evidencias, limpiezas y movimientos (cascada). Antes de borrar guarda todo en un JSON de respaldo
 * dentro de _respaldos/. No se puede deshacer más que reimportando ese respaldo a mano.
 *
 * Solo corre contra una base en localhost; para una remota (Supabase) exige LIMPIAR_REMOTO=SI.
 *
 * Uso: npm run prisma:limpiar-maquinaria -- [--dry-run]
 */
import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRY = process.argv.includes('--dry-run');

if (process.env.LIMPIAR_REMOTO !== 'SI' && !/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Este script solo corre contra la base local (DATABASE_URL debe apuntar a localhost). Para una base remota usa LIMPIAR_REMOTO=SI.');
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const todas = await prisma.maquinaria.findMany({
      select: { id: true, codigo: true, eventos: { where: { tipo: 'MAQUINA_CREADA' }, orderBy: { ocurridoEn: 'asc' }, take: 1, select: { datos: true } } },
    });
    const aQuitar = todas.filter((m) => (m.eventos[0]?.datos as { origen?: string } | null)?.origen !== 'Importación Excel');
    const ids = aQuitar.map((m) => m.id);
    console.log(`Máquinas: ${todas.length}. Cargadas con el script (se quedan): ${todas.length - ids.length}. A quitar: ${ids.length}`);
    if (!ids.length) return;

    const donde = { maquinariaId: { in: ids } };
    const conteo = {
      eventos: await prisma.maquinariaEvento.count({ where: donde }),
      incidentes: await prisma.incidenteTecnico.count({ where: donde }),
      mantenimientos: await prisma.mantenimientoMaquinaria.count({ where: donde }),
      limpiezas: await prisma.limpiezaMaquinaria.count({ where: donde }),
      movimientos: await prisma.movimientoMaquinaria.count({ where: donde }),
    };
    console.log('Se borran junto con ellas:', conteo);
    console.log(`Códigos: ${aQuitar.map((m) => m.codigo).sort().join(', ')}`);
    if (DRY) return console.log('\n(--dry-run: no se borra nada)');

    const respaldo = path.join(__dirname, '..', '..', '_respaldos', `maquinaria-no-importada-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    const datos = await prisma.maquinaria.findMany({
      where: { id: { in: ids } },
      include: { eventos: true, incidentes: true, mantenimientos: true, limpiezas: true, movimientos: true },
    });
    fs.writeFileSync(respaldo, JSON.stringify(datos, null, 1), 'utf8');
    console.log(`Respaldo: ${respaldo}`);

    // La línea de tiempo restringe el borrado de la máquina, así que va primero; el resto cae en cascada.
    const [eventos, maquinas] = await prisma.$transaction([
      prisma.maquinariaEvento.deleteMany({ where: donde }),
      prisma.maquinaria.deleteMany({ where: { id: { in: ids } } }),
    ]);
    console.log(`\nBorrados: ${eventos.count} eventos y ${maquinas.count} máquinas (con sus incidentes, mantenimientos, limpiezas y movimientos).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
