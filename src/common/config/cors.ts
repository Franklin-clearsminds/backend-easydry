/**
 * Orígenes permitidos para navegadores, leídos de `CORS_ORIGIN` (separados por coma). Las apps móviles y las
 * herramientas de línea de comandos no mandan `Origin`, así que no pasan por esta lista.
 * Si `CORS_ORIGIN` no está definida: en desarrollo se acepta cualquier origen; en el resto de entornos, ninguno.
 */
export function origenesPermitidos(): string[] {
  return (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

export function origenPermitido(origin: string | undefined): boolean {
  if (!origin) return true;
  const lista = origenesPermitidos();
  if (!lista.length) return process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
  return lista.includes(origin.replace(/\/$/, ''));
}
