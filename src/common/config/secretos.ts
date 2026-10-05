/**
 * Lee un secreto de la configuración. En producción es obligatorio: si falta, el servidor no arranca (así nunca se
 * despliega con la clave por defecto que está en el código). Fuera de producción usa el valor de desarrollo.
 */
export function secretoObligatorio(valor: string | undefined, nombre: string, valorDesarrollo: string): string {
  if (valor && valor.trim()) return valor;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`Falta la variable de entorno ${nombre}. Es obligatoria en producción.`);
  }
  return valorDesarrollo;
}
