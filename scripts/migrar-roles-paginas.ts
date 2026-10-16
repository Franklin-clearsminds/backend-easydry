/**
 * Agrega a cada rol sus páginas, sub-páginas y acciones del catálogo nuevo, derivadas de los permisos que ya tiene (no quita nada).
 * Es idempotente. El servidor lo hace solo al arrancar (RolesService.onModuleInit); este script sirve para correrlo a mano.
 *
 * Uso:  pnpm roles:migrar-paginas            (solo los roles que aún no tienen páginas)
 *       pnpm roles:migrar-paginas --completar-datos   (agrega a los roles que ya tienen páginas las casillas de cédula y correo según lo que veían)
 *       pnpm roles:migrar-paginas --rehacer   (recalcula las páginas de todos desde sus permisos clásicos; descarta lo configurado en el editor)
 */
import { PrismaClient } from '@prisma/client';
import { CODIGOS_PERMISOS } from '../src/common/permisos/catalogo-permisos.js';
import { capacidadesConPaginas, completarAccionesDeDatos, tienePaginas } from '../src/common/permisos/migracion-paginas.js';
import { modulosDeCapacidades } from '../src/common/permisos/modulos-navegacion.js';

const prisma = new PrismaClient();

async function main() {
  const roles = await prisma.role.findMany({ where: { namerol: { not: 'SUPER_ADMIN' } }, orderBy: { namerol: 'asc' } });
  for (const rol of roles) {
    const rehacer = process.argv.includes('--rehacer');
    if (process.argv.includes('--completar-datos')) {
      const antes = Array.isArray(rol.capacidades) ? rol.capacidades : [];
      const despues = completarAccionesDeDatos(antes, rol.namerol);
      if (despues.length !== antes.length) {
        await prisma.role.update({ where: { id: rol.id }, data: { capacidades: despues } });
        console.log(`✅ ${rol.namerol}: +${despues.length - antes.length} (${despues.filter((c) => !antes.includes(c)).join(', ')})`);
      } else console.log(`· ${rol.namerol}: sin cambios`);
      continue;
    }
    const guardadas = Array.isArray(rol.capacidades) ? rol.capacidades : [];
    // Con --rehacer solo cuentan los permisos clásicos: las páginas se vuelven a derivar de ellos.
    const actuales = rehacer ? guardadas.filter((c) => (CODIGOS_PERMISOS as readonly string[]).includes(c)) : guardadas;
    if (actuales.length === 0 || (!rehacer && tienePaginas(actuales))) {
      console.log(`· ${rol.namerol}: sin cambios`);
      continue;
    }
    const capacidades = capacidadesConPaginas(actuales, rol.namerol);
    await prisma.role.update({ where: { id: rol.id }, data: { capacidades, permisos: modulosDeCapacidades(capacidades, rol.namerol) } });
    console.log(`✅ ${rol.namerol}: ${actuales.length} → ${capacidades.length} permisos (páginas: ${capacidades.filter((c) => c.startsWith('pagina.')).length})`);
  }
}

main()
  .catch((e) => {
    console.error('❌', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
