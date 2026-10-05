-- 6 eventos nuevos de notificación (decisión de servicio general, servicio especial asignado/cerrado,
-- cierre de reto, máquina dada de baja, cambio de usuario, despacho confirmado/rechazado).
ALTER TYPE "TipoNotificacion" ADD VALUE 'SERVICIO_DECIDIDO';
ALTER TYPE "TipoNotificacion" ADD VALUE 'SERVICIO_ESPECIAL_ASIGNADO';
ALTER TYPE "TipoNotificacion" ADD VALUE 'SERVICIO_ESPECIAL_CERRADO';
ALTER TYPE "TipoNotificacion" ADD VALUE 'RETO_CERRADO';
ALTER TYPE "TipoNotificacion" ADD VALUE 'MAQUINA_DADA_DE_BAJA';
ALTER TYPE "TipoNotificacion" ADD VALUE 'USUARIO_ACTUALIZADO';
ALTER TYPE "TipoNotificacion" ADD VALUE 'DESPACHO_CONFIRMADO';
