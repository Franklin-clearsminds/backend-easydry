-- Auditorías: Informes de inspección y Auditoría 5S (tablas, pantallas del menú y permisos de los roles oficiales).

-- CreateTable
CREATE TABLE "InformeInspeccion" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "numeroMensual" INTEGER NOT NULL,
    "periodo" TEXT NOT NULL,
    "agenciaId" TEXT NOT NULL,
    "inspectorId" TEXT NOT NULL,
    "destinatarioId" TEXT,
    "destinatarioNombre" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "fechaVisita" TIMESTAMP(3) NOT NULL,
    "tipoInspeccion" TEXT NOT NULL DEFAULT 'RUTINA',
    "estado" TEXT NOT NULL DEFAULT 'BORRADOR',
    "asunto" TEXT NOT NULL DEFAULT '',
    "antecedentes" TEXT NOT NULL DEFAULT '',
    "desarrollo" TEXT NOT NULL DEFAULT '',
    "actividadesGeneral" TEXT NOT NULL DEFAULT '',
    "planesGeneral" TEXT NOT NULL DEFAULT '',
    "observacionesJefeTaller" TEXT NOT NULL DEFAULT '',
    "calificacion" TEXT,
    "calificadoPorId" TEXT,
    "calificadoPorNombre" TEXT,
    "calificadoEn" TIMESTAMP(3),
    "firmasRequeridas" TEXT[] DEFAULT ARRAY['RESPONSABLE', 'JEFE_TALLER', 'LIDER_BAHIA', 'RECEPCION']::TEXT[],
    "motivoRechazo" TEXT,
    "enviadoEn" TIMESTAMP(3),
    "aprobadoEn" TIMESTAMP(3),
    "cerradoEn" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InformeInspeccion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InformeNovedad" (
    "id" TEXT NOT NULL,
    "informeId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL DEFAULT '',
    "categoria" TEXT NOT NULL DEFAULT 'OTROS',
    "prioridad" TEXT NOT NULL DEFAULT 'MEDIA',
    "area" TEXT NOT NULL DEFAULT '',
    "fotos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "estadoSeguimiento" TEXT NOT NULL DEFAULT 'ABIERTA',
    "registradaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orden" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InformeNovedad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InformeActividad" (
    "id" TEXT NOT NULL,
    "informeId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL DEFAULT '',
    "responsable" TEXT NOT NULL DEFAULT '',
    "fecha" DATE,
    "resultado" TEXT NOT NULL DEFAULT '',
    "observaciones" TEXT NOT NULL DEFAULT '',
    "fotos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "orden" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InformeActividad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InformePlanAccion" (
    "id" TEXT NOT NULL,
    "informeId" TEXT NOT NULL,
    "agenciaId" TEXT NOT NULL,
    "problema" TEXT NOT NULL,
    "accionRequerida" TEXT NOT NULL DEFAULT '',
    "areaResponsable" TEXT NOT NULL DEFAULT '',
    "personaResponsable" TEXT NOT NULL DEFAULT '',
    "fechaCompromiso" DATE,
    "prioridad" TEXT NOT NULL DEFAULT 'MEDIA',
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "observaciones" TEXT NOT NULL DEFAULT '',
    "evidenciaCumplimiento" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "completadoEn" TIMESTAMP(3),
    "orden" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InformePlanAccion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InformeFirma" (
    "id" TEXT NOT NULL,
    "informeId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL DEFAULT '',
    "cargo" TEXT NOT NULL DEFAULT '',
    "imagen" TEXT,
    "firmadoEn" TIMESTAMP(3),
    "registradoPorId" TEXT,
    "registradoPorNombre" TEXT,

    CONSTRAINT "InformeFirma_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InformeHistorial" (
    "id" TEXT NOT NULL,
    "informeId" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "estadoAnterior" TEXT,
    "estadoNuevo" TEXT,
    "usuarioId" TEXT NOT NULL,
    "usuarioNombre" TEXT NOT NULL,
    "rol" TEXT NOT NULL,
    "detalle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InformeHistorial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Auditoria5s" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "agenciaId" TEXT NOT NULL,
    "auditorId" TEXT NOT NULL,
    "responsableAgencia" TEXT NOT NULL DEFAULT '',
    "area" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'BORRADOR',
    "comentarios" TEXT NOT NULL DEFAULT '',
    "puntaje" INTEGER,
    "porcentaje" DOUBLE PRECISION,
    "semaforo" TEXT,
    "finalizadaEn" TIMESTAMP(3),
    "cerradaEn" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Auditoria5s_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Auditoria5sRespuesta" (
    "id" TEXT NOT NULL,
    "auditoriaId" TEXT NOT NULL,
    "criterio" INTEGER NOT NULL,
    "puntaje" INTEGER,
    "hallazgo" TEXT NOT NULL DEFAULT '',
    "observaciones" TEXT NOT NULL DEFAULT '',
    "accionCorrectiva" TEXT NOT NULL DEFAULT '',
    "responsable" TEXT NOT NULL DEFAULT '',
    "fechaCompromiso" DATE,
    "fotos" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "Auditoria5sRespuesta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Auditoria5sAccion" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "auditoriaId" TEXT NOT NULL,
    "agenciaId" TEXT NOT NULL,
    "criterio" INTEGER NOT NULL,
    "hallazgo" TEXT NOT NULL DEFAULT '',
    "accion" TEXT NOT NULL DEFAULT '',
    "responsable" TEXT NOT NULL DEFAULT '',
    "fechaCompromiso" DATE,
    "prioridad" TEXT NOT NULL DEFAULT 'MEDIA',
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "evidenciaInicial" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidenciaCorreccion" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "observaciones" TEXT NOT NULL DEFAULT '',
    "cerradaEn" TIMESTAMP(3),
    "verificadaPorId" TEXT,
    "verificadaPorNombre" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Auditoria5sAccion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Auditoria5sHistorial" (
    "id" TEXT NOT NULL,
    "auditoriaId" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "estadoAnterior" TEXT,
    "estadoNuevo" TEXT,
    "usuarioId" TEXT NOT NULL,
    "usuarioNombre" TEXT NOT NULL,
    "rol" TEXT NOT NULL,
    "detalle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Auditoria5sHistorial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InformeInspeccion_numero_key" ON "InformeInspeccion"("numero");

-- CreateIndex
CREATE INDEX "InformeInspeccion_agenciaId_idx" ON "InformeInspeccion"("agenciaId");

-- CreateIndex
CREATE INDEX "InformeInspeccion_inspectorId_idx" ON "InformeInspeccion"("inspectorId");

-- CreateIndex
CREATE INDEX "InformeInspeccion_estado_idx" ON "InformeInspeccion"("estado");

-- CreateIndex
CREATE INDEX "InformeInspeccion_fecha_idx" ON "InformeInspeccion"("fecha");

-- CreateIndex
CREATE INDEX "InformeInspeccion_deletedAt_idx" ON "InformeInspeccion"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InformeInspeccion_agenciaId_periodo_numeroMensual_key" ON "InformeInspeccion"("agenciaId", "periodo", "numeroMensual");

-- CreateIndex
CREATE INDEX "InformeNovedad_informeId_idx" ON "InformeNovedad"("informeId");

-- CreateIndex
CREATE INDEX "InformeActividad_informeId_idx" ON "InformeActividad"("informeId");

-- CreateIndex
CREATE INDEX "InformePlanAccion_informeId_idx" ON "InformePlanAccion"("informeId");

-- CreateIndex
CREATE INDEX "InformePlanAccion_agenciaId_idx" ON "InformePlanAccion"("agenciaId");

-- CreateIndex
CREATE INDEX "InformePlanAccion_estado_idx" ON "InformePlanAccion"("estado");

-- CreateIndex
CREATE INDEX "InformePlanAccion_fechaCompromiso_idx" ON "InformePlanAccion"("fechaCompromiso");

-- CreateIndex
CREATE UNIQUE INDEX "InformeFirma_informeId_tipo_key" ON "InformeFirma"("informeId", "tipo");

-- CreateIndex
CREATE INDEX "InformeHistorial_informeId_createdAt_idx" ON "InformeHistorial"("informeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Auditoria5s_codigo_key" ON "Auditoria5s"("codigo");

-- CreateIndex
CREATE INDEX "Auditoria5s_agenciaId_area_fecha_idx" ON "Auditoria5s"("agenciaId", "area", "fecha");

-- CreateIndex
CREATE INDEX "Auditoria5s_auditorId_idx" ON "Auditoria5s"("auditorId");

-- CreateIndex
CREATE INDEX "Auditoria5s_estado_idx" ON "Auditoria5s"("estado");

-- CreateIndex
CREATE INDEX "Auditoria5s_fecha_idx" ON "Auditoria5s"("fecha");

-- CreateIndex
CREATE INDEX "Auditoria5s_deletedAt_idx" ON "Auditoria5s"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Auditoria5sRespuesta_auditoriaId_criterio_key" ON "Auditoria5sRespuesta"("auditoriaId", "criterio");

-- CreateIndex
CREATE UNIQUE INDEX "Auditoria5sAccion_codigo_key" ON "Auditoria5sAccion"("codigo");

-- CreateIndex
CREATE INDEX "Auditoria5sAccion_auditoriaId_idx" ON "Auditoria5sAccion"("auditoriaId");

-- CreateIndex
CREATE INDEX "Auditoria5sAccion_agenciaId_idx" ON "Auditoria5sAccion"("agenciaId");

-- CreateIndex
CREATE INDEX "Auditoria5sAccion_estado_idx" ON "Auditoria5sAccion"("estado");

-- CreateIndex
CREATE INDEX "Auditoria5sAccion_fechaCompromiso_idx" ON "Auditoria5sAccion"("fechaCompromiso");

-- CreateIndex
CREATE INDEX "Auditoria5sHistorial_auditoriaId_createdAt_idx" ON "Auditoria5sHistorial"("auditoriaId", "createdAt");

-- AddForeignKey
ALTER TABLE "InformeInspeccion" ADD CONSTRAINT "InformeInspeccion_agenciaId_fkey" FOREIGN KEY ("agenciaId") REFERENCES "Agencia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InformeInspeccion" ADD CONSTRAINT "InformeInspeccion_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InformeNovedad" ADD CONSTRAINT "InformeNovedad_informeId_fkey" FOREIGN KEY ("informeId") REFERENCES "InformeInspeccion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InformeActividad" ADD CONSTRAINT "InformeActividad_informeId_fkey" FOREIGN KEY ("informeId") REFERENCES "InformeInspeccion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InformePlanAccion" ADD CONSTRAINT "InformePlanAccion_informeId_fkey" FOREIGN KEY ("informeId") REFERENCES "InformeInspeccion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InformeFirma" ADD CONSTRAINT "InformeFirma_informeId_fkey" FOREIGN KEY ("informeId") REFERENCES "InformeInspeccion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InformeHistorial" ADD CONSTRAINT "InformeHistorial_informeId_fkey" FOREIGN KEY ("informeId") REFERENCES "InformeInspeccion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auditoria5s" ADD CONSTRAINT "Auditoria5s_agenciaId_fkey" FOREIGN KEY ("agenciaId") REFERENCES "Agencia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auditoria5s" ADD CONSTRAINT "Auditoria5s_auditorId_fkey" FOREIGN KEY ("auditorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auditoria5sRespuesta" ADD CONSTRAINT "Auditoria5sRespuesta_auditoriaId_fkey" FOREIGN KEY ("auditoriaId") REFERENCES "Auditoria5s"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auditoria5sAccion" ADD CONSTRAINT "Auditoria5sAccion_auditoriaId_fkey" FOREIGN KEY ("auditoriaId") REFERENCES "Auditoria5s"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auditoria5sAccion" ADD CONSTRAINT "Auditoria5sAccion_agenciaId_fkey" FOREIGN KEY ("agenciaId") REFERENCES "Agencia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auditoria5sHistorial" ADD CONSTRAINT "Auditoria5sHistorial_auditoriaId_fkey" FOREIGN KEY ("auditoriaId") REFERENCES "Auditoria5s"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Pantallas nuevas del menú (grupo «Auditorías»). Los informes y la 5S también existen en la app móvil.
INSERT INTO "modulos_sistema" ("id", "codigo", "nombre", "descripcion", "icono", "rutaPrincipal", "grupo", "orden", "estado", "disponibleEnApp", "createdAt", "updatedAt") VALUES
  (gen_random_uuid()::text, 'auditorias', 'Dashboard de Auditorías', 'Indicadores de las inspecciones y auditorías 5S: estados, calificaciones, semáforo y planes de acción', 'clipboard-check', '/auditorias', 'Auditorías', 142, 1, false, now(), now()),
  (gen_random_uuid()::text, 'informes-inspeccion', 'Informes de Inspección', 'Visitas de inspección a las agencias: novedades, actividades, planes de acción, calificación y firmas', 'file-search', '/informes-inspeccion', 'Auditorías', 144, 1, true, now(), now()),
  (gen_random_uuid()::text, 'auditorias-5s', 'Auditorías 5S', 'Checklist 5S de 20 criterios por agencia y área, con semáforo de cumplimiento y acciones correctivas', 'sparkles', '/auditorias-5s', 'Auditorías', 146, 1, true, now(), now())
ON CONFLICT ("codigo") DO NOTHING;

-- Quienes pueden auditar: todos los roles oficiales menos el líder de bahía (LIDER y su reemplazo BACKUP), el lavador y el pulidor.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY[
      'pagina.auditorias', 'pagina.informes', 'pagina.inspecciones',
      'auditorias.ver', 'informes.ver', 'informes.crear', 'informes.firmar', 'informes.seguimiento',
      'inspecciones.ver', 'inspecciones.crear', 'inspecciones.acciones'
    ]::text[])),
    "permisos" = ARRAY(SELECT DISTINCT unnest("permisos" || ARRAY['auditorias', 'informes-inspeccion', 'auditorias-5s']::text[]))
WHERE "namerol" IN ('SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'JEFE_COMERCIAL', 'COORD_COMERCIAL', 'APROBADOR',
                    'COORD_SERVICIOS_ESPECIALES', 'COORD_MANTENIMIENTO', 'TECNICO', 'COORD_BODEGA', 'ASISTENTE_BODEGA');

-- Revisar, aprobar, cerrar, verificar y eliminar borradores: administradores y supervisor regional.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['informes.revisar', 'informes.eliminar', 'inspecciones.verificar', 'inspecciones.eliminar']::text[]))
WHERE "namerol" IN ('SUPER_ADMIN', 'ADMIN', 'SUPERVISOR');

-- Líder, Backup, pulidor y lavador no auditan: solo ven el resultado de su inspección 5S y sus informes de inspección.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['pagina.informes', 'pagina.inspecciones', 'informes.ver', 'inspecciones.ver']::text[])),
    "permisos" = ARRAY(SELECT DISTINCT unnest("permisos" || ARRAY['informes-inspeccion', 'auditorias-5s']::text[]))
WHERE "namerol" IN ('LIDER', 'BACKUP', 'PULIDOR', 'LAVADOR');

-- El lavador deja de ser un rol sin ningún permiso: además de sus dos pantallas de resultados ve sus notificaciones y su perfil.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['pagina.notificaciones', 'pagina.perfil']::text[])),
    "permisos" = ARRAY(SELECT DISTINCT unnest("permisos" || ARRAY['notificaciones', 'perfil']::text[]))
WHERE "namerol" = 'LAVADOR';
