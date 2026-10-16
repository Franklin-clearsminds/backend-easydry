import 'reflect-metadata';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PAGINAS } from './catalogo-paginas.js';
import { CONTROLADORES, rutas } from './controladores.js';
import { PERMISO_KEY } from './permisos.decorators.js';

/**
 * Auditoría de las casillas del editor de roles: para cada acción y sub-página del catálogo comprueba
 *  - SERVIDOR: algún endpoint la exige (`@Permiso('código')`), o sea que apagarla de verdad bloquea;
 *  - PANTALLA: alguna pantalla de la web o de la app la usa (`puede('código')`), o sea que apagarla oculta el botón.
 * Es una búsqueda por texto del código entre comillas: basta para detectar casillas que no hacen nada.
 */
export interface Casilla {
  codigo: string;
  tipo: 'accion' | 'sub-pagina';
  pagina: string;
  nombre: string;
  /** Solo en sub-páginas: permisos clásicos que su activación concede (con ellos las exigen los endpoints). */
  otorga?: string[];
}

export interface ResultadoAuditoria extends Casilla {
  servidor: number;
  pantalla: number;
}

/** Todas las acciones (sin repetir las compartidas) y sub-páginas del catálogo. */
export function listarCasillas(): Casilla[] {
  const vistos = new Set<string>();
  const salida: Casilla[] = [];
  const agregar = (c: Casilla) => {
    if (vistos.has(c.codigo)) return;
    vistos.add(c.codigo);
    salida.push(c);
  };
  for (const p of PAGINAS) {
    for (const a of p.acciones) agregar({ codigo: a.codigo, tipo: 'accion', pagina: p.id, nombre: a.nombre });
    for (const s of p.subs) {
      agregar({ codigo: s.codigo, tipo: 'sub-pagina', pagina: p.id, nombre: s.nombre, otorga: s.otorga });
      for (const a of s.acciones) agregar({ codigo: a.codigo, tipo: 'accion', pagina: p.id, nombre: a.nombre });
    }
  }
  return salida;
}

/** Cuántos endpoints exigen cada código con `@Permiso(...)` (cualquiera de los de la lista basta). */
export function contarEndpointsPorCodigo(): Map<string, number> {
  const cuenta = new Map<string, number>();
  for (const [, controlador] of CONTROLADORES) {
    for (const { handler } of rutas(controlador)) {
      const codigos: string[] | undefined = Reflect.getMetadata(PERMISO_KEY, handler);
      for (const c of codigos ?? []) cuenta.set(c, (cuenta.get(c) ?? 0) + 1);
    }
  }
  return cuenta;
}

/**
 * Comprobaciones hechas DENTRO de los servicios (`tienePermiso(user, 'código')`), por ejemplo ocultar cédula o precios en una
 * respuesta. Cuentan como «exigida por el servidor» igual que un `@Permiso`. Se excluyen los archivos que solo DEFINEN códigos.
 */
export function contarComprobacionesEnServicios(raiz = resolve(process.cwd(), 'src')): string {
  const excluidos = /catalogo-paginas|catalogo-permisos|migracion-paginas|acciones-legacy|roles-base|auditoria-|modulos-navegacion|sync-permisos/;
  const partes: string[] = [];
  const recorrer = (dir: string) => {
    for (const nombre of readdirSync(dir)) {
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (/\.ts$/.test(nombre) && !/\.spec\.ts$/.test(nombre) && !/\.controller\.ts$/.test(nombre) && !excluidos.test(ruta)) partes.push(readFileSync(ruta, 'utf8'));
    }
  };
  recorrer(raiz);
  return partes.join('\n');
}

function leerFuentes(dir: string, acumulado: string[] = []): string[] {
  if (!existsSync(dir)) return acumulado;
  for (const nombre of readdirSync(dir)) {
    if (nombre === 'node_modules' || nombre === 'dist' || nombre === 'android' || nombre === 'testing') continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) leerFuentes(ruta, acumulado);
    else if (/\.(ts|tsx|html)$/.test(nombre) && !/\.spec\.ts$/.test(nombre) && !/\.d\.ts$/.test(nombre)) acumulado.push(readFileSync(ruta, 'utf8'));
  }
  return acumulado;
}

/** Texto de todas las pantallas (web y app). Si el repositorio hermano no está, devuelve null (la auditoría de pantallas se omite). */
export function cargarPantallas(raiz = resolve(process.cwd(), '..')): { web: string | null; app: string | null } {
  const web = join(raiz, 'frontend-easy-dry', 'src');
  const app = join(raiz, 'app-easy-dry', 'src');
  return {
    web: existsSync(web) ? leerFuentes(web).join('\n') : null,
    app: existsSync(app) ? leerFuentes(app).join('\n') : null,
  };
}

const aparicionesLiterales = (texto: string, codigo: string) => texto.split(`'${codigo}'`).length - 1 + texto.split(`"${codigo}"`).length - 1;

/**
 * Códigos que la pantalla arma al vuelo, p. ej. `catalogo.${grupo}.recetas.ver`: cada plantilla con `${…}` se convierte en un patrón
 * (la parte variable vale cualquier segmento) y cuenta como uso de todo código que encaje.
 */
const ESCAPAR = /[.*+?^${}()|[\]\\]/g;
const PLANTILLA = /`([^`\n]*\$\{[^}`]*\}[^`\n]*)`/g;
const VARIABLE = /\$\{[^}]*\}/;
const patronesDinamicos = (texto: string): RegExp[] => {
  const patrones: RegExp[] = [];
  for (const m of texto.matchAll(PLANTILLA)) {
    const partes = m[1].split(VARIABLE).map((p) => p.replace(ESCAPAR, '\\$&'));
    if (partes.join('').length < 6) continue; // plantillas sin forma de código
    patrones.push(new RegExp(`^${partes.join('[a-z0-9.-]+')}$`));
  }
  return patrones;
};
const patronesPorTexto = new Map<string, RegExp[]>();
const apariciones = (texto: string, codigo: string) => {
  let patrones = patronesPorTexto.get(texto);
  if (!patrones) {
    patrones = patronesDinamicos(texto);
    patronesPorTexto.set(texto, patrones);
  }
  return aparicionesLiterales(texto, codigo) + (patrones.some((r) => r.test(codigo)) ? 1 : 0);
};

export function auditar(raiz?: string): { resultados: ResultadoAuditoria[]; hayPantallas: boolean } {
  const servidor = contarEndpointsPorCodigo();
  const servicios = contarComprobacionesEnServicios();
  const { web, app } = cargarPantallas(raiz);
  const hayPantallas = web !== null && app !== null;
  // Una sub-página se exige en el servidor por los permisos que concede: apagarla los retira del rol y los endpoints que los piden se cierran.
  const exigidoPorLoQueOtorga = (c: Casilla) => (c.tipo === 'sub-pagina' ? (c.otorga ?? []).reduce((n, o) => n + (servidor.get(o) ?? 0), 0) : 0);
  const resultados = listarCasillas().map((c) => ({
    ...c,
    servidor: (servidor.get(c.codigo) ?? 0) + apariciones(servicios, c.codigo) + exigidoPorLoQueOtorga(c),
    pantalla:
      (web ? apariciones(web, c.codigo) : 0) +
      (app ? apariciones(app, c.codigo) : 0) +
      // Una sub-página se ve en pantalla por los permisos que concede (pestañas y listados que los piden).
      (c.tipo === 'sub-pagina' ? (c.otorga ?? []).reduce((n, o) => n + (web ? apariciones(web, o) : 0) + (app ? apariciones(app, o) : 0), 0) : 0),
  }));
  return { resultados, hayPantallas };
}
