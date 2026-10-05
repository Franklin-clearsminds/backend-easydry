-- Estado del servicio de catálogo (aditivo): "Activo" | "Inactivo".
-- Un servicio Inactivo no se ofrece para nuevas OTs pero conserva su historial.
ALTER TABLE "CatalogoServicio" ADD COLUMN "estado" TEXT NOT NULL DEFAULT 'Activo';
