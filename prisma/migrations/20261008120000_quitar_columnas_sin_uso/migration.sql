-- Columnas que ni la web, ni la app, ni el backend leen, escriben o validan (ninguna referencia en el código):
--   SyncDevice.lastIp                  nunca se guardó
--   ServicioEspecial.fotosPausaUrls    las pausas guardan su evidencia en videoPausaUrl / historialPausas
--   ServicioEspecial.evidenciasPausa   ídem
--   ServicioEspecial.notasSupervisor   el backend nunca lo persiste ni lo devuelve
--   Reto.criterios                     obsoleto: el reto se define con tipoServicios + metrica + modoGanador
--   Reto.bahiasIds                     los retos por bahía se arman con sucursalesIds
ALTER TABLE "SyncDevice" DROP COLUMN IF EXISTS "lastIp";

ALTER TABLE "ServicioEspecial"
  DROP COLUMN IF EXISTS "fotosPausaUrls",
  DROP COLUMN IF EXISTS "evidenciasPausa",
  DROP COLUMN IF EXISTS "notasSupervisor";

ALTER TABLE "Reto"
  DROP COLUMN IF EXISTS "criterios",
  DROP COLUMN IF EXISTS "bahiasIds";
