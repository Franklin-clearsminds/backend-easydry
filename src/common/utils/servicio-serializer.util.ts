/**
 * Helper de serialización denormalizada para Servicios de Lavado.
 * Garantiza compatibilidad 1-a-1 con los templates de Angular 19 (frontend-easy-dry)
 * y componentes React Native (app-easy-dry), evitando campos undefined o errores de renderizado.
 */
export function serializeServicioLavado(s: any): any {
  if (!s) return null;

  const operadoresAsignados = Array.isArray(s.operadoresAsignados)
    ? s.operadoresAsignados
        .map((asignacion: any) => asignacion.operador)
        .filter(Boolean)
        .map((operador: any) => ({
          id: String(operador.id),
          nombre: `${operador.name || ''} ${operador.lastname || ''}`.trim(),
        }))
    : [];
  const operadorNombre = operadoresAsignados.length
    ? operadoresAsignados.map((operador: any) => operador.nombre).join(', ')
    : s.operador
      ? `${s.operador.name || ''} ${s.operador.lastname || ''}`.trim()
      : s.operadorNombre || '';

  const bahiaNombre = s.bahia?.nombre || s.bahiaNombre || '';
  const bahiaCodigo = s.bahia?.codigo || s.bahiaCodigo || '';
  const agenciaNombre = s.bahia?.agencia?.nombre || s.agenciaNombre || s.sucursalNombre || '';
  const servicioNombre = s.catalogo?.nombre || s.servicioNombre || 'Lavado General';
  let ordenTrabajoOT = s.ordenTrabajoOT;
  if (!ordenTrabajoOT && (s.fotoIngresoUrl || s.fotoSalidaUrl)) {
    const match = (s.fotoIngresoUrl || s.fotoSalidaUrl).match(/\/servicios\/(?:generales|especiales)\/([^/]+)\//i);
    if (match && match[1] && match[1] !== 'sin-orden') {
      ordenTrabajoOT = match[1].toUpperCase();
    }
  }
  if (!ordenTrabajoOT) {
    ordenTrabajoOT = s.id ? `OT-${s.id.substring(0, 6).toUpperCase()}` : '';
  }
  const marca = s.marca || (s.modelo ? s.modelo.split(' ')[0] : 'General');
  const isVideoUrl = (value: unknown): value is string => {
    if (typeof value !== 'string') return false;
    const clean = value.split('?')[0].toLowerCase();
    return /\.(mp4|mov|m4v|webm)$/.test(clean) || clean.includes('/videos/');
  };
  const safeMediaUrl = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? value : null;
  const rawFotoIngreso = safeMediaUrl(s.fotoIngresoUrl);
  const rawFotoSalida = safeMediaUrl(s.fotoSalidaUrl);
  const fotoIngresoUrl = isVideoUrl(rawFotoIngreso) ? null : rawFotoIngreso;
  const fotoSalidaUrl = isVideoUrl(rawFotoSalida) ? null : rawFotoSalida;
  const videoInicialUrl = safeMediaUrl(s.videoInicialUrl)
    || safeMediaUrl(s.videoInicial)
    || (isVideoUrl(rawFotoIngreso) ? rawFotoIngreso : null);
  const videoFinalUrl = safeMediaUrl(s.videoFinalUrl)
    || safeMediaUrl(s.videoFinal)
    || (isVideoUrl(rawFotoSalida) ? rawFotoSalida : null);

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

  // Cálculo de duración del servicio general
  let duracionMinutos: number | null = null;
  let duracionFormateada = '';
  if (fechaIngresoStr) {
    const tIngreso = new Date(fechaIngresoStr).getTime();
    if (fechaSalidaStr) {
      const tSalida = new Date(fechaSalidaStr).getTime();
      duracionMinutos = Math.max(0, Math.round((tSalida - tIngreso) / 60000));
      const horas = Math.floor(duracionMinutos / 60);
      const mins = duracionMinutos % 60;
      duracionFormateada = horas > 0 ? `${horas}h ${mins}min` : `${mins} min`;
    } else if (String(s.estado || '').toUpperCase() === 'EN_PROCESO' || String(s.estado || '').toUpperCase() === 'INICIADO') {
      duracionMinutos = Math.max(0, Math.round((Date.now() - tIngreso) / 60000));
      const horas = Math.floor(duracionMinutos / 60);
      const mins = duracionMinutos % 60;
      duracionFormateada = horas > 0 ? `${horas}h ${mins}min` : `${mins} min`;
    }
  }

  return {
    id: s.id,
    clientUuid: s.clientUuid || s.id,
    ordenTrabajoOT,
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
    operadoresAsignados,
    servicioNombre,
    servicio: servicioNombre,
    categoriaServicio: s.catalogo?.categoria || s.categoriaServicio || 'GENERAL',
    tiempoEstimadoMin: Number(s.catalogo?.tiempoEstimadoMin ?? s.tiempoEstimadoMin ?? 30),
    precio: s.precio != null ? Number(s.precio) : null,

    // Tiempos y Fechas
    fecha: fechaIngresoStr.split('T')[0],
    horaIngreso: fechaIngresoStr,
    horaSalida: fechaSalidaStr,
    duracionMinutos,
    duracionFormateada,

    // Multimedia
    fotoIngresoUrl,
    fotoSalidaUrl,
    foto: fotoSalidaUrl || fotoIngresoUrl,
    video: videoFinalUrl || videoInicialUrl,
    videoUrl: videoFinalUrl || videoInicialUrl,
    videoInicialUrl,
    videoFinalUrl,

    // Observaciones y Notas
    observaciones: s.observaciones || null,
    notas: s.observaciones || null,

    // Gobernanza y Aprobación Gerencial (Cierre Diario)
    observacionGerente: s.observacionGerente || null,
    aprobadoPor: s.aprobadoPor || null,
    fechaAprobacion: fechaAprobacionStr,
    motivoRechazo: s.motivoRechazo || null,
    // Quién decidió y con qué regla (TITULAR = aprobador de la agencia, RESPALDO = agencia sin aprobador), y la anulación
    decididoPorId: s.decididoPorId || null,
    reglaDecision: s.reglaDecision || null,
    anuladoPorId: s.anuladoPorId || null,
    anuladoEn: s.anuladoEn ? (s.anuladoEn instanceof Date ? s.anuladoEn.toISOString() : String(s.anuladoEn)) : null,
    motivoAnulacion: s.motivoAnulacion || null,
    agenciaId: s.bahia?.agencia?.id || s.bahia?.agenciaId || s.agenciaId || null,

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
