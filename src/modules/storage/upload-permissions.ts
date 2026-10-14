import { ForbiddenException } from '@nestjs/common';
import { tieneAlgunPermiso, tienePermiso } from '../../common/permisos/capacidades.js';
import type { GenerateUploadTicketDto } from './storage.service.js';

const PERMISOS_SUBIDA_GENERAL = [
  'evidencias.subir',
  'maquinaria.evidencias',
  'stock.ajustar',
  'compras.registrar',
  'inventario.catalogos.gestionar',
] as const;

export function exigirPermisoSubida(user: any, dto: Pick<GenerateUploadTicketDto, 'category' | 'type'>): void {
  if (dto.type === 'FOTO_PERFIL' || dto.category === 'PERFIL_USUARIO') return;

  // Evidencias de un envío (recepción, rechazo o resolución de faltantes): quien confirma, rechaza o resuelve.
  if (dto.type === 'FOTO_ENVIO' || dto.category === 'INVENTARIO_ENVIOS') {
    if (!tieneAlgunPermiso(user, ['envios.confirmar', 'envios.rechazar', 'envios.faltantes'])) {
      throw new ForbiddenException('Tu rol no puede subir evidencias de envíos.');
    }
    return;
  }

  // Evidencias de auditorías: quien hace informes o auditorías 5S, o da seguimiento a sus planes y acciones correctivas.
  if (dto.type === 'FOTO_AUDITORIA' || dto.category === 'AUDITORIAS') {
    if (!tieneAlgunPermiso(user, ['informes.crear', 'informes.seguimiento', 'inspecciones.crear', 'inspecciones.acciones'])) {
      throw new ForbiddenException('Tu rol no puede subir evidencias de auditorías.');
    }
    return;
  }

  const limpieza = dto.category === 'MAQUINARIA_LIMPIEZA' || dto.type === 'FOTO_LIMPIEZA';
  if (limpieza) {
    if (!tienePermiso(user, 'limpiezas.evidencias')) {
      throw new ForbiddenException('Tu rol no puede subir evidencias de limpieza.');
    }
    return;
  }

  const evidenciaTrabajoMaquinaria = dto.category === 'MAQUINARIA_INCIDENTE'
    || dto.category === 'MAQUINARIA_MANTENIMIENTO'
    || dto.type === 'FOTO_INCIDENTE'
    || dto.type === 'VIDEO_INCIDENTE'
    || dto.type === 'DOCUMENTO_INCIDENTE';
  if (evidenciaTrabajoMaquinaria) {
    if (!tienePermiso(user, 'maquinaria.evidencias')) {
      throw new ForbiddenException('Tu rol no puede subir evidencias de incidencias o mantenimiento.');
    }
    return;
  }

  if (!tieneAlgunPermiso(user, PERMISOS_SUBIDA_GENERAL)) {
    throw new ForbiddenException('Tu rol no puede subir archivos.');
  }
}
