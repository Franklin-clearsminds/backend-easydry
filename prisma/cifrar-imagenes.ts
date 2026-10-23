/**
 * Cifra en la base los logos de los sellos y las firmas de los informes que se guardaron antes de que se cifraran.
 * Es seguro repetirlo: lo que ya está cifrado (empieza con «enc1:») no se toca. Antes de escribir cada valor comprueba que al
 * descifrarlo vuelve idéntico al original.
 *
 * Usa la `ENCRYPTION_KEY` del .env: la misma que debe tener el servidor para poder leer lo cifrado.
 *
 * Uso: npm run prisma:cifrar-imagenes [-- --dry-run]
 */
import { PrismaClient } from '@prisma/client';
import { CryptoService } from '../src/common/crypto/crypto.service.js';

try {
  process.loadEnvFile();
} catch {
  // sin .env: se usan las variables que ya haya en el entorno
}

const DRY = process.argv.includes('--dry-run');
const prisma = new PrismaClient();
const crypto = new CryptoService({ get: (k: string) => process.env[k] } as never);

/** Devuelve el valor cifrado si hay que cifrarlo; `null` si no hay nada que hacer. */
function aCifrar(valor: string | null): string | null {
  if (!valor || crypto.estaProtegido(valor)) return null;
  const cifrado = crypto.protegerEnReposo(valor)!;
  if (crypto.revelarEnReposo(cifrado) !== valor) throw new Error('El valor cifrado no vuelve idéntico al original: no se escribe nada.');
  return cifrado;
}

async function main() {
  let sellos = 0, logosInforme = 0, firmas = 0;

  for (const s of await prisma.selloJefeTaller.findMany({ select: { id: true, logo: true } })) {
    const c = aCifrar(s.logo);
    if (!c) continue;
    if (!DRY) await prisma.selloJefeTaller.update({ where: { id: s.id }, data: { logo: c } });
    sellos++;
  }
  for (const i of await prisma.informeInspeccion.findMany({ where: { selloLogo: { not: null } }, select: { id: true, selloLogo: true } })) {
    const c = aCifrar(i.selloLogo);
    if (!c) continue;
    if (!DRY) await prisma.informeInspeccion.update({ where: { id: i.id }, data: { selloLogo: c } });
    logosInforme++;
  }
  for (const f of await prisma.informeFirma.findMany({ where: { imagen: { not: null } }, select: { id: true, imagen: true } })) {
    const c = aCifrar(f.imagen);
    if (!c) continue;
    if (!DRY) await prisma.informeFirma.update({ where: { id: f.id }, data: { imagen: c } });
    firmas++;
  }

  console.log(`${DRY ? '🔎 --dry-run (no se escribió nada). Por cifrar' : '🔒 Cifrados'}: ${sellos} logos de sellos · ${logosInforme} logos copiados en informes · ${firmas} firmas.`);
}

main()
  .catch((e) => {
    console.error('❌', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
