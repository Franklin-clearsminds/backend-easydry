import { arbolPaginas } from '../../common/permisos/catalogo-paginas.js';

/** Todos los códigos (páginas, sub-páginas y acciones) que ofrece el editor de roles. */
export const CATALOGO_PAGINAS_CODIGOS: string[] = JSON.stringify(arbolPaginas()).match(/"codigo":"[^"]+"/g)?.map((x) => x.slice(10, -1)) ?? [];
