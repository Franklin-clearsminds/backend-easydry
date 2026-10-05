CREATE TABLE "Reto" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT,
    "premio" TEXT,
    "fechaInicio" DATE NOT NULL,
    "fechaFin" DATE NOT NULL,
    "regiones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "marcas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sucursalesIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "creadoPorId" TEXT,
    "creadorNombre" TEXT,
    "creadorRol" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'ACTIVO',
    "criterios" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Reto_estado_idx" ON "Reto"("estado");
CREATE INDEX "Reto_fechaInicio_fechaFin_idx" ON "Reto"("fechaInicio", "fechaFin");
