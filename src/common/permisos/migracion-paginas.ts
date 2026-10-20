import { PERMISOS_POR_MODULO } from './modulos-navegacion.js';
import { PaginaDef, codigosNuevosActivos, nuevosDesdeClasicos } from './catalogo-paginas.js';

/** ¿El rol ya guarda sus páginas (`pagina.*`)? */
export const tienePaginas = (capacidades: readonly string[] | null | undefined): boolean =>
  !!capacidades?.some((c) => c.startsWith('pagina.'));

/**
 * Agrega a un rol con permisos clásicos sus páginas, sub-páginas y acciones equivalentes. Los permisos clásicos quedan
 * exactamente como estaban (no se agrega ni se quita ninguno): migrar nunca cambia lo que el servidor le permite al rol.
 * Un rol que ya guarda páginas (o no tiene permisos) se devuelve igual.
 */
export function capacidadesConPaginas(clasicos: readonly string[], namerol?: string): string[] {
  if (clasicos.length === 0 || tienePaginas(clasicos)) return [...clasicos];
  const tiene = new Set(clasicos);

  const visible = (p: PaginaDef): boolean => {
    if (p.modulo === null) return [...p.acciones].some((a) => a.otorga.some((c) => tiene.has(c)));
    const requeridos = PERMISOS_POR_MODULO[p.modulo];
    if (requeridos === null) return true; // pantallas de cuenta (notificaciones, perfil)
    return !!requeridos && requeridos.some((c) => tiene.has(c));
  };

  const nuevos = nuevosDesdeClasicos(clasicos, visible);
  const resultado = [...new Set([...clasicos, ...nuevos])];
  return namerol ? completarAccionesDeDatos(resultado, namerol) : resultado;
}

/**
 * Quién recibe, al migrar, las casillas de datos personales. Reproduce lo que cada rol veía antes de que fueran permisos:
 * la cédula la veían todos menos los roles comerciales; el correo y el teléfono, solo el administrador.
 */
const REGLAS_DATOS_PERSONALES: Record<string, (namerol: string) => boolean> = {
  'datos.cedula.ver': (n) => !['COORD_COMERCIAL', 'JEFE_COMERCIAL'].includes(n),
  'datos.contacto.ver': (n) => ['ADMIN', 'SUPER_ADMIN'].includes(n),
};

/** Agrega las casillas de datos personales que le corresponden al rol, siempre que tenga una página donde aparezcan. */
export function completarAccionesDeDatos(capacidades: readonly string[], namerol: string): string[] {
  const resultado = new Set(capacidades);
  for (const [codigo, aplica] of Object.entries(REGLAS_DATOS_PERSONALES)) {
    if (resultado.has(codigo) || !aplica(namerol)) continue;
    if (codigosNuevosActivos([...resultado, codigo]).has(codigo)) resultado.add(codigo);
  }
  // «Ver personal completo de la agencia» incluye la cédula y el correo y teléfono del personal.
  if (resultado.has('agencias.personal.ver') || resultado.has('pagina.operadores')) {
    resultado.add('datos.cedula.ver');
    resultado.add('datos.contacto.ver');
  }
  return [...resultado];
}
