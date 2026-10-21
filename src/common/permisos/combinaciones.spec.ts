import { describe, expect, it } from 'vitest';
import { PAGINAS, capacidadesDesdeNuevos } from './catalogo-paginas.js';

/**
 * Matriz de las 4 páginas de «Activos y Taller»: para cada casilla, qué permisos necesita la PANTALLA para funcionar
 * cuando esa casilla es lo único marcado (más su página y su sección, que son obligatorias).
 *
 * Sale de revisar, pantalla por pantalla, lo que pide al servidor cada flujo:
 *  - listados de apoyo (agencias, usuarios, insumos, bodegas) que alimentan los desplegables,
 *  - la lectura del módulo, que las pestañas necesitan para pintar,
 *  - la evidencia, que va incluida en la casilla del flujo.
 *
 * Si una casilla no entrega lo que su pantalla pide, el rol queda con un botón que abre una pantalla vacía o que
 * responde 403: marcarla no sirve de nada. Esta prueba lo detecta.
 */
const REQUISITOS: Record<string, string[]> = {
  // ── Maquinaria & Equipos ────────────────────────────────────────────────
  'maquinaria.ver': [],
  // La ficha abre con «Ver equipos»; la pestaña de trazabilidad pide su propia casilla.
  'maquinaria.trazabilidad.ver': ['maquinaria.ver'],
  // El formulario de alta elige sucursal (agencias/list exige agencias.ver).
  'maquinaria.crear': ['maquinaria.ver', 'agencias.ver'],
  'maquinaria.editar': ['maquinaria.ver'],
  // Cambiar foto o ficha usa el mismo endpoint que editar, pero NO exige la casilla de editar datos.
  'maquinaria.archivos': ['maquinaria.ver'],
  // Transferir elige origen/destino entre agencias y bahías.
  'maquinaria.trasladar': ['maquinaria.ver', 'agencias.ver'],
  // Asignar responsable lista usuarios (agencias/usuarios/list exige usuarios.ver).
  'maquinaria.responsable': ['maquinaria.ver', 'usuarios.ver'],

  // ── Taller Técnico ──────────────────────────────────────────────────────
  'taller.incidentes.reportar': ['incidentes.ver', 'maquinaria.evidencias'],
  // Asignar técnico lista usuarios.
  'taller.incidentes.asignar': ['incidentes.ver', 'usuarios.ver'],
  'taller.incidentes.resolver': ['incidentes.ver', 'maquinaria.evidencias'],
  'taller.incidentes.cancelar': ['incidentes.ver'],
  // Programar elige máquina y técnico.
  'taller.mantenimientos.programar': ['mantenimientos.ver', 'usuarios.ver'],
  'taller.mantenimientos.ejecutar': ['mantenimientos.ver', 'maquinaria.evidencias'],
  'taller.mantenimientos.editar': ['mantenimientos.ver'],
  'taller.limpiezas.registrar': ['limpiezas.ver'],
  'taller.limpiezas.editar': ['limpiezas.ver'],
  // Exportar limpìezas necesita ver el historial.
  'reportes.maquinaria.limpiezas': ['limpiezas.ver'],

  // ── Inventario & Suministros ────────────────────────────────────────────
  'inventario.productos.gestionar': ['inventario.ver'],
  'inventario.productos.compra': ['inventario.ver'],
  // Despachar necesita el insumo, el destino (usuarios para pulidores) y el permiso de despacho.
  'inventario.despachar': ['inventario.ver', 'despachos.crear', 'usuarios.ver'],
  'inventario.reajustar': ['inventario.ver'],
  'inventario.bodegas.gestionar': ['inventario.ver'],
  'inventario.bodegas.estado': ['inventario.ver'],
  'inventario.bodegas.eliminar': ['inventario.ver'],
  // Las alertas se leen con la sección; crear o atender es la casilla.
  'inventario.alertas.crear': ['alertas.ver', 'inventario.ver'],
  'inventario.alertas.atender': ['alertas.ver', 'inventario.ver'],
  'inventario.config.tipos': ['inventario.ver'],
  'inventario.config.unidades': ['inventario.ver'],

  // ── Envíos & Confirmación ───────────────────────────────────────────────
  // Crear un envío arma la lista de insumos y bodegas (inventario), elige agencia y pulidor.
  'envios.crear': ['despachos.ver', 'despachos.crear', 'usuarios.ver', 'agencias.ver'],
  'envios.confirmar': ['despachos.ver', 'despachos.recibir'],
  'envios.rechazar': ['despachos.ver', 'despachos.recibir'],
  'envios.faltantes': ['despachos.ver'],
};

const PAGINAS_ACTIVOS = ['maquinaria', 'taller', 'inventario', 'envios'];

/** Página y sección donde vive cada casilla. */
function ubicaciones(codigo: string) {
  const todas: { pagina: (typeof PAGINAS)[number]; sub: (typeof PAGINAS)[number]['subs'][number] | null }[] = [];
  for (const p of PAGINAS) {
    if (p.acciones.some((a) => a.codigo === codigo)) todas.push({ pagina: p, sub: null });
    for (const s of p.subs) if (s.acciones.some((a) => a.codigo === codigo)) todas.push({ pagina: p, sub: s });
  }
  return todas;
}

/** Donde la casilla vive de verdad; las compartidas (reportar, programar, limpieza) se evalúan en su sección de Taller. */
function ubicacion(codigo: string) {
  const todas = ubicaciones(codigo);
  return todas.find((u) => u.sub) ?? todas[0] ?? null;
}

describe('combinaciones operativas de Activos y Taller', () => {
  it('toda casilla de las 4 páginas está clasificada (con o sin requisitos)', () => {
    const sinClasificar: string[] = [];
    for (const p of PAGINAS.filter((x) => PAGINAS_ACTIVOS.includes(x.id))) {
      for (const a of [...p.acciones, ...p.subs.flatMap((s) => s.acciones)]) {
        // Las casillas compartidas se encienden desde varias secciones; su requisito lo fija la sección.
        if (a.compartida) continue;
        if (!(a.codigo in REQUISITOS)) sinClasificar.push(a.codigo);
      }
    }
    expect(sinClasificar, 'casillas nuevas: añádelas a REQUISITOS con lo que su pantalla necesita').toEqual([]);
  });

  it('marcar una casilla sola deja la pantalla en condiciones de funcionar', () => {
    const cojas: string[] = [];
    for (const [codigo, requisitos] of Object.entries(REQUISITOS)) {
      const u = ubicacion(codigo);
      expect(u, `${codigo} no existe en el catálogo`).not.toBeNull();
      const marcados = [u!.pagina.codigo, ...(u!.sub ? [u!.sub.codigo] : []), codigo];
      const otorgados = new Set(capacidadesDesdeNuevos(marcados));
      const faltan = requisitos.filter((r) => !otorgados.has(r));
      if (faltan.length) cojas.push(`${codigo} no entrega ${faltan.join(', ')}`);
    }
    expect(cojas, 'casillas que dejan su pantalla sin lo que necesita').toEqual([]);
  });

  it('las casillas compartidas, marcadas desde Maquinaria, también entregan la lectura de la máquina', () => {
    const maquinaria = PAGINAS.find((p) => p.id === 'maquinaria')!;
    for (const codigo of ['taller.incidentes.reportar', 'taller.mantenimientos.programar', 'taller.limpiezas.registrar']) {
      expect(maquinaria.acciones.some((a) => a.codigo === codigo), `${codigo} falta en Maquinaria`).toBe(true);
      const otorgados = new Set(capacidadesDesdeNuevos([maquinaria.codigo, codigo]));
      expect(otorgados.has('maquinaria.ver'), `${codigo} desde Maquinaria no entrega maquinaria.ver`).toBe(true);
    }
  });

  it('sin marcar nada, las 4 páginas no entregan ni un permiso de contenido', () => {
    // El menú encendido no da datos: cada sección y cada acción se marcan aparte.
    for (const id of PAGINAS_ACTIVOS) {
      const p = PAGINAS.find((x) => x.id === id)!;
      const entregados = capacidadesDesdeNuevos([p.codigo]).filter((c) => !c.startsWith('pagina.'));
      // Solo quedan los datos de apoyo de la propia página (agencias, catálogo…), nunca la lectura del módulo.
      expect(entregados, `${id} entrega contenido sin casillas`).not.toContain('inventario.ver');
      const lectura = p.lectura ?? [];
      expect(entregados.filter((c) => lectura.includes(c)), `${id} entrega su lectura sin casillas`).toEqual([]);
    }
  });
});
