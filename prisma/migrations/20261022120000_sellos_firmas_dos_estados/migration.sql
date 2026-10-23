-- Sellos de jefes de taller, firmas capturadas en pantalla y dos estados (borrador / guardado).

-- Sellos de los jefes de taller: nombre, apellido, logo (marca de agua bajo su firma) y contraseña con hash.
CREATE TABLE "sellos_jefe_taller" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "apellido" TEXT NOT NULL,
    "logo" TEXT,
    "passwordHash" TEXT NOT NULL,
    "estado" INTEGER NOT NULL DEFAULT 1,
    "intentosFallidos" INTEGER NOT NULL DEFAULT 0,
    "bloqueadoHasta" TIMESTAMP(3),
    "creadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sellos_jefe_taller_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sellos_jefe_taller_estado_idx" ON "sellos_jefe_taller"("estado");

-- El informe guarda el sello validado (con su nombre y logo de ese momento) y cuándo se guardó de forma definitiva.
ALTER TABLE "InformeInspeccion"
    ADD COLUMN "guardadoEn" TIMESTAMP(3),
    ADD COLUMN "selloId" TEXT,
    ADD COLUMN "selloNombre" TEXT,
    ADD COLUMN "selloLogo" TEXT,
    ADD COLUMN "selloValidadoEn" TIMESTAMP(3);

CREATE INDEX "InformeInspeccion_selloId_idx" ON "InformeInspeccion"("selloId");

ALTER TABLE "InformeInspeccion"
    ADD CONSTRAINT "InformeInspeccion_selloId_fkey" FOREIGN KEY ("selloId") REFERENCES "sellos_jefe_taller"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Informes de visita: solo BORRADOR y GUARDADO. Lo que ya estaba en revisión, aprobado o cerrado queda guardado; lo rechazado vuelve a borrador.
UPDATE "InformeInspeccion"
SET "estado" = 'GUARDADO', "guardadoEn" = COALESCE("cerradoEn", "aprobadoEn", "enviadoEn", "updatedAt")
WHERE "estado" IN ('EN_REVISION', 'APROBADO', 'CERRADO');

UPDATE "InformeInspeccion" SET "estado" = 'BORRADOR' WHERE "estado" = 'RECHAZADO';

-- Auditorías 5S: solo BORRADOR y GUARDADA (las finalizadas y cerradas quedan guardadas; las que estaban en proceso siguen como borrador).
UPDATE "Auditoria5s" SET "estado" = 'GUARDADA' WHERE "estado" IN ('FINALIZADA', 'CERRADA');
UPDATE "Auditoria5s" SET "estado" = 'BORRADOR' WHERE "estado" = 'EN_PROCESO';

-- «Revisar, aprobar, rechazar y cerrar» desaparece: queda «Editar y eliminar informes de otros» (informes.administrar).
UPDATE "roles"
SET "capacidades" = array_replace("capacidades", 'informes.revisar', 'informes.administrar')
WHERE 'informes.revisar' = ANY("capacidades");

-- La pantalla Configuración de Sellos es solo de Admin y Super Admin.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['pagina.sellos', 'sellos.gestionar'])),
    "permisos" = ARRAY(SELECT DISTINCT unnest("permisos" || ARRAY['configuracion/sellos']))
WHERE "namerol" IN ('ADMIN', 'SUPER_ADMIN');

-- Módulo del menú para la nueva pantalla.
INSERT INTO "modulos_sistema" ("id", "codigo", "nombre", "descripcion", "icono", "rutaPrincipal", "grupo", "disponibleEnApp", "orden", "estado", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'configuracion/sellos', 'Configuración de Sellos', 'Sellos de los jefes de taller: nombre, logo como marca de agua y contraseña de la firma', 'pen-tool', '/configuracion-sellos', 'Auditorías', false, 148, 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "modulos_sistema" WHERE "codigo" = 'configuracion/sellos');
