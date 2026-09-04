-- AlterTable
ALTER TABLE "User" ADD COLUMN     "roleId" TEXT;

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "namerol" TEXT NOT NULL,
    "estado" INTEGER NOT NULL DEFAULT 1,
    "permisos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fechaCreacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaModificacion" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_namerol_key" ON "Role"("namerol");

-- CreateIndex
CREATE INDEX "Role_namerol_idx" ON "Role"("namerol");

-- CreateIndex
CREATE INDEX "Role_estado_idx" ON "Role"("estado");

-- CreateIndex
CREATE INDEX "User_roleId_idx" ON "User"("roleId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;
