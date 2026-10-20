/**
 * Carga prisma/data/datos-agencias.json a la base.
 * No trunca seed (roles, Super Admin, Admin, unidades).
 *
 * Uso: npx tsx prisma/import-datos-agencias.ts
 *      npm run prisma:import-agencias
 */
import { Prisma, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { Redis } from 'ioredis';
import { motivoPasswordDebil } from '../src/common/utils/password-politica.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const prisma = new PrismaClient();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, 'data', 'datos-agencias.json');
/**
 * Contraseña inicial de los usuarios NUEVOS. Es obligatoria, viene de IMPORT_PASSWORD_INICIAL, no tiene valor por defecto y debe
 * cumplir la política de contraseñas. Los usuarios no pueden cambiarla: solo un administrador (o quien tenga ese permiso) la cambia.
 */
function passwordInicial(): string {
  const valor = process.env.IMPORT_PASSWORD_INICIAL?.trim();
  if (!valor) throw new Error('Define IMPORT_PASSWORD_INICIAL en el .env o en el entorno.');
  // Misma política que cualquier contraseña del sistema (10+ caracteres, mayúscula, minúscula, número y carácter especial).
  const motivo = motivoPasswordDebil(valor);
  if (motivo) throw new Error(`IMPORT_PASSWORD_INICIAL no cumple la política de contraseñas: ${motivo}`);
  return valor;
}
const PASSWORD = passwordInicial();
const RESERVED_EMAILS = new Set(['superadmin@easydry.com', 'admin@easydry.com']);
const PROSPECT_MARCAS = new Set(['ORGU FORD', 'ASSA', 'IOKARS', 'OIKORSA']);

type RecetaLinea = {
  insumoNombre: string;
  codigoSKU: string;
  cantidad: number;
  unidad: string;
  nota?: string;
};

type CatalogoItem = {
  nombre: string;
  categoria: 'GENERAL' | 'ESPECIAL';
  tiempoEstimadoMin: number;
  receta: RecetaLinea[];
};

type InsumoItem = {
  codigoSKU: string;
  nombre: string;
  unidad: string;
  categoria: string;
};

type OperarioItem = {
  nombre: string;
  cedula: string;
  nota?: string;
  row?: number;
  esPulidor?: boolean;
};

type AgenciaItem = {
  marca: string;
  agenciaRaw: string;
  nombre: string;
  bahias: number;
  region: 'Sierra' | 'Costa' | string;
  servicios: string[];
  operarios: OperarioItem[];
  notas: string[];
};

type PulidorExcel = {
  nombre: string;
  cedula: string;
  ciudad: string;
  region: string;
};

type PersonalGestionExcel = {
  nombre: string;
  cedula: string;
  rol: string;
  agencia: string;
  region: string;
  bodega: string;
  correo: string;
};

type Payload = {
  clientes: string[];
  pulidoresExcel: PulidorExcel[];
  pulidorCedulas: string[];
  personalGestion?: PersonalGestionExcel[];
  agencias: AgenciaItem[];
  catalogo: CatalogoItem[];
  insumos: InsumoItem[];
};

function slug(s: string, max = 24): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, max);
}

function emailSlug(s: string, max = 40): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '')
    .slice(0, max);
}

function splitNombre(full: string): { name: string; lastname: string } {
  const parts = String(full || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (parts.length === 0) return { name: 'Sin', lastname: 'Nombre' };
  if (parts.length === 1) return { name: parts[0], lastname: parts[0] };
  if (parts.length === 2) return { lastname: parts[0], name: parts[1] };
  return { lastname: parts.slice(0, 2).join(' '), name: parts.slice(2).join(' ') };
}

function normKey(s: string): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function parseContenidoNeto(nombre: string, unidad: string): number {
  if (unidad === 'UND') return 1;
  const n = String(nombre || '').toUpperCase();
  const lts = n.match(/(\d+(?:[.,]\d+)?)\s*LTS?\b/);
  if (lts) return Math.round(parseFloat(lts[1].replace(',', '.')) * 1000);
  const ml = n.match(/(\d+(?:[.,]\d+)?)\s*ML\b/);
  if (ml) return parseFloat(ml[1].replace(',', '.'));
  return 1;
}

function makeEmail(nombre: string, rol: string, cedula: string, used: Set<string>): string {
  const base = `${emailSlug(nombre) || 'usuario'}.${emailSlug(rol) || 'rol'}`;
  let email = `${base}@easydry.com`;
  if (used.has(email) || RESERVED_EMAILS.has(email)) {
    const suffix = (cedula || '').replace(/\D/g, '').slice(-4) || 'dup';
    email = `${base}.${suffix}@easydry.com`;
  }
  let n = 2;
  while (used.has(email) || RESERVED_EMAILS.has(email)) {
    email = `${base}.${n}@easydry.com`;
    n += 1;
  }
  used.add(email);
  return email;
}

function agencyCodigo(nombre: string, used: Set<string>): string {
  let code = `AGN-${slug(nombre, 20)}`;
  let n = 2;
  while (used.has(code)) {
    code = `AGN-${slug(nombre, 16)}-${n}`;
    n += 1;
  }
  used.add(code);
  return code;
}

function servicioCodigo(nombre: string, index: number, used: Set<string>): string {
  const base = `SER-${slug(nombre, 16) || String(index + 1).padStart(3, '0')}`;
  let code = base;
  let n = 2;
  while (used.has(code)) {
    code = `${base}-${n}`;
    n += 1;
  }
  used.add(code);
  return code;
}

async function ensureAlerta(params: {
  insumoId: string;
  agenciaId?: string | null;
  pulidorId?: string | null;
  emisorId: string;
  mensaje: string;
}): Promise<void> {
  const where: Prisma.AlertaStockWhereInput = {
    insumoId: params.insumoId,
    estado: 'PENDIENTE',
    nivel: 'AGOTADO',
  };
  if (params.pulidorId) where.pulidorId = params.pulidorId;
  else if (params.agenciaId) {
    where.agenciaId = params.agenciaId;
    where.pulidorId = null;
  } else {
    where.agenciaId = null;
    where.pulidorId = null;
  }
  const existing = await prisma.alertaStock.findFirst({ where, select: { id: true } });
  if (existing) return;
  await prisma.alertaStock.create({
    data: {
      insumoId: params.insumoId,
      nivel: 'AGOTADO',
      estado: 'PENDIENTE',
      agenciaId: params.agenciaId || null,
      pulidorId: params.pulidorId || null,
      usuarioEmisorId: params.emisorId,
      mensaje: params.mensaje,
      stockReportado: 0,
    },
  });
}

async function syncStockAgencia(agenciaId: string, servicioIds: number[], emisorId: string): Promise<number> {
  if (!servicioIds.length) return 0;
  const recetas = await prisma.recetaInsumo.findMany({
    where: { catalogoServicioId: { in: servicioIds } },
    include: {
      insumo: { select: { id: true, nombre: true, stockMinimoAgencia: true } },
      catalogoServicio: { select: { nombre: true } },
    },
  });
  if (!recetas.length) return 0;
  const insumoIds = [...new Set(recetas.map((r) => r.insumoId))];
  const existentes = await prisma.stockUbicacion.findMany({
    where: { agenciaId, tipoUbicacion: 'AGENCIA', insumoId: { in: insumoIds } },
    select: { insumoId: true, cantidadActual: true },
  });
  const setExistentes = new Set(existentes.map((s) => s.insumoId));
  const stockPorInsumo = new Map(existentes.map((s) => [s.insumoId, Number(s.cantidadActual)]));
  let created = 0;
  for (const r of recetas) {
    if (setExistentes.has(r.insumoId)) continue;
    await prisma.stockUbicacion.create({
      data: {
        agenciaId,
        insumoId: r.insumoId,
        tipoUbicacion: 'AGENCIA',
        cantidadActual: 0,
        cantidadMinima: r.insumo?.stockMinimoAgencia ?? 2,
      },
    });
    setExistentes.add(r.insumoId);
    stockPorInsumo.set(r.insumoId, 0);
    created += 1;
  }
  const agencia = await prisma.agencia.findUnique({ where: { id: agenciaId }, select: { nombre: true } });
  for (const insumoId of insumoIds) {
    if ((stockPorInsumo.get(insumoId) ?? 0) > 0) continue;
    const rec = recetas.find((r) => r.insumoId === insumoId);
    const servicios = [...new Set(recetas.filter((r) => r.insumoId === insumoId).map((r) => r.catalogoServicio.nombre))];
    await ensureAlerta({
      insumoId,
      agenciaId,
      pulidorId: null,
      emisorId,
      mensaje:
        `Sede ${agencia?.nombre || agenciaId}: ${rec?.insumo?.nombre || insumoId} requerido por servicio(s) asignado(s)` +
        (servicios.length ? ` (${servicios.join(', ')})` : '') +
        ` sin stock. Despachar insumos.`,
    });
  }
  return created;
}

async function syncStockPulidor(pulidorId: string, servicioIds: number[], emisorId: string): Promise<number> {
  if (!servicioIds.length) return 0;
  const pulidor = await prisma.user.findUnique({
    where: { id: pulidorId },
    select: {
      name: true,
      lastname: true,
      agenciaId: true,
      region: { select: { nombre: true } },
      agencia: { select: { nombre: true } },
    },
  });
  if (!pulidor) return 0;
  const tipoUb = pulidor.agenciaId ? 'PULIDOR_FIJO' : 'PULIDOR_MOVIL';
  const recetas = await prisma.recetaInsumo.findMany({
    where: { catalogoServicioId: { in: servicioIds } },
    include: {
      insumo: { select: { id: true, nombre: true, stockMinimoAgencia: true } },
      catalogoServicio: { select: { nombre: true } },
    },
  });
  if (!recetas.length) return 0;
  const insumoIds = [...new Set(recetas.map((r) => r.insumoId))];
  const existentes = await prisma.stockUbicacion.findMany({
    where: { pulidorId, insumoId: { in: insumoIds } },
    select: { insumoId: true, cantidadActual: true },
  });
  const setExistentes = new Set(existentes.map((s) => s.insumoId));
  const stockPorInsumo = new Map(existentes.map((s) => [s.insumoId, Number(s.cantidadActual)]));
  let created = 0;
  for (const r of recetas) {
    if (setExistentes.has(r.insumoId)) continue;
    await prisma.stockUbicacion.create({
      data: {
        pulidorId,
        insumoId: r.insumoId,
        tipoUbicacion: tipoUb,
        cantidadActual: 0,
        cantidadMinima: r.insumo?.stockMinimoAgencia ?? 1,
        agenciaId: pulidor.agenciaId || null,
      },
    });
    setExistentes.add(r.insumoId);
    stockPorInsumo.set(r.insumoId, 0);
    created += 1;
  }
  const nombrePulidor = `${pulidor.name} ${pulidor.lastname || ''}`.trim();
  const contexto = pulidor.agenciaId
    ? `Pulidor fijo ${nombrePulidor} (${pulidor.agencia?.nombre || 'sede'})`
    : `Pulidor móvil ${nombrePulidor} (Región ${pulidor.region?.nombre || 'N/D'})`;
  for (const insumoId of insumoIds) {
    if ((stockPorInsumo.get(insumoId) ?? 0) > 0) continue;
    const rec = recetas.find((r) => r.insumoId === insumoId);
    const servicios = [...new Set(recetas.filter((r) => r.insumoId === insumoId).map((r) => r.catalogoServicio.nombre))];
    await ensureAlerta({
      insumoId,
      agenciaId: pulidor.agenciaId || null,
      pulidorId,
      emisorId,
      mensaje:
        `${contexto}: ${rec?.insumo?.nombre || insumoId} requerido` +
        (servicios.length ? ` por ${servicios.join(', ')}` : '') +
        ` sin stock en kit. Despachar insumos al pulidor.`,
    });
  }
  return created;
}

async function main() {
  if (!fs.existsSync(DATA_PATH)) {
    throw new Error(`No existe ${DATA_PATH}. Ejecuta primero: node prisma/extract-datos-agencias.cjs`);
  }
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')) as Payload;
  console.log(`📦 JSON ${data.agencias.length} agencias, ${data.catalogo.length} servicios, ${data.insumos.length} insumos`);

  const roles = await prisma.role.findMany({ where: { namerol: { in: ['LAVADOR', 'PULIDOR', 'SUPER_ADMIN', 'ADMIN'] } } });
  const roleLavador = roles.find((r) => r.namerol === 'LAVADOR');
  const rolePulidor = roles.find((r) => r.namerol === 'PULIDOR');
  if (!roleLavador || !rolePulidor) {
    throw new Error('Faltan roles LAVADOR/PULIDOR. Ejecuta primero: npm run prisma:seed');
  }

  const unidades = await prisma.unidadMedida.findMany();
  const unidadByCodigo = new Map(unidades.map((u) => [u.codigo.toUpperCase(), u]));
  const tipos = await prisma.tipoProducto.findMany();
  const tipoLiquido = tipos.find((t) => t.codigo === 'LIQUIDO');
  const tipoUnidad = tipos.find((t) => t.codigo === 'UNIDAD');
  if (!unidadByCodigo.get('ML') || !unidadByCodigo.get('UND') || !tipoLiquido || !tipoUnidad) {
    throw new Error('Faltan unidades/tipos de producto del seed.');
  }

  const emisor =
    (await prisma.user.findFirst({
      where: { email: { in: [...RESERVED_EMAILS] }, estado: 1 },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    })) ||
    (await prisma.user.findFirst({
      where: { role: { namerol: { in: ['SUPER_ADMIN', 'ADMIN'] } }, estado: 1 },
      select: { id: true },
    }));
  if (!emisor) throw new Error('No hay Super Admin / Admin para emitir alertas.');

  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const regionIds = new Map<string, string>();
  for (const [nombre, codigo] of [
    ['Sierra', 'REG-SIERRA'],
    ['Costa', 'REG-COSTA'],
  ] as const) {
    const region = await prisma.region.upsert({
      where: { nombre },
      create: { codigo, nombre, descripcion: `Región ${nombre}`, estado: 1 },
      update: { codigo, estado: 1 },
    });
    regionIds.set(nombre, region.id);
  }

  const clienteIds = new Map<string, string>();
  for (const nombre of data.clientes) {
    const cliente = await prisma.cliente.upsert({
      where: { nombre },
      create: { nombre, estado: 1 },
      update: { estado: 1 },
    });
    clienteIds.set(nombre, cliente.id);
  }

  const unidadML = unidadByCodigo.get('ML')!;
  const unidadUND = unidadByCodigo.get('UND')!;
  const insumoIds = new Map<string, string>();
  for (const item of data.insumos) {
    const sku = (item.codigoSKU || slug(item.nombre, 20)).trim();
    const unidad = item.unidad === 'UND' ? unidadUND : unidadML;
    const tipo = item.unidad === 'UND' ? tipoUnidad : tipoLiquido;
    const insumo = await prisma.insumo.upsert({
      where: { codigoSKU: sku },
      create: {
        codigoSKU: sku,
        nombre: item.nombre,
        categoria: item.categoria || (item.unidad === 'UND' ? 'CONSUMIBLE' : 'QUIMICOS_LAVADO'),
        tipoProductoId: tipo.id,
        unidadMedidaId: unidad.id,
        contenidoNeto: parseContenidoNeto(item.nombre, item.unidad),
        stockActual: 0,
        stockMinimoBodega: 10,
        stockMinimoAgencia: item.unidad === 'UND' ? 1 : 2,
        estado: 1,
      },
      update: {
        nombre: item.nombre,
        categoria: item.categoria || (item.unidad === 'UND' ? 'CONSUMIBLE' : 'QUIMICOS_LAVADO'),
        tipoProductoId: tipo.id,
        unidadMedidaId: unidad.id,
        contenidoNeto: parseContenidoNeto(item.nombre, item.unidad),
        estado: 1,
      },
    });
    insumoIds.set(normKey(sku), insumo.id);
    insumoIds.set(normKey(item.nombre), insumo.id);
  }

  const existingCatalogo = await prisma.catalogoServicio.findMany();
  const catalogoByName = new Map(existingCatalogo.map((c) => [normKey(c.nombre), c]));
  const usedSvcCodes = new Set(existingCatalogo.map((c) => c.codigo));
  const catalogoIds = new Map<string, number>();
  const especialIds: number[] = [];

  for (let i = 0; i < data.catalogo.length; i++) {
    const svc = data.catalogo[i];
    const key = normKey(svc.nombre);
    let row = catalogoByName.get(key);
    if (!row) {
      row = await prisma.catalogoServicio.create({
        data: {
          codigo: servicioCodigo(svc.nombre, i, usedSvcCodes),
          nombre: svc.nombre,
          categoria: svc.categoria,
          tiempoEstimadoMin: svc.tiempoEstimadoMin || 30,
          precio: 0,
        },
      });
      catalogoByName.set(key, row);
    } else {
      row = await prisma.catalogoServicio.update({
        where: { id: row.id },
        data: {
          categoria: svc.categoria,
          tiempoEstimadoMin: svc.tiempoEstimadoMin || row.tiempoEstimadoMin,
        },
      });
    }
    catalogoIds.set(key, row.id);
    if (svc.categoria === 'ESPECIAL') especialIds.push(row.id);

    const aggregated = new Map<string, { insumoId: string; cantidad: number; unidad: string; nota: string }>();
    for (const line of svc.receta || []) {
      const skuKey = normKey(line.codigoSKU);
      const nameKey = normKey(line.insumoNombre);
      const insumoId = insumoIds.get(skuKey) || insumoIds.get(nameKey);
      if (!insumoId) {
        console.warn(`  ⚠ Insumo no encontrado en receta ${svc.nombre}: ${line.insumoNombre} (${line.codigoSKU})`);
        continue;
      }
      const prev = aggregated.get(insumoId);
      if (prev) prev.cantidad += Number(line.cantidad) || 0;
      else {
        aggregated.set(insumoId, {
          insumoId,
          cantidad: Number(line.cantidad) || 0,
          unidad: line.unidad,
          nota: line.nota || '',
        });
      }
    }
    await prisma.recetaInsumo.deleteMany({ where: { catalogoServicioId: row.id } });
    for (const line of aggregated.values()) {
      const unidad = line.unidad === 'UND' ? unidadUND : unidadByCodigo.get(line.unidad.toUpperCase()) || unidadML;
      await prisma.recetaInsumo.create({
        data: {
          catalogoServicioId: row.id,
          insumoId: line.insumoId,
          cantidadUsada: line.cantidad,
          unidadConsumoId: unidad.id,
          esOpcional: false,
          observacion: line.nota || null,
        },
      });
    }
  }

  const existingAgencias = await prisma.agencia.findMany({ select: { id: true, codigo: true, nombre: true } });
  const usedAgCodes = new Set(existingAgencias.map((a) => a.codigo));
  const agenciaByName = new Map(existingAgencias.map((a) => [normKey(a.nombre), a]));
  const agenciaIds = new Map<string, string>();
  const unmatchedServicios: string[] = [];
  let bahiasCreadas = 0;

  for (const ag of data.agencias) {
    const regionId = regionIds.get(ag.region) || regionIds.get('Sierra')!;
    const clienteId = clienteIds.get(ag.marca) || null;
    const prev = agenciaByName.get(normKey(ag.nombre));
    const servicioIds: number[] = [];
    const serviciosNombres: string[] = [];
    for (const nombreSvc of ag.servicios) {
      const id = catalogoIds.get(normKey(nombreSvc));
      if (id) {
        servicioIds.push(id);
        serviciosNombres.push(nombreSvc);
      } else {
        unmatchedServicios.push(`${ag.nombre} → ${nombreSvc}`);
      }
    }
    const tienePulidorFijo = ag.operarios.some((o) => o.esPulidor);
    const numeroBahias = Math.max(ag.bahias || 0, 1);
    const payloadAgencia = {
      nombre: ag.nombre,
      region: ag.region,
      regionId,
      clienteId,
      numeroBahias,
      maxLavadoresPorBahia: 1,
      estado: 1,
      tieneServiciosEspeciales: tienePulidorFijo,
      servicioIds: servicioIds as unknown as Prisma.InputJsonValue,
      serviciosNombres: serviciosNombres as unknown as Prisma.InputJsonValue,
    };

    let agenciaId: string;
    if (prev) {
      const updated = await prisma.agencia.update({
        where: { id: prev.id },
        data: payloadAgencia,
      });
      agenciaId = updated.id;
      usedAgCodes.add(updated.codigo);
    } else {
      const created = await prisma.agencia.create({
        data: {
          codigo: agencyCodigo(ag.nombre, usedAgCodes),
          ...payloadAgencia,
        },
      });
      agenciaId = created.id;
      agenciaByName.set(normKey(ag.nombre), { id: created.id, codigo: created.codigo, nombre: created.nombre });
    }
    agenciaIds.set(normKey(ag.nombre), agenciaId);

    const agenciaRow = await prisma.agencia.findUnique({ where: { id: agenciaId }, select: { codigo: true } });
    for (let i = 1; i <= numeroBahias; i++) {
      const numStr = String(i).padStart(2, '0');
      const codigoBahia = `${agenciaRow!.codigo}-B${numStr}`;
      await prisma.bahia.upsert({
        where: { codigo: codigoBahia },
        create: {
          codigo: codigoBahia,
          nombre: `Bahía ${numStr}`,
          agenciaId,
          activa: true,
        },
        update: { nombre: `Bahía ${numStr}`, agenciaId, activa: true },
      });
      bahiasCreadas += 1;
    }
  }

  const claimedEmails = new Set<string>([...RESERVED_EMAILS]);
  const assignedCedulas = new Set<string>();
  // Cada agencia solo puede tener un pulidor fijo (decisión de producto). Si el Excel trae más de
  // uno marcado como pulidor para la misma sede, es un error de la hoja de datos, no algo que el
  // importador deba resolver por su cuenta asignando ambos en silencio.
  const fijoPorAgencia = new Map<string, string>();
  let lavadores = 0;
  let pulidoresFijos = 0;
  let pulidoresMoviles = 0;
  let usuariosOmitidos = 0;

  for (const ag of data.agencias) {
    if (PROSPECT_MARCAS.has(ag.marca.toUpperCase())) continue;
    const agenciaId = agenciaIds.get(normKey(ag.nombre));
    if (!agenciaId) continue;
    const regionId = regionIds.get(ag.region) || regionIds.get('Sierra')!;

    for (const op of ag.operarios) {
      const cedula = (op.cedula || '').trim();
      if (cedula && assignedCedulas.has(cedula)) {
        usuariosOmitidos += 1;
        continue;
      }
      const nombre = (op.nombre || '').trim() || `SIN NOMBRE ${cedula || 'X'}`;
      let esPulidor = Boolean(op.esPulidor);
      if (esPulidor) {
        const yaAsignado = fijoPorAgencia.get(agenciaId);
        if (yaAsignado && yaAsignado !== (cedula || nombre)) {
          console.warn(
            `La agencia "${ag.nombre}" tiene más de un pulidor marcado en el Excel (${yaAsignado} y ${cedula || nombre}). `
            + `Se asignará como lavador en su lugar.`
          );
          esPulidor = false;
        } else {
          fijoPorAgencia.set(agenciaId, cedula || nombre);
        }
      }
      const rol = esPulidor ? 'pulidor' : 'lavador';
      const email = makeEmail(nombre, rol, cedula, claimedEmails);
      const { name, lastname } = splitNombre(nombre);
      const servicioIds = esPulidor ? especialIds : [];
      const existing = await prisma.user.findUnique({ where: { email } });
      const dataUser = {
        email,
        name,
        lastname,
        roleId: esPulidor ? rolePulidor.id : roleLavador.id,
        agenciaId,
        regionId: esPulidor ? regionId : null,
        servicioIds: servicioIds as unknown as Prisma.InputJsonValue,
        estado: 1,
      };
      // Solo un usuario nuevo recibe la contraseña inicial; a los existentes no se les toca.
      const user = existing
        ? await prisma.user.update({ where: { id: existing.id }, data: dataUser })
        : await prisma.user.create({ data: { ...dataUser, passwordHash } });
      if (cedula) assignedCedulas.add(cedula);
      if (esPulidor) pulidoresFijos += 1;
      else lavadores += 1;
    }
  }

  for (const p of data.pulidoresExcel) {
    if (assignedCedulas.has(p.cedula)) continue;
    const nombre = (p.nombre || '').trim();
    if (!nombre) continue;
    const email = makeEmail(nombre, 'pulidor', p.cedula, claimedEmails);
    const { name, lastname } = splitNombre(nombre);
    const regionId = regionIds.get(p.region) || regionIds.get('Sierra')!;
    const existing = await prisma.user.findUnique({ where: { email } });
    const dataUser = {
      email,
      name,
      lastname,
      roleId: rolePulidor.id,
      agenciaId: null,
      regionId,
      servicioIds: especialIds as unknown as Prisma.InputJsonValue,
      estado: 1,
    };
    if (existing) await prisma.user.update({ where: { id: existing.id }, data: dataUser });
    else await prisma.user.create({ data: { ...dataUser, passwordHash } });
    assignedCedulas.add(p.cedula);
    pulidoresMoviles += 1;
  }

  // ── Personal de gestión (hoja «PERSONAL GESTION» del Excel): líderes, aprobadores, supervisores y coordinadores.
  const ROLES_GESTION = new Set([
    'APROBADOR', 'LIDER', 'SUPERVISOR', 'JEFE_COMERCIAL', 'COORD_COMERCIAL', 'COORD_SERVICIOS_ESPECIALES',
    'COORD_MANTENIMIENTO', 'TECNICO', 'COORD_BODEGA', 'ASISTENTE_BODEGA',
  ]);
  const NECESITA_AGENCIA = new Set(['APROBADOR', 'LIDER']);
  const NECESITA_REGION = new Set(['SUPERVISOR', 'COORD_COMERCIAL']);
  const rolesGestion = new Map((await prisma.role.findMany({ where: { namerol: { in: [...ROLES_GESTION] } } })).map((r) => [r.namerol, r.id]));
  const regionesBd = await prisma.region.findMany({ select: { id: true, nombre: true } });
  const bodegasBd = await prisma.bodega.findMany({ select: { id: true, nombre: true } });
  const problemasGestion: string[] = [];
  const gestionPorRol = new Map<string, number>();
  for (const [i, p] of (data.personalGestion || []).entries()) {
    const fila = `fila ${i + 2} (${p.nombre})`;
    if (!ROLES_GESTION.has(p.rol) || !rolesGestion.has(p.rol)) {
      problemasGestion.push(`${fila}: el rol «${p.rol}» no es un rol de gestión válido`);
      continue;
    }
    const agenciaId = p.agencia ? agenciaIds.get(normKey(p.agencia)) : undefined;
    const region = p.region ? regionesBd.find((r) => normKey(r.nombre) === normKey(p.region)) : undefined;
    const bodega = p.bodega ? bodegasBd.find((b) => normKey(b.nombre) === normKey(p.bodega)) : undefined;
    if (NECESITA_AGENCIA.has(p.rol) && !agenciaId) {
      problemasGestion.push(`${fila}: el rol ${p.rol} necesita una agencia que exista (${p.agencia || 'vacía'})`);
      continue;
    }
    if (NECESITA_REGION.has(p.rol) && !region) {
      problemasGestion.push(`${fila}: el rol ${p.rol} necesita una región que exista (${p.region || 'vacía'})`);
      continue;
    }
    if (p.rol === 'ASISTENTE_BODEGA' && !bodega) {
      problemasGestion.push(`${fila}: el asistente de bodega necesita una bodega que exista (${p.bodega || 'vacía'})`);
      continue;
    }
    // El login busca el correo en minúsculas: uno guardado con mayúsculas o espacios nunca podría iniciar sesión.
    const email = p.correo?.trim().toLowerCase() || makeEmail(p.nombre, p.rol, p.cedula, claimedEmails);
    claimedEmails.add(email);
    const { name, lastname } = splitNombre(p.nombre);
    const existente = await prisma.user.findUnique({ where: { email } });
    const dataGestion = {
      email,
      name,
      lastname,
      roleId: rolesGestion.get(p.rol)!,
      agenciaId: NECESITA_AGENCIA.has(p.rol) ? agenciaId! : null,
      regionId: NECESITA_REGION.has(p.rol) ? region!.id : null,
      bodegaId: p.rol === 'ASISTENTE_BODEGA' ? bodega!.id : null,
      estado: 1,
    };
    if (existente) await prisma.user.update({ where: { id: existente.id }, data: dataGestion });
    else await prisma.user.create({ data: { ...dataGestion, passwordHash } });
    gestionPorRol.set(p.rol, (gestionPorRol.get(p.rol) || 0) + 1);
  }

  let stockAgencia = 0;
  for (const ag of data.agencias) {
    const agenciaId = agenciaIds.get(normKey(ag.nombre));
    if (!agenciaId) continue;
    const row = await prisma.agencia.findUnique({ where: { id: agenciaId }, select: { servicioIds: true } });
    const ids = Array.isArray(row?.servicioIds) ? (row!.servicioIds as number[]).map(Number).filter((n) => n > 0) : [];
    stockAgencia += await syncStockAgencia(agenciaId, ids, emisor.id);
  }

  const pulidores = await prisma.user.findMany({
    where: { roleId: rolePulidor.id, estado: 1 },
    select: { id: true, servicioIds: true },
  });
  let stockPulidor = 0;
  for (const p of pulidores) {
    const ids = Array.isArray(p.servicioIds) ? (p.servicioIds as number[]).map(Number).filter((n) => n > 0) : especialIds;
    stockPulidor += await syncStockPulidor(p.id, ids.length ? ids : especialIds, emisor.id);
  }

  console.log('=====================================================');
  console.log('✅ Importación de datos de agencias completada');
  console.log(`👤 Clientes:            ${clienteIds.size}`);
  console.log(`🏢 Agencias:            ${agenciaIds.size}`);
  console.log(`🚿 Bahías upsert:       ${bahiasCreadas}`);
  console.log(`🧼 Catálogo servicios:  ${catalogoIds.size} (especiales ${especialIds.length})`);
  console.log(`🧴 Insumos:             ${data.insumos.length}`);
  console.log(`👷 Lavadores:           ${lavadores}`);
  console.log(`✨ Pulidores fijos:     ${pulidoresFijos}`);
  console.log(`🚐 Pulidores móviles:   ${pulidoresMoviles}`);
  console.log(`⏭  Personal duplicado:  ${usuariosOmitidos}`);
  console.log(`📦 Stock agencia (0):   ${stockAgencia} slots nuevos`);
  console.log(`🧰 Stock pulidor (0):   ${stockPulidor} slots nuevos`);
  if (gestionPorRol.size || problemasGestion.length) {
    console.log(`🧑‍💼 Personal de gestión:  ${[...gestionPorRol.entries()].map(([r, n]) => `${r} ${n}`).join(', ') || 'ninguno'}`);
  }
  console.log('🔑 Los usuarios nuevos usan la contraseña de IMPORT_PASSWORD_INICIAL; solo un administrador puede cambiarla después (los existentes conservan la suya).');
  console.log('   Correo: {nombre}.{rol}@easydry.com, o el de la hoja de personal si lo trae.');
  if (problemasGestion.length) {
    console.log(`⚠ Personal de gestión no cargado (${problemasGestion.length}): corrige el Excel y vuelve a importar`);
    for (const linea of problemasGestion) console.log('   -', linea);
  }
  if (unmatchedServicios.length) {
    console.log(`⚠ Servicios de agencia sin match en catálogo (${unmatchedServicios.length}):`);
    for (const line of unmatchedServicios.slice(0, 20)) console.log('   -', line);
  }
  console.log('=====================================================');
}

/**
 * La importación escribe directo en la base, sin pasar por los servicios que borran la caché. Si hay Redis (REDIS_URL), se borran las
 * copias de usuarios y paneles para que lo importado se vea de inmediato y no al vencer. Si Redis no responde no se interrumpe nada:
 * la caché vence sola en segundos.
 */
async function limpiarCache(): Promise<void> {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return;
  const prefijo = process.env.REDIS_PREFIX?.trim() || 'easydry';
  const redis = new Redis(url, { enableOfflineQueue: false, maxRetriesPerRequest: 1, connectTimeout: 2000, retryStrategy: () => null });
  redis.on('error', () => undefined);
  try {
    let borradas = 0;
    for (const grupo of ['auth:user:', 'analytics:']) {
      let cursor = '0';
      do {
        const [siguiente, claves] = await redis.scan(cursor, 'MATCH', `${prefijo}:${grupo}*`, 'COUNT', 500);
        cursor = siguiente;
        if (claves.length) borradas += await redis.unlink(...claves);
      } while (cursor !== '0');
    }
    console.log(`🧹 Caché de Redis limpiada (${borradas} claves de usuarios y paneles).`);
  } catch (e) {
    console.log(`ℹ No se pudo limpiar la caché de Redis (${(e as Error).message}): vence sola en unos segundos.`);
  } finally {
    redis.disconnect();
  }
}

main()
  .then(limpiarCache)
  .catch((e) => {
    console.error('❌ Error importando datos de agencias:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
