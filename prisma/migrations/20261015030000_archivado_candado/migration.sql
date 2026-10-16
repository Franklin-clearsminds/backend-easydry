-- Candado del archivado: una sola corrida real a la vez, aunque haya varias instancias del servidor (arriendo con vencimiento).
CREATE TABLE "archivado_candado" (
    "id" TEXT NOT NULL,
    "propietario" TEXT NOT NULL,
    "hasta" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "archivado_candado_pkey" PRIMARY KEY ("id")
);
