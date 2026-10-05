-- Quién aprobó, rechazó o anuló un servicio, con qué regla y por qué (aditivo)
ALTER TABLE "ServicioLavado" ADD COLUMN "decididoPorId" TEXT;
ALTER TABLE "ServicioLavado" ADD COLUMN "reglaDecision" TEXT;
ALTER TABLE "ServicioLavado" ADD COLUMN "anuladoPorId" TEXT;
ALTER TABLE "ServicioLavado" ADD COLUMN "anuladoEn" TIMESTAMP(3);
ALTER TABLE "ServicioLavado" ADD COLUMN "motivoAnulacion" TEXT;

CREATE TABLE "auditoria_decisiones" (
    "id" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidadId" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "usuarioNombre" TEXT NOT NULL,
    "rol" TEXT NOT NULL,
    "regla" TEXT NOT NULL,
    "motivo" TEXT,
    "agenciaId" TEXT,
    "detalle" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_decisiones_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "auditoria_decisiones_entidad_entidadId_idx" ON "auditoria_decisiones"("entidad", "entidadId");
CREATE INDEX "auditoria_decisiones_usuarioId_idx" ON "auditoria_decisiones"("usuarioId");
CREATE INDEX "auditoria_decisiones_agenciaId_idx" ON "auditoria_decisiones"("agenciaId");
CREATE INDEX "auditoria_decisiones_createdAt_idx" ON "auditoria_decisiones"("createdAt");
