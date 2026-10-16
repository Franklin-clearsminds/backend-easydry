type Fila = Record<string, any>;

/**
 * Mezcla filas de la base y del archivo con el orden que pidió el cliente y devuelve la página [skip, skip + take).
 * `valor` da el valor por el que se ordena cada fila; los nulos van al final en ascendente y al principio en descendente (como
 * Postgres), el texto se compara en español como lo hace la colación de la base (las minúsculas antes que las mayúsculas cuando por lo demás son iguales), y el empate se resuelve por `id` en la misma
 * dirección, igual que el desempate que `resolverOrden` añade a la consulta de la base.
 */
export function mezclarPagina(filas: Fila[], valor: (f: Fila) => number | string | null, dir: 'asc' | 'desc', skip: number, take: number, nulosAlFinal = false): Fila[] {
  const signo = dir === 'asc' ? 1 : -1;
  const comparar = (a: Fila, b: Fila): number => {
    const va = valor(a);
    const vb = valor(b);
    if (va === null || vb === null) {
      if (va === vb) return String(a.id).localeCompare(String(b.id)) * signo;
      // Por defecto, como Postgres (al final en ascendente, al principio en descendente); con `nulosAlFinal`, al final siempre.
      return nulosAlFinal ? (va === null ? 1 : -1) : (va === null ? 1 : -1) * signo;
    }
    const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'es');
    return c * signo || String(a.id).localeCompare(String(b.id)) * signo;
  };
  return [...filas].sort(comparar).slice(skip, skip + take);
}

/** Parte un arreglo en trozos (los `IN (...)` muy largos se parten). */
export const trozos = <T>(xs: T[], n = 1000): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));
