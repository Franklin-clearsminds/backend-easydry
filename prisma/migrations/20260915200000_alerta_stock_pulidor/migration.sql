-- AlterTable
ALTER TABLE "AlertaStock" ADD COLUMN IF NOT EXISTS "pulidorId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AlertaStock_pulidorId_idx" ON "AlertaStock"("pulidorId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AlertaStock_pulidorId_fkey'
  ) THEN
    ALTER TABLE "AlertaStock"
      ADD CONSTRAINT "AlertaStock_pulidorId_fkey"
      FOREIGN KEY ("pulidorId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
