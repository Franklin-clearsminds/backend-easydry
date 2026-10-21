/**
 * Banderas de acciones que la web y la app usan hoy para mostrar u ocultar botones (login → `acciones`). Se calculan a partir
 * de los permisos del rol, así siguen exactamente lo que el backend exige. Cuando la web use directamente los permisos, este
 * archivo se elimina.
 */
export interface AccionesLegacy {
  verTodasSucursales: boolean;
  crearSucursal: boolean;
  editarSucursal: boolean;
  crearUsuarios: boolean;
  asignarRoles: boolean;
  verOtrosSucursales: boolean;
  cambiarSucursalOperador: boolean;
  cambiarBahiaOperador: boolean;
  aprobarServicios: boolean;
  rechazarServicios: boolean;
  registrarServicio: boolean;
  verTodosServicios: boolean;
  verMaquinaria: boolean;
  gestionarMantenimiento: boolean;
  registrarIncidente: boolean;
  verReportes: boolean;
  verProductividadGlobal: boolean;
  verConfiguracion: boolean;
  gestionarInventario: boolean;
  despacharSuministros: boolean;
  accionesEnvios: boolean;
}

export function accionesLegacy(capacidades: readonly string[], ambito: string): AccionesLegacy {
  const tiene = (...c: string[]) => c.some((x) => capacidades.includes(x));
  const global = ambito === 'GLOBAL';
  return {
    verTodasSucursales: global && tiene('agencias.ver'),
    crearSucursal: tiene('agencias.crear'),
    editarSucursal: tiene('agencias.editar'),
    crearUsuarios: tiene('usuarios.gestionar'),
    asignarRoles: tiene('roles.gestionar'),
    verOtrosSucursales: tiene('agencias.ver') && ambito !== 'AGENCIA' && ambito !== 'PROPIO',
    cambiarSucursalOperador: tiene('operadores.gestionar'),
    cambiarBahiaOperador: tiene('bahias.asignar'),
    aprobarServicios: tiene('servicios.decidir'),
    rechazarServicios: tiene('servicios.decidir'),
    registrarServicio: tiene('servicios.crear', 'especiales.crear'),
    verTodosServicios: tiene('servicios.ver'),
    verMaquinaria: tiene('maquinaria.ver'),
    gestionarMantenimiento: tiene('maquinaria.gestionar', 'mantenimientos.ejecutar'),
    registrarIncidente: tiene('incidentes.reportar'),
    verReportes: tiene('dashboard.ver', 'productividad.ver'),
    verProductividadGlobal: tiene('productividad.ver') && global,
    verConfiguracion: tiene('catalogo.gestionar'),
    gestionarInventario: tiene('stock.ajustar', 'inventario.catalogos.gestionar', 'compras.registrar'),
    despacharSuministros: tiene('despachos.crear'),
    accionesEnvios: tiene('despachos.recibir'),
  };
}
