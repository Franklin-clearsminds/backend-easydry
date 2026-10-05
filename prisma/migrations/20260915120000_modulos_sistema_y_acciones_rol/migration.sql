-- Catálogo de módulos del sistema (fuente de verdad para permisos de navegación)
-- Normalize the legacy table originally created as "Role".
-- IF EXISTS keeps this safe in environments normalized manually beforehand.
ALTER TABLE IF EXISTS "Role" RENAME TO "roles";

-- The current Role model includes this field, but prior migrations omitted it.
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "descripcion" TEXT;

CREATE TABLE IF NOT EXISTS "modulos_sistema" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "icono" TEXT,
    "rutaPrincipal" TEXT,
    "grupo" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "estado" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "modulos_sistema_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "modulos_sistema_codigo_key" ON "modulos_sistema"("codigo");
CREATE INDEX IF NOT EXISTS "modulos_sistema_estado_idx" ON "modulos_sistema"("estado");
CREATE INDEX IF NOT EXISTS "modulos_sistema_grupo_idx" ON "modulos_sistema"("grupo");
CREATE INDEX IF NOT EXISTS "modulos_sistema_orden_idx" ON "modulos_sistema"("orden");

-- Acciones granulares por rol (JSON)
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "acciones" JSONB;
