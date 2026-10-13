const ENTORNOS_SIN_EXIGENCIA = ['development', 'test'];
const LARGO_MINIMO = 32;

/**
 * Lee un secreto de la configuración. Solo en `NODE_ENV=development` o `test` se admite el valor de desarrollo cuando falta;
 * en cualquier otro caso (producción, o `NODE_ENV` sin definir) es obligatorio y el servidor no arranca sin él.
 * En producción además se rechazan el valor de desarrollo (está en el código) y los secretos de menos de 32 caracteres.
 */
export function secretoObligatorio(valor: string | undefined, nombre: string, valorDesarrollo: string): string {
  const entorno = process.env.NODE_ENV;
  const esDesarrollo = !!entorno && ENTORNOS_SIN_EXIGENCIA.includes(entorno);

  if (!valor || !valor.trim()) {
    if (esDesarrollo) return valorDesarrollo;
    throw new Error(`Falta la variable de entorno ${nombre}. Es obligatoria fuera de desarrollo.`);
  }
  if (entorno === 'production') {
    if (valor === valorDesarrollo) {
      throw new Error(`${nombre} tiene el valor de desarrollo, que es público. Genera uno propio (openssl rand -base64 48).`);
    }
    if (valor.length < LARGO_MINIMO) {
      throw new Error(`${nombre} es demasiado corto: usa al menos ${LARGO_MINIMO} caracteres.`);
    }
  }
  return valor;
}

/** En producción los secretos de firma y de cifrado no pueden repetirse entre sí: filtrar uno no debe comprometer los otros. */
export function verificarSecretosDistintos(secretos: Record<string, string | undefined>): void {
  if (process.env.NODE_ENV !== 'production') return;
  const vistos = new Map<string, string>();
  for (const [nombre, valor] of Object.entries(secretos)) {
    if (!valor) continue;
    const otro = vistos.get(valor);
    if (otro) throw new Error(`${nombre} y ${otro} tienen el mismo valor. Cada secreto debe ser distinto.`);
    vistos.set(valor, nombre);
  }
}
