-- RRHH: horarios del personal (versionados, solo hacia adelante), ajuste general de timbradas y alertas de incidencias.
ALTER TYPE "TipoNotificacion" ADD VALUE IF NOT EXISTS 'HORARIO_INCIDENCIA';

CREATE TABLE "horarios_persona" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vigenteDesde" DATE NOT NULL,
    "dias" JSONB NOT NULL,
    "motivo" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "horarios_persona_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "horarios_persona_userId_vigenteDesde_idx" ON "horarios_persona"("userId", "vigenteDesde");
ALTER TABLE "horarios_persona" ADD CONSTRAINT "horarios_persona_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ajustes_horario" (
    "id" TEXT NOT NULL,
    "vigenteDesde" DATE NOT NULL,
    "toleranciaMin" INTEGER NOT NULL,
    "ventanaMin" INTEGER NOT NULL,
    "motivo" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ajustes_horario_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ajustes_horario_vigenteDesde_idx" ON "ajustes_horario"("vigenteDesde");

-- Valores iniciales desde el día de la activación (hora de Ecuador): tolerancia 10 min y ventana de 2 h. Los días anteriores quedan «sin horario».
INSERT INTO "ajustes_horario" ("id", "vigenteDesde", "toleranciaMin", "ventanaMin", "motivo", "actorId")
VALUES (gen_random_uuid()::text, (NOW() AT TIME ZONE 'America/Guayaquil')::date, 10, 120, 'Valores iniciales', 'sistema');

-- Solo ADMIN y SUPER_ADMIN gestionan horarios y el ajuste general.
UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['rrhh.horarios.gestionar']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" IN ('SUPER_ADMIN', 'ADMIN');

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['pagina.rrhh-timbradas.horarios', 'rrhh-timbradas.horarios.editar', 'rrhh-timbradas.horarios.ajustes']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" IN ('SUPER_ADMIN', 'ADMIN') AND EXISTS (SELECT 1 FROM unnest(r."capacidades") x WHERE x LIKE 'pagina.%');
