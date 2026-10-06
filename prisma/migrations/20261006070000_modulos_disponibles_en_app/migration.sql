-- Qué pantallas de la web también existen en la app móvil. Se muestran en el celular solo si el rol tiene el permiso del módulo.
ALTER TABLE "modulos_sistema" ADD COLUMN IF NOT EXISTS "disponibleEnApp" BOOLEAN NOT NULL DEFAULT false;

UPDATE "modulos_sistema" SET "disponibleEnApp" = true
WHERE "codigo" IN (
  'dashboard', 'notificaciones', 'servicios', 'aprobaciones', 'operadores',
  'maquinaria', 'taller-tecnico', 'inventario', 'envios', 'perfil'
);
