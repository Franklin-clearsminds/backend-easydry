-- Retoque: servicio del catálogo (uno general y uno especial) que se puede agregar a una OT ya finalizada hasta 2 días después.
ALTER TABLE "CatalogoServicio" ADD COLUMN "esRetoque" BOOLEAN NOT NULL DEFAULT false;

INSERT INTO "CatalogoServicio" ("codigo", "nombre", "categoria", "descripcion", "precio", "tiempoEstimadoMin", "estado", "esRetoque")
SELECT 'RETOQUE-GEN', 'RETOQUE', 'GENERAL', 'Corrección de un servicio ya entregado. Se agrega a la misma OT hasta 2 días después de finalizada; el precio, el tiempo y los insumos se configuran por el administrador.', 0, 30, 'Activo', true
WHERE NOT EXISTS (SELECT 1 FROM "CatalogoServicio" WHERE "codigo" = 'RETOQUE-GEN');

INSERT INTO "CatalogoServicio" ("codigo", "nombre", "categoria", "descripcion", "precio", "tiempoEstimadoMin", "estado", "esRetoque")
SELECT 'RETOQUE-ESP', 'RETOQUE ESPECIAL', 'ESPECIAL', 'Corrección de un servicio especial ya entregado. Se agrega a la misma OT hasta 2 días después de finalizada; el precio, el tiempo y los insumos se configuran por el administrador.', 0, 60, 'Activo', true
WHERE NOT EXISTS (SELECT 1 FROM "CatalogoServicio" WHERE "codigo" = 'RETOQUE-ESP');
