-- RRHH: aviso de ubicación faltante, módulos del menú y permisos de los roles oficiales ya sembrados.
ALTER TYPE "TipoNotificacion" ADD VALUE IF NOT EXISTS 'UBICACION_FALTANTE';

INSERT INTO "modulos_sistema" ("id", "codigo", "nombre", "descripcion", "icono", "rutaPrincipal", "grupo", "orden", "estado", "disponibleEnApp", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'rrhh/tareas', 'Tareas del personal', 'Tareas asignadas al personal, con respuesta y evidencia, revisión y avisos de vencimiento', 'clipboard-list', '/rrhh/tareas', 'RRHH', 152, 1, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'rrhh/timbradas', 'Timbradas', 'Entrada y salida del personal con foto de cámara y ubicación validada contra su agencia o bodega', 'clock', '/rrhh/timbradas', 'RRHH', 154, 1, true, CURRENT_TIMESTAMP)
ON CONFLICT ("codigo") DO NOTHING;

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['rrhh.timbradas.ver', 'rrhh.tareas.asignar', 'rrhh.ubicaciones.gestionar']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'SUPER_ADMIN';

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['pagina.rrhh-tareas', 'pagina.rrhh-tareas.asignadas', 'pagina.rrhh-timbradas', 'pagina.rrhh-timbradas.equipo']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'SUPER_ADMIN' AND EXISTS (SELECT 1 FROM unnest(r."capacidades") x WHERE x LIKE 'pagina.%');

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY['agencias.agencias.ubicacion']::text[]
 WHERE r."namerol" = 'SUPER_ADMIN' AND 'pagina.agencias.agencias' = ANY (r."capacidades") AND NOT ('agencias.agencias.ubicacion' = ANY (r."capacidades"));

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY['inventario.bodegas.ubicacion']::text[]
 WHERE r."namerol" = 'SUPER_ADMIN' AND 'pagina.inventario.bodegas' = ANY (r."capacidades") AND NOT ('inventario.bodegas.ubicacion' = ANY (r."capacidades"));

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['rrhh.timbradas.ver', 'rrhh.tareas.asignar', 'rrhh.ubicaciones.gestionar']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'ADMIN';

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['pagina.rrhh-tareas', 'pagina.rrhh-tareas.asignadas', 'pagina.rrhh-timbradas', 'pagina.rrhh-timbradas.equipo']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'ADMIN' AND EXISTS (SELECT 1 FROM unnest(r."capacidades") x WHERE x LIKE 'pagina.%');

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY['agencias.agencias.ubicacion']::text[]
 WHERE r."namerol" = 'ADMIN' AND 'pagina.agencias.agencias' = ANY (r."capacidades") AND NOT ('agencias.agencias.ubicacion' = ANY (r."capacidades"));

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY['inventario.bodegas.ubicacion']::text[]
 WHERE r."namerol" = 'ADMIN' AND 'pagina.inventario.bodegas' = ANY (r."capacidades") AND NOT ('inventario.bodegas.ubicacion' = ANY (r."capacidades"));

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['rrhh.timbrar', 'rrhh.tareas.propias', 'rrhh.tareas.asignar', 'rrhh.timbradas.ver']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'SUPERVISOR';

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['pagina.rrhh-tareas', 'pagina.rrhh-tareas.mis', 'pagina.rrhh-tareas.asignadas', 'pagina.rrhh-timbradas', 'pagina.rrhh-timbradas.marcar', 'pagina.rrhh-timbradas.equipo']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'SUPERVISOR' AND EXISTS (SELECT 1 FROM unnest(r."capacidades") x WHERE x LIKE 'pagina.%');

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['rrhh.timbrar', 'rrhh.tareas.propias']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'JEFE_COMERCIAL';

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['pagina.rrhh-tareas', 'pagina.rrhh-tareas.mis', 'pagina.rrhh-timbradas', 'pagina.rrhh-timbradas.marcar']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'JEFE_COMERCIAL' AND EXISTS (SELECT 1 FROM unnest(r."capacidades") x WHERE x LIKE 'pagina.%');

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['rrhh.timbrar', 'rrhh.tareas.propias', 'rrhh.tareas.asignar', 'rrhh.timbradas.ver']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'COORD_COMERCIAL';

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['pagina.rrhh-tareas', 'pagina.rrhh-tareas.mis', 'pagina.rrhh-tareas.asignadas', 'pagina.rrhh-timbradas', 'pagina.rrhh-timbradas.marcar', 'pagina.rrhh-timbradas.equipo']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'COORD_COMERCIAL' AND EXISTS (SELECT 1 FROM unnest(r."capacidades") x WHERE x LIKE 'pagina.%');

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['rrhh.timbrar', 'rrhh.tareas.propias']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'APROBADOR';

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['pagina.rrhh-tareas', 'pagina.rrhh-tareas.mis', 'pagina.rrhh-timbradas', 'pagina.rrhh-timbradas.marcar']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'APROBADOR' AND EXISTS (SELECT 1 FROM unnest(r."capacidades") x WHERE x LIKE 'pagina.%');

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['rrhh.timbrar', 'rrhh.tareas.propias', 'rrhh.tareas.asignar', 'rrhh.timbradas.ver']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'LIDER';

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['pagina.rrhh-tareas', 'pagina.rrhh-tareas.mis', 'pagina.rrhh-tareas.asignadas', 'pagina.rrhh-timbradas', 'pagina.rrhh-timbradas.marcar', 'pagina.rrhh-timbradas.equipo']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'LIDER' AND EXISTS (SELECT 1 FROM unnest(r."capacidades") x WHERE x LIKE 'pagina.%');

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['rrhh.timbrar', 'rrhh.tareas.propias']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'BACKUP';

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['pagina.rrhh-tareas', 'pagina.rrhh-tareas.mis', 'pagina.rrhh-timbradas', 'pagina.rrhh-timbradas.marcar']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'BACKUP' AND EXISTS (SELECT 1 FROM unnest(r."capacidades") x WHERE x LIKE 'pagina.%');

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['rrhh.timbrar', 'rrhh.tareas.propias']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'AUXILIAR';

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['pagina.rrhh-tareas', 'pagina.rrhh-tareas.mis', 'pagina.rrhh-timbradas', 'pagina.rrhh-timbradas.marcar']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'AUXILIAR' AND EXISTS (SELECT 1 FROM unnest(r."capacidades") x WHERE x LIKE 'pagina.%');

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['rrhh.timbrar', 'rrhh.tareas.propias']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'LAVADOR';

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['pagina.rrhh-tareas', 'pagina.rrhh-tareas.mis', 'pagina.rrhh-timbradas', 'pagina.rrhh-timbradas.marcar']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'LAVADOR' AND EXISTS (SELECT 1 FROM unnest(r."capacidades") x WHERE x LIKE 'pagina.%');

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['rrhh.timbrar', 'rrhh.tareas.propias', 'rrhh.tareas.asignar', 'rrhh.timbradas.ver']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'COORD_SERVICIOS_ESPECIALES';

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['pagina.rrhh-tareas', 'pagina.rrhh-tareas.mis', 'pagina.rrhh-tareas.asignadas', 'pagina.rrhh-timbradas', 'pagina.rrhh-timbradas.marcar', 'pagina.rrhh-timbradas.equipo']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'COORD_SERVICIOS_ESPECIALES' AND EXISTS (SELECT 1 FROM unnest(r."capacidades") x WHERE x LIKE 'pagina.%');

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['rrhh.timbrar', 'rrhh.tareas.propias']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'PULIDOR';

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['pagina.rrhh-tareas', 'pagina.rrhh-tareas.mis', 'pagina.rrhh-timbradas', 'pagina.rrhh-timbradas.marcar']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'PULIDOR' AND EXISTS (SELECT 1 FROM unnest(r."capacidades") x WHERE x LIKE 'pagina.%');

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['rrhh.timbrar', 'rrhh.tareas.propias', 'rrhh.tareas.asignar', 'rrhh.timbradas.ver']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'COORD_MANTENIMIENTO';

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['pagina.rrhh-tareas', 'pagina.rrhh-tareas.mis', 'pagina.rrhh-tareas.asignadas', 'pagina.rrhh-timbradas', 'pagina.rrhh-timbradas.marcar', 'pagina.rrhh-timbradas.equipo']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'COORD_MANTENIMIENTO' AND EXISTS (SELECT 1 FROM unnest(r."capacidades") x WHERE x LIKE 'pagina.%');

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['rrhh.timbrar', 'rrhh.tareas.propias']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'TECNICO';

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['pagina.rrhh-tareas', 'pagina.rrhh-tareas.mis', 'pagina.rrhh-timbradas', 'pagina.rrhh-timbradas.marcar']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'TECNICO' AND EXISTS (SELECT 1 FROM unnest(r."capacidades") x WHERE x LIKE 'pagina.%');

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['rrhh.timbrar', 'rrhh.tareas.propias', 'rrhh.tareas.asignar', 'rrhh.timbradas.ver']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'COORD_BODEGA';

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['pagina.rrhh-tareas', 'pagina.rrhh-tareas.mis', 'pagina.rrhh-tareas.asignadas', 'pagina.rrhh-timbradas', 'pagina.rrhh-timbradas.marcar', 'pagina.rrhh-timbradas.equipo']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'COORD_BODEGA' AND EXISTS (SELECT 1 FROM unnest(r."capacidades") x WHERE x LIKE 'pagina.%');

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['rrhh.timbrar', 'rrhh.tareas.propias']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'ASISTENTE_BODEGA';

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['pagina.rrhh-tareas', 'pagina.rrhh-tareas.mis', 'pagina.rrhh-timbradas', 'pagina.rrhh-timbradas.marcar']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'ASISTENTE_BODEGA' AND EXISTS (SELECT 1 FROM unnest(r."capacidades") x WHERE x LIKE 'pagina.%');
