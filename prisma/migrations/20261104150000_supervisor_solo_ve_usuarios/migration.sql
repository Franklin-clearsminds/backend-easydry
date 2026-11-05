-- El supervisor regional solo consulta los usuarios de su región: ya no crea ni edita usuarios Backup.
UPDATE "roles"
   SET "capacidades" = array_remove(array_remove("capacidades", 'backup.gestionar'), 'usuarios.usuarios.backup'),
       "descripcion" = replace("descripcion", 'y gestiona sus usuarios Backup.', 'y consulta (solo lectura) los usuarios de su región, sin los asistentes de mantenimiento.')
 WHERE "namerol" = 'SUPERVISOR';
