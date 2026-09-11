/**
 * Helper de serialización denormalizada para Servicios de Lavado.
 * Garantiza compatibilidad 1-a-1 con los templates de Angular 19 (frontend-easy-dry)
 * y componentes React Native (app-easy-dry), evitando campos undefined o errores de renderizado.
 */
export function serializeServicioLavado(s: any): any {
  if (!s) return null;

  const operadorNombre = s.operador
    ? `${s.operador.name || ''} ${s.operador.lastname || ''}`.trim()
    : s.operadorNombre || '';

  const bahiaNombre = s.bahia?.nombre || s.bahiaNombre || '';
  const bahiaCodigo = s.bahia?.codigo || s.bahiaCodigo || '';
  const agenciaNombre = s.bahia?.agencia?.nombre || s.agenciaNombre || s.sucursalNombre || '';
  const servicioNombre = s.catalogo?.nombre || s.servicioNombre || 'Lavado General';
  const ordenTrabajoOT = s.ordenTrabajoOT || (s.id ? `OT-${s.id.substring(0, 6).toUpperCase()}` : 'OT-9800');
  const numeroOrden = s.numeroOrden || ordenTrabajoOT;
  const marca = s.marca || (s.modelo ? s.modelo.split(' ')[0] : 'General');

  const fechaIngresoStr = s.horaIngreso
    ? (s.horaIngreso instanceof Date ? s.horaIngreso.toISOString() : String(s.horaIngreso))
    : (s.createdAt instanceof Date ? s.createdAt.toISOString() : new Date().toISOString());

  const fechaSalidaStr = s.horaSalida
    ? (s.horaSalida instanceof Date ? s.horaSalida.toISOString() : String(s.horaSalida))
    : (s.estado === 'FINALIZADO' || s.estado === 'APROBADO' ? new Date().toISOString() : null);

  const fechaAprobacionStr = s.fechaAprobacion
    ? (s.fechaAprobacion instanceof Date ? s.fechaAprobacion.toISOString() : String(s.fechaAprobacion))
    : null;

  const deletedAtStr = s.deletedAt
    ? (s.deletedAt instanceof Date ? s.deletedAt.toISOString() : String(s.deletedAt))
    : null;

  return {
    id: s.id,
    clientUuid: s.clientUuid || s.id,
    ordenTrabajoOT,
    numeroOrden,
    placa: s.placa || '',
    marca,
    modelo: s.modelo || '',
    color: s.color || '',
    cliente: s.cliente || '',
    estado: s.estado || 'EN_ESPERA',
    
    // Nombres directos denormalizados para templates de Angular / React Native
    bahiaNombre,
    bahiaCodigo,
    agenciaNombre,
    sucursalNombre: agenciaNombre,
    agencia: agenciaNombre,
    bahia: bahiaNombre,
    operadorNombre,
    empleado: operadorNombre,
    servicioNombre,
    servicio: servicioNombre,
    categoriaServicio: s.catalogo?.categoria || s.categoriaServicio || 'GENERAL',

    // Tiempos y Fechas
    fecha: fechaIngresoStr.split('T')[0],
    horaIngreso: fechaIngresoStr,
    horaSalida: fechaSalidaStr,

    // Multimedia
    fotoIngresoUrl: s.fotoIngresoUrl || null,
    fotoSalidaUrl: s.fotoSalidaUrl || null,
    foto: s.fotoSalidaUrl || s.fotoIngresoUrl || null,
    video: s.videoUrl || null,
    videoUrl: s.videoUrl || null,

    // Observaciones y Notas
    observaciones: s.observaciones || null,
    notas: s.observaciones || null,

    // Gobernanza y Aprobación Gerencial (Cierre Diario)
    observacionGerente: s.observacionGerente || null,
    aprobadoPor: s.aprobadoPor || null,
    fechaAprobacion: fechaAprobacionStr,
    motivoRechazo: s.motivoRechazo || null,

    // Control de Concurrencia y Sincronización
    version: s.version || 1,
    _deleted: Boolean(s.deletedAt),
    deletedAt: deletedAtStr,
    syncedAt: s.syncedAt ? (s.syncedAt instanceof Date ? s.syncedAt.toISOString() : s.syncedAt) : null,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,

    // Objetos relacionales completos preservados
    bahiaId: s.bahiaId,
    operadorId: s.operadorId,
    servicioCatalogoId: s.servicioCatalogoId,
    bahiaRel: s.bahia,
    operadorRel: s.operador,
    catalogoRel: s.catalogo,
    catalogo: s.catalogo || s.catalogoRel || null,
    operador: s.operador || s.operadorRel || null,
    consumos: s.consumos || [],
    evidencias: s.evidencias || [],
  };
}
