/**
 * Auditoría de las casillas del editor de roles (ver src/common/permisos/auditoria-permisos.ts).
 *
 *   pnpm audit:permisos                  resumen por página y lista de lo pendiente
 *   pnpm audit:permisos --escribir-base  reescribe la línea base con lo que hoy falla (solo para arrancar; después se recorta a mano)
 */
import { writeFileSync } from 'node:fs';
import { auditar } from '../src/common/permisos/auditoria-permisos.js';

const { resultados, hayPantallas } = auditar();
const sinServidor = resultados.filter((r) => r.servidor === 0);
const sinPantalla = hayPantallas ? resultados.filter((r) => r.pantalla === 0) : [];

if (process.argv.includes('--escribir-base')) {
  const lista = (xs: { codigo: string }[]) => xs.map((x) => `  '${x.codigo}',`).join('\n');
  writeFileSync(
    new URL('../src/common/permisos/auditoria-acciones.baseline.ts', import.meta.url),
    `/**
 * Línea base de la auditoría de casillas: lo que hoy NO está cableado. Solo puede encogerse: cada vez que una casilla
 * queda exigida por el servidor y usada por una pantalla, se borra de aquí (la prueba falla si se queda una que ya cumple).
 * Objetivo: que las dos listas queden vacías.
 */
export const SIN_SERVIDOR: string[] = [
${lista(sinServidor)}
];

export const SIN_PANTALLA: string[] = [
${lista(sinPantalla)}
];
`,
  );
  console.log(`Línea base escrita: ${sinServidor.length} sin servidor, ${sinPantalla.length} sin pantalla.`);
} else {
  const paginas = [...new Set(resultados.map((r) => r.pagina))];
  console.log('página'.padEnd(15), 'casillas'.padStart(9), 'sin servidor'.padStart(13), 'sin pantalla'.padStart(13));
  for (const p of paginas) {
    const de = resultados.filter((r) => r.pagina === p);
    console.log(p.padEnd(15), String(de.length).padStart(9), String(de.filter((r) => r.servidor === 0).length).padStart(13), String(de.filter((r) => hayPantallas && r.pantalla === 0).length).padStart(13));
  }
  console.log('—'.repeat(52));
  console.log('TOTAL'.padEnd(15), String(resultados.length).padStart(9), String(sinServidor.length).padStart(13), String(sinPantalla.length).padStart(13));
  if (!hayPantallas) console.log('(no se encontraron frontend-easy-dry / app-easy-dry: se omitió la parte de pantallas)');
}
