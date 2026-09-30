/**
 * Cifra o descifra un texto con la clave ENCRYPTION_KEY del .env, sin exponer ningún endpoint en el servidor.
 *
 *   node scripts/cifrado-local.cjs cifrar '{"email":"a@b.com"}'
 *   node scripts/cifrado-local.cjs descifrar 'iv_hex:texto_hex'
 *
 * Usa el mismo formato que CryptoService (AES-256-CBC, "iv_hex:ciphertext_hex").
 */
const { createCipheriv, createDecipheriv, createHash, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function leerEnv() {
  const ruta = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(ruta)) return {};
  const env = {};
  for (const linea of fs.readFileSync(ruta, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const [accion, texto] = process.argv.slice(2);
const clave = process.env.ENCRYPTION_KEY || leerEnv().ENCRYPTION_KEY;
if (!['cifrar', 'descifrar'].includes(accion) || !texto) {
  console.error('Uso: node scripts/cifrado-local.cjs <cifrar|descifrar> <texto>');
  process.exit(1);
}
if (!clave) {
  console.error('No se encontró ENCRYPTION_KEY (defínela en .env o en el entorno).');
  process.exit(1);
}
const key = createHash('sha256').update(clave).digest();

if (accion === 'cifrar') {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  const cifrado = cipher.update(texto, 'utf8', 'hex') + cipher.final('hex');
  console.log(`${iv.toString('hex')}:${cifrado}`);
} else {
  const [ivHex, datosHex] = texto.split(':');
  const decipher = createDecipheriv('aes-256-cbc', key, Buffer.from(ivHex, 'hex'));
  console.log(decipher.update(datosHex, 'hex', 'utf8') + decipher.final('utf8'));
}
