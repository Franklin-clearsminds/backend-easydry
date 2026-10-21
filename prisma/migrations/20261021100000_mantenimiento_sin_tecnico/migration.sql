-- Un mantenimiento se puede programar sin técnico: queda «sin técnico asignado» hasta que se asigne.
ALTER TABLE "MantenimientoMaquinaria" ALTER COLUMN "tecnicoId" DROP NOT NULL;
