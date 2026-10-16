/**
 * JSON que conserva fechas y enteros grandes: lo que se guarda en la caché vuelve igual que salió (con `Date`, no con texto),
 * así quien lee de la caché recibe la misma forma que si hubiera consultado la base o el archivo.
 */
const MARCA = '$t';

export function serializar(valor: unknown): string {
  return JSON.stringify(valor, function (this: Record<string, unknown>, clave: string, v: unknown) {
    // `Date.prototype.toJSON` ya convirtió la fecha en texto: se lee el valor original del objeto padre.
    const original = this[clave];
    if (original instanceof Date) return { [MARCA]: 'd', v: Number.isNaN(original.getTime()) ? null : original.toISOString() };
    if (typeof original === 'bigint') return { [MARCA]: 'b', v: original.toString() };
    return v;
  });
}

export function deserializar<T>(texto: string): T {
  return JSON.parse(texto, (_clave, v) => {
    if (v && typeof v === 'object' && MARCA in v) {
      if (v[MARCA] === 'd') return v.v === null ? new Date(NaN) : new Date(v.v);
      if (v[MARCA] === 'b') return BigInt(v.v);
    }
    return v;
  }) as T;
}
