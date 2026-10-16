import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/modules/prisma/prisma.service.js';
import { NotificationsService } from '../../src/modules/notifications/notifications.service.js';
import { StorageService } from '../../src/modules/storage/storage.service.js';
import { NotificationsGateway } from '../../src/modules/notifications/notifications.gateway.js';

/**
 * Entorno para pruebas de integración: Prisma REAL contra la base local (sin mocks).
 *
 * Reglas para no tocar los datos que ya hay en la base:
 *  - Todo lo que crea una prueba lleva el marcador `marca` (códigos, correos y nombres), que es único por ejecución.
 *  - `cerrar()` borra las filas que esta prueba creó (por id) y TODO lo que dependa de ellas (filas que creó el
 *    servicio probado: historiales, asignaciones, notificaciones…), siguiendo las claves foráneas de Postgres.
 *    Una fila que no cuelga de algo creado por la prueba nunca se toca.
 *  - Nunca se usa un borrado sin filtro por esos ids.
 *  - Los roles NO se crean: se usan los roles oficiales que ya están sembrados en la base.
 */

/** Nombre real de la tabla en Postgres de un modelo de Prisma (respeta `@@map`). */
function tablaDe(modelo: string): string {
  const m = Prisma.dmmf.datamodel.models.find((x) => x.name === modelo);
  if (!m) throw new Error(`Modelo Prisma desconocido: ${modelo}`);
  return m.dbName ?? m.name;
}

const comillas = (t: string) => `"${t.replace(/"/g, '""')}"`;

export interface Entorno {
  prisma: PrismaService;
  /** Marcador único de esta ejecución; va en nombres, códigos y correos creados. */
  marca: string;
  region(sufijo: string): Promise<{ id: string; codigo: string; nombre: string }>;
  cliente(sufijo: string): Promise<{ id: string; nombre: string }>;
  agencia(
    sufijo: string,
    opts?: { regionId?: string | null; clienteId?: string | null; numeroBahias?: number; maxLavadoresPorBahia?: number },
  ): Promise<{ id: string; codigo: string; nombre: string }>;
  bahia(sufijo: string, agenciaId: string, opts?: { activa?: boolean }): Promise<{ id: string; nombre: string }>;
  catalogo(
    sufijo: string,
    opts?: { categoria?: 'GENERAL' | 'ESPECIAL'; precio?: number; estado?: string },
  ): Promise<{ id: number; codigo: string; nombre: string }>;
  maquinaria(sufijo: string, opts?: { agenciaId?: string | null; operadorAsignadoId?: string | null }): Promise<{ id: string; codigo: string }>;
  tipoProducto(sufijo: string): Promise<{ id: string; codigo: string; nombre: string }>;
  /** Insumo con su propia unidad de medida. Nunca toca los insumos reales. */
  insumo(
    sufijo: string,
    opts?: { tipoProductoId?: string | null; estado?: number; categoria?: string; stockActual?: number },
  ): Promise<{ id: string; codigoSKU: string; nombre: string }>;
  /** Bodega REGIONAL de prueba (la central es única en el sistema y no se crea). */
  bodega(sufijo: string, opts?: { regionId?: string | null }): Promise<{ id: string; codigo: string; nombre: string }>;
  stock(opts: {
    insumoId: string;
    tipoUbicacion: 'BODEGA_CENTRAL' | 'AGENCIA' | 'PULIDOR_MOVIL' | 'PULIDOR_FIJO';
    agenciaId?: string | null;
    bodegaId?: string | null;
    pulidorId?: string | null;
    cantidad?: number;
    minima?: number;
  }): Promise<{ id: string }>;
  /** Movimiento de inventario (guía) real, con un detalle opcional. */
  movimiento(opts: {
    usuarioDespachaId: string;
    tipo?: 'COMPRA_PROVEEDOR' | 'DESPACHO_AGENCIA' | 'DESPACHO_PULIDOR' | 'DESPACHO_BODEGA' | 'RECEPCION_CONFIRMADA' | 'RECEPCION_RECHAZADA' | 'CONSUMO_SERVICIO' | 'AJUSTE_MERMA';
    estadoDespacho?: 'PENDIENTE' | 'EN_TRANSITO' | 'RECIBIDO' | 'RECHAZADO' | 'CANCELADO';
    origenAgenciaId?: string | null;
    origenBodegaId?: string | null;
    destinoAgenciaId?: string | null;
    destinoBodegaId?: string | null;
    destinoPulidorId?: string | null;
    usuarioRecibeId?: string | null;
    numeroGuia?: string;
    fechaDespacho?: Date;
    observaciones?: string | null;
    origenUbicacion?: string;
    destinoUbicacion?: string;
    detalle?: { insumoId: string; cantidadEnviada: number; cantidadRecibida?: number };
  }): Promise<{ id: string; numeroGuia: string }>;
  /** Servicio de lavado (OT) real. `asignados` son los lavadores adicionales del servicio. */
  servicioLavado(opts: {
    bahiaId: string;
    operadorId: string;
    catalogoId: number;
    estado?: 'EN_ESPERA' | 'EN_PROCESO' | 'FINALIZADO' | 'APROBADO' | 'RECHAZADO' | 'CANCELADO';
    horaSalida?: Date | null;
    precio?: number;
    placa?: string;
    ordenTrabajoOT?: string;
    asignados?: string[];
    deletedAt?: Date | null;
    modelo?: string;
    horaIngreso?: Date;
    /** Cualquier otro campo de ServicioLavado (aprobadoPor, observaciones, fotoSalidaUrl…). */
    datos?: Record<string, unknown>;
  }): Promise<{ id: string; placa: string }>;
  /** Servicio especial real. `asignados` son los pulidores asignados (el principal va en `operadorId`). */
  servicioEspecial(opts?: {
    operadorId?: string | null;
    agenciaId?: string | null;
    regionId?: string | null;
    catalogoId?: number | null;
    estado?: string;
    fechaFin?: Date | null;
    precio?: number;
    placa?: string;
    asignados?: string[];
    deletedAt?: Date | null;
    tipoServicio?: string;
    /** Cualquier otro campo de ServicioEspecial (createdAt, fechaInicio, recetaInsumos…). */
    datos?: Record<string, unknown>;
  }): Promise<{ id: string; placa: string; codigoSE: string }>;
  /**
   * StorageService real, SOLO para cumplir una dependencia. El `.env` trae credenciales del bucket S3 real: una prueba
   * que llame a subir/firmar archivos escribiría en ese bucket. Las pruebas que suben archivos no se hacen con este entorno.
   */
  storage(): StorageService;
  /** Servicio de notificaciones REAL (Prisma real; el gateway no tiene servidor de sockets, así que no emite). */
  notificaciones(): NotificationsService;
  /**
   * Repite `fn` hasta que no falle (máx. `intentos`). Solo para comparaciones del TOTAL de una tabla compartida con otros
   * archivos de prueba que corren en paralelo: entre dos consultas seguidas otro archivo puede crear o borrar filas.
   */
  reintentar<T>(fn: () => Promise<T>, intentos?: number): Promise<T>;
  /** Espera (sondeando) a que `fn` devuelva algo distinto de null/undefined/false: para trabajo "fire-and-forget". */
  esperar<T>(fn: () => Promise<T | null | undefined | false>, ms?: number): Promise<T>;
  usuario(
    sufijo: string,
    rol: string,
    opts?: { agenciaId?: string | null; regionId?: string | null; bodegaId?: string | null; estado?: number; name?: string; lastname?: string },
  ): Promise<{ id: string; email: string; name: string; lastname: string }>;
  /** El usuario tal como lo deja la estrategia JWT en `req.user`. */
  actor(userId: string): Promise<any>;
  /** Registra una fila creada por el servicio probado (modelo Prisma, id) para que se borre al cerrar. */
  rastrear(modelo: string, id: string): void;
  cerrar(): Promise<void>;
}

export async function abrirEntorno(): Promise<Entorno> {
  // Variables del `.env` (base de datos, claves…): el cargador de Nest no corre en las pruebas.
  try {
    process.loadEnvFile();
  } catch {
    // sin .env: se usan las variables que ya haya en el entorno
  }
  // Pocas conexiones por archivo de prueba: vitest abre varios archivos en paralelo.
  const base = process.env.DATABASE_URL;
  if (base && !/connection_limit=/.test(base)) {
    process.env.DATABASE_URL = `${base}${base.includes('?') ? '&' : '?'}connection_limit=3`;
  }
  const prisma = new PrismaService();
  await prisma.$connect();

  const marca = `t${randomBytes(4).toString('hex')}`;
  let contador = 0;
  let unidadId = '';
  const raices: Array<{ modelo: string; id: string }> = [];

  const rolId = async (namerol: string): Promise<string> => {
    const r = await prisma.role.findUnique({ where: { namerol }, select: { id: true } });
    if (!r) throw new Error(`El rol oficial ${namerol} no existe en la base: corre el seed antes de las pruebas.`);
    return r.id;
  };

  const rastrear = (modelo: string, id: string) => {
    raices.push({ modelo, id });
  };

  /** Borra las filas `ids` de `tabla` después de borrar, recursivamente, todo lo que las referencia. */
  async function borrarConDependientes(tabla: string, ids: string[], visitadas = new Set<string>()): Promise<void> {
    if (ids.length === 0) return;
    const clave = `${tabla}:${ids.join(',')}`;
    if (visitadas.has(clave)) return;
    visitadas.add(clave);

    const hijas = await prisma.$queryRawUnsafe<Array<{ tabla: string; columna: string }>>(
      `SELECT c.conrelid::regclass::text AS tabla, a.attname AS columna
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f' AND c.confrelid = $1::regclass AND array_length(c.conkey, 1) = 1`,
      comillas(tabla),
    );

    for (const h of hijas) {
      if (h.tabla === comillas(tabla) || h.tabla === tabla) {
        // Autorreferencia: se rompe el enlace en vez de recorrer en bucle.
        await prisma.$executeRawUnsafe(`UPDATE ${h.tabla} SET ${comillas(h.columna)} = NULL WHERE ${comillas(h.columna)}::text = ANY($1::text[])`, ids).catch(() => undefined);
        continue;
      }
      const filas = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT "id"::text AS id FROM ${h.tabla} WHERE ${comillas(h.columna)}::text = ANY($1::text[])`,
        ids,
      ).catch(() => null);
      if (filas === null) {
        // Tabla sin columna `id` (p. ej. de unión): se borra directo, no tiene dependientes.
        await prisma.$executeRawUnsafe(`DELETE FROM ${h.tabla} WHERE ${comillas(h.columna)}::text = ANY($1::text[])`, ids);
        continue;
      }
      await borrarConDependientes(h.tabla.replace(/^"|"$/g, ''), filas.map((f) => f.id), visitadas);
    }
    await prisma.$executeRawUnsafe(`DELETE FROM ${comillas(tabla)} WHERE "id"::text = ANY($1::text[])`, ids);
  }

  return {
    prisma,
    marca,
    rastrear,

    async region(sufijo) {
      const r = await prisma.region.create({
        data: { codigo: `${marca}-R-${sufijo}`, nombre: `${marca} Región ${sufijo}` },
        select: { id: true, codigo: true, nombre: true },
      });
      rastrear('Region', r.id);
      return r;
    },

    async cliente(sufijo) {
      const c = await prisma.cliente.create({
        data: { nombre: `${marca} Cliente ${sufijo}` },
        select: { id: true, nombre: true },
      });
      rastrear('Cliente', c.id);
      return c;
    },

    async agencia(sufijo, opts = {}) {
      const a = await prisma.agencia.create({
        data: {
          codigo: `${marca}-A-${sufijo}`,
          nombre: `${marca} Agencia ${sufijo}`,
          regionId: opts.regionId ?? null,
          clienteId: opts.clienteId ?? null,
          ...(opts.numeroBahias !== undefined ? { numeroBahias: opts.numeroBahias } : {}),
          ...(opts.maxLavadoresPorBahia !== undefined ? { maxLavadoresPorBahia: opts.maxLavadoresPorBahia } : {}),
        },
        select: { id: true, codigo: true, nombre: true },
      });
      rastrear('Agencia', a.id);
      return a;
    },

    async bahia(sufijo, agenciaId, opts = {}) {
      const b = await prisma.bahia.create({
        data: { nombre: `${marca} Bahía ${sufijo}`, codigo: `${marca}-B-${sufijo}`, agenciaId, activa: opts.activa ?? true },
        select: { id: true, nombre: true },
      });
      rastrear('Bahia', b.id);
      return b;
    },

    async catalogo(sufijo, opts = {}) {
      const c = await prisma.catalogoServicio.create({
        data: {
          codigo: `${marca}-S-${sufijo}`,
          nombre: `${marca} Servicio ${sufijo}`,
          categoria: opts.categoria ?? 'GENERAL',
          precio: opts.precio ?? 10,
          ...(opts.estado ? { estado: opts.estado } : {}),
        },
        select: { id: true, codigo: true, nombre: true },
      });
      rastrear('CatalogoServicio', String(c.id));
      return c;
    },

    async maquinaria(sufijo, opts = {}) {
      const m = await prisma.maquinaria.create({
        data: {
          codigo: `${marca}-M-${sufijo}`,
          nombre: `${marca} Máquina ${sufijo}`,
          tipo: 'HIDROLAVADORA',
          agenciaId: opts.agenciaId ?? null,
          operadorAsignadoId: opts.operadorAsignadoId ?? null,
        },
        select: { id: true, codigo: true },
      });
      rastrear('Maquinaria', m.id);
      return m;
    },

    async tipoProducto(sufijo) {
      const t = await prisma.tipoProducto.create({
        data: { codigo: `${marca}-TP-${sufijo}`, nombre: `${marca} Tipo ${sufijo}` },
        select: { id: true, codigo: true, nombre: true },
      });
      rastrear('TipoProducto', t.id);
      return t;
    },

    async insumo(sufijo, opts = {}) {
      if (!unidadId) {
        const u = await prisma.unidadMedida.create({
          data: { codigo: `${marca}-U`, nombre: `${marca} Litro`, simbolo: 'L', tipo: 'VOLUMEN', factorBase: 1 },
        });
        rastrear('UnidadMedida', u.id);
        unidadId = u.id;
      }
      const i = await prisma.insumo.create({
        data: {
          codigoSKU: `${marca}-SKU-${sufijo}`,
          nombre: `${marca} Insumo ${sufijo}`,
          categoria: opts.categoria ?? 'QUIMICOS_LAVADO',
          unidadMedidaId: unidadId,
          tipoProductoId: opts.tipoProductoId ?? null,
          estado: opts.estado ?? 1,
          ...(opts.stockActual !== undefined ? { stockActual: opts.stockActual } : {}),
        },
        select: { id: true, codigoSKU: true, nombre: true },
      });
      rastrear('Insumo', i.id);
      return i;
    },

    async bodega(sufijo, opts = {}) {
      const b = await prisma.bodega.create({
        data: { codigo: `${marca}-BOD-${sufijo}`, nombre: `${marca} Bodega ${sufijo}`, tipo: 'REGIONAL', esCentral: false, regionId: opts.regionId ?? null },
        select: { id: true, codigo: true, nombre: true },
      });
      rastrear('Bodega', b.id);
      return b;
    },

    async stock(opts) {
      const st = await prisma.stockUbicacion.create({
        data: {
          insumoId: opts.insumoId,
          tipoUbicacion: opts.tipoUbicacion,
          agenciaId: opts.agenciaId ?? null,
          bodegaId: opts.bodegaId ?? null,
          pulidorId: opts.pulidorId ?? null,
          cantidadActual: opts.cantidad ?? 0,
          cantidadMinima: opts.minima ?? 0,
        },
        select: { id: true },
      });
      rastrear('StockUbicacion', st.id);
      return st;
    },

    async movimiento(opts) {
      const n = ++contador;
      const m = await prisma.movimientoInventario.create({
        data: {
          numeroGuia: opts.numeroGuia ?? `${marca}-G-${n}`,
          tipo: opts.tipo ?? 'DESPACHO_AGENCIA',
          estadoDespacho: opts.estadoDespacho ?? 'EN_TRANSITO',
          origenUbicacion: opts.origenUbicacion ?? 'Origen de prueba',
          destinoUbicacion: opts.destinoUbicacion ?? 'Destino de prueba',
          observaciones: opts.observaciones ?? null,
          ...(opts.fechaDespacho ? { fechaDespacho: opts.fechaDespacho } : {}),
          usuarioDespachaId: opts.usuarioDespachaId,
          usuarioRecibeId: opts.usuarioRecibeId ?? null,
          origenAgenciaId: opts.origenAgenciaId ?? null,
          origenBodegaId: opts.origenBodegaId ?? null,
          destinoAgenciaId: opts.destinoAgenciaId ?? null,
          destinoBodegaId: opts.destinoBodegaId ?? null,
          destinoPulidorId: opts.destinoPulidorId ?? null,
          ...(opts.detalle
            ? { detalles: { create: [{ insumoId: opts.detalle.insumoId, cantidadEnviada: opts.detalle.cantidadEnviada, cantidadRecibida: opts.detalle.cantidadRecibida ?? null }] } }
            : {}),
        },
        select: { id: true, numeroGuia: true },
      });
      rastrear('MovimientoInventario', m.id);
      return m;
    },

    async servicioLavado(opts) {
      const n = ++contador;
      const placa = opts.placa ?? `T${n.toString().padStart(3, '0')}-${marca.slice(1, 4).toUpperCase()}`;
      const s = await prisma.servicioLavado.create({
        data: {
          clientUuid: `${marca}-${n}-${randomBytes(4).toString('hex')}`,
          placa,
          modelo: opts.modelo ?? 'Modelo de prueba',
          ...(opts.horaIngreso ? { horaIngreso: opts.horaIngreso } : {}),
          ordenTrabajoOT: opts.ordenTrabajoOT ?? null,
          estado: opts.estado ?? 'FINALIZADO',
          bahiaId: opts.bahiaId,
          operadorId: opts.operadorId,
          servicioCatalogoId: opts.catalogoId,
          precio: opts.precio ?? 10,
          horaSalida: opts.horaSalida === undefined ? new Date() : opts.horaSalida,
          deletedAt: opts.deletedAt ?? null,
          ...(opts.asignados?.length ? { operadoresAsignados: { create: opts.asignados.map((operadorId) => ({ operadorId })) } } : {}),
          ...(opts.datos ?? {}),
        } as never,
        select: { id: true, placa: true },
      });
      rastrear('ServicioLavado', s.id);
      return s;
    },

    async servicioEspecial(opts = {}) {
      const n = ++contador;
      const placa = opts.placa ?? `E${n.toString().padStart(3, '0')}-${marca.slice(1, 4).toUpperCase()}`;
      const s = await prisma.servicioEspecial.create({
        data: {
          codigoSE: `${marca}-SE-${n}`,
          tipoServicio: opts.tipoServicio ?? 'Pulido',
          placa,
          estado: opts.estado ?? 'Completado',
          precio: opts.precio ?? 50,
          operadorId: opts.operadorId ?? null,
          agenciaId: opts.agenciaId ?? null,
          regionId: opts.regionId ?? null,
          servicioCatalogoId: opts.catalogoId ?? null,
          fechaFin: opts.fechaFin === undefined ? new Date() : opts.fechaFin,
          deletedAt: opts.deletedAt ?? null,
          ...(opts.asignados?.length ? { operadoresAsignados: { create: opts.asignados.map((operadorId, orden) => ({ operadorId, orden })) } } : {}),
          ...(opts.datos ?? {}),
        } as never,
        select: { id: true, placa: true, codigoSE: true },
      });
      rastrear('ServicioEspecial', s.id);
      return s;
    },

    storage() {
      return new StorageService(new ConfigService(), prisma);
    },

    notificaciones() {
      return new NotificationsService(prisma, new NotificationsGateway(new JwtService({}), prisma, new ConfigService()));
    },

    async reintentar<T>(fn: () => Promise<T>, intentos = 6): Promise<T> {
      for (let i = 1; ; i++) {
        try {
          return await fn();
        } catch (e) {
          if (i >= intentos) throw e;
          await new Promise((ok) => setTimeout(ok, 200));
        }
      }
    },

    async esperar<T>(fn: () => Promise<T | null | undefined | false>, ms = 40_000): Promise<T> {
      const limite = Date.now() + ms;
      for (;;) {
        const r = await fn();
        if (r) return r as T;
        if (Date.now() > limite) throw new Error('Tiempo de espera agotado en la prueba');
        await new Promise((ok) => setTimeout(ok, 50));
      }
    },

    async usuario(sufijo, rol, opts = {}) {
      const u = await prisma.user.create({
        data: {
          email: `${marca}-${sufijo}@prueba.local`,
          passwordHash: 'no-se-usa-en-pruebas',
          name: opts.name ?? `${marca}${sufijo}`,
          lastname: opts.lastname ?? 'Prueba',
          roleId: await rolId(rol),
          agenciaId: opts.agenciaId ?? null,
          regionId: opts.regionId ?? null,
          bodegaId: opts.bodegaId ?? null,
          estado: opts.estado ?? 1,
        },
        select: { id: true, email: true, name: true, lastname: true },
      });
      rastrear('User', u.id);
      return u;
    },

    async actor(userId) {
      const u = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        include: { role: true, agencia: true, region: true, bodega: true },
      });
      return { ...u, nombre: `${u.name} ${u.lastname}`.trim(), roleDetails: u.role };
    },

    async cerrar() {
      try {
        // Avisos que el servicio probado envió a usuarios REALES (p. ej. los administradores) sobre filas de prueba.
        // Muchos se envían en segundo plano ("fire-and-forget") y pueden llegar DESPUÉS de que termina la prueba: se
        // espera a que se asienten y se borra dos veces (antes y después de borrar las filas de prueba).
        const ids = raices.map((r) => r.id);
        const borrarPorEntidad = async () => {
          if (!ids.length) return;
          // Tablas que apuntan a la fila de prueba solo por un `entidadId` de texto (sin clave foránea).
          for (const modelo of ['Notification', 'AuditoriaDecision']) {
            await prisma
              .$executeRawUnsafe(`DELETE FROM ${comillas(tablaDe(modelo))} WHERE "entidadId" = ANY($1::text[])`, ids)
              .catch(() => undefined);
          }
        };
        await new Promise((ok) => setTimeout(ok, 600));
        await borrarPorEntidad();
        for (const { modelo, id } of [...raices].reverse()) {
          // Reintenta: un trabajo en segundo plano puede insertar un dependiente justo entre el borrado de los hijos y el de la fila.
          for (let intento = 1; intento <= 4; intento++) {
            try {
              await borrarConDependientes(tablaDe(modelo), [id]);
              break;
            } catch (e: any) {
              if (intento === 4) {
                // eslint-disable-next-line no-console
                console.warn(`[entorno] No se pudo borrar ${modelo} ${id}: ${e?.message ?? e}`);
              } else {
                await new Promise((ok) => setTimeout(ok, 300));
              }
            }
          }
        }
        await new Promise((ok) => setTimeout(ok, 300));
        await borrarPorEntidad();
        // Candado propio que las pruebas del archivado toman para no bloquearse entre sí (ver `OpcionesCorrida.candado`).
        await prisma.$executeRawUnsafe(`DELETE FROM archivado_candado WHERE id = $1`, `prueba-${marca}`).catch(() => undefined);
        // Tablas de sincronización sin clave foránea: se reconocen por la marca en el id de la mutación o del cliente.
        for (const [modelo, columnas] of [['SyncDeadLetterQueue', ['mutationId', 'clientUuid']], ['SyncOutboxAudit', ['mutationId', 'clientUuid']]] as const) {
          const donde = columnas.map((c) => `"${c}" LIKE $1`).join(' OR ');
          await prisma.$executeRawUnsafe(`DELETE FROM ${comillas(tablaDe(modelo))} WHERE ${donde}`, `${marca}%`).catch(() => undefined);
        }
      } finally {
        await prisma.$disconnect();
      }
    },
  };
}
