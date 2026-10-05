import { IsArray, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginacionOpcionalDto, buildDataGridResponse } from '../dto/data-grid.dto.js';
import { PAGE_SIZE_MAX, combinarWhere, resolverPaginacion, whereBusqueda, type OpcionSelector } from './data-grid.helpers.js';

/** Tamaño de bloque por defecto de las opciones de un desplegable (el mismo del scroll infinito de la web). */
export const OPCIONES_PAGE_SIZE = 30;
/** Máximo de valores que se pueden resolver de una vez con `ids`. */
export const OPCIONES_MAX_IDS = 50;

/**
 * Base de los endpoints `…/opciones` de los desplegables con buscador y scroll infinito.
 * `search` y `page`/`pageSize` funcionan como en los listados; `ids` trae solo esas opciones (para mostrar la etiqueta de un
 * valor ya elegido que quedó fuera del primer bloque) sin paginar.
 */
export class OpcionesDto extends PaginacionOpcionalDto {
  @ApiPropertyOptional({ description: 'Devuelve solo las opciones con estos ids (máx. 50)', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ids?: string[];
}

export interface ConfigOpciones<T> {
  /** Alcance y filtros del endpoint (sin la búsqueda de texto). */
  where: Record<string, unknown>;
  /** Campos por los que busca el texto, con rutas de relaciones (`agencia.nombre`). */
  camposBusqueda: string[];
  /** Orden alfabético de la lista; siempre lleva desempate por `id`. */
  orderBy: unknown[];
  buscar: (args: { where: any; orderBy: any; skip: number; take: number }) => Promise<T[]>;
  contar: (where: any) => Promise<number>;
  /** Fila → opción del desplegable. */
  mapear: (fila: T) => OpcionSelector;
  /** Campo del id en el modelo (por defecto `id`). */
  campoId?: string;
}

/** Devuelve `{ items: OpcionSelector[], total, page, pageSize, totalPages, hasNextPage, hasPrevPage }`. */
export async function listarOpciones<T>(dto: OpcionesDto, cfg: ConfigOpciones<T>) {
  const campoId = cfg.campoId ?? 'id';
  const ids = Array.isArray(dto.ids) ? dto.ids.map(String).filter(Boolean).slice(0, OPCIONES_MAX_IDS) : [];

  if (ids.length > 0) {
    const where = combinarWhere(cfg.where, { [campoId]: { in: ids } });
    const filas = await cfg.buscar({ where, orderBy: cfg.orderBy, skip: 0, take: ids.length });
    const items = filas.map(cfg.mapear);
    return buildDataGridResponse(items, items.length, 1, Math.max(items.length, 1));
  }

  const { page, pageSize, skip, take } = resolverPaginacion(dto, { defecto: OPCIONES_PAGE_SIZE, max: PAGE_SIZE_MAX });
  const where = combinarWhere(cfg.where, whereBusqueda(cfg.camposBusqueda, dto.search));
  const [filas, total] = await Promise.all([
    cfg.buscar({ where, orderBy: cfg.orderBy, skip, take }),
    cfg.contar(where),
  ]);
  return buildDataGridResponse(filas.map(cfg.mapear), total, page, pageSize);
}
