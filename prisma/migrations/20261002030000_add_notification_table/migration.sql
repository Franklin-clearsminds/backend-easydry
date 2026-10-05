-- Sistema de notificaciones real (reemplaza el actual, que es sintético en el frontend y push
-- efímero sin persistencia): tabla propia por usuario + tipo cerrado de 8 eventos de negocio.
-- `entidadTipo`/`entidadId` van como columnas propias (no dentro de `data`) porque, junto con
-- `tipo`, el índice de abajo resuelve "una sola vez por episodio" para la escalación de limpieza
-- atrasada sin necesitar una tabla de estado adicional.
CREATE TYPE "TipoNotificacion" AS ENUM (
    'INCIDENTE_NUEVO',
    'INCIDENCIA_ASIGNADA',
    'MANTENIMIENTO_ASIGNADO',
    'INCIDENCIA_RESUELTA',
    'MANTENIMIENTO_VENCIDO',
    'STOCK_CRITICO',
    'APROBACION_PENDIENTE',
    'DESPACHO_PENDIENTE',
    'LIMPIEZA_RECORDATORIO',
    'LIMPIEZA_ATRASADA'
);

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tipo" "TipoNotificacion" NOT NULL,
    "titulo" TEXT NOT NULL,
    "mensaje" TEXT NOT NULL,
    "data" JSONB,
    "entidadTipo" TEXT,
    "entidadId" TEXT,
    "leida" BOOLEAN NOT NULL DEFAULT false,
    "leidaEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Notification_userId_leida_idx" ON "Notification"("userId", "leida");
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
CREATE INDEX "Notification_tipo_entidadId_idx" ON "Notification"("tipo", "entidadId");

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
