-- «Mapa Operativo» deja de ser una página aparte: es una pestaña de «Agencias & Mapa Red» (una sola pantalla), y esa pantalla gana
-- la pestaña «Aprobadores» con su propio botón. Cada rol conserva lo que podía ver y hacer: nadie gana ni pierde acceso.

-- 1) Roles con la página Mapa: pasan a la página Agencias con su pestaña Mapa, y sus bloques (lavador y vehículo) se encienden
--    como lo veían hasta hoy.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['pagina.agencias', 'pagina.agencias.mapa', 'mapa.lavador.ver', 'mapa.vehiculo.ver']))
WHERE 'pagina.mapa' = ANY("capacidades");

-- 2) El bloque de maquinaria del mapa solo lo reciben los que ya podían ver maquinaria (hasta hoy ese bloque no mostraba datos).
UPDATE "roles"
SET "capacidades" = array_append("capacidades", 'mapa.maquinaria.ver')
WHERE 'pagina.agencias.mapa' = ANY("capacidades")
  AND 'maquinaria.ver' = ANY("capacidades")
  AND NOT ('mapa.maquinaria.ver' = ANY("capacidades"));

-- 3) Pestaña Aprobadores: la veía quien tenía la pantalla de agencias y «ver usuarios»; asignar, quien gestionaba usuarios.
UPDATE "roles"
SET "capacidades" = array_append("capacidades", 'pagina.agencias.aprobadores')
WHERE 'pagina.agencias' = ANY("capacidades")
  AND 'usuarios.ver' = ANY("capacidades")
  AND NOT ('pagina.agencias.aprobadores' = ANY("capacidades"));

UPDATE "roles"
SET "capacidades" = array_append("capacidades", 'agencias.aprobadores.asignar')
WHERE 'pagina.agencias.aprobadores' = ANY("capacidades")
  AND 'usuarios.gestionar' = ANY("capacidades")
  AND NOT ('agencias.aprobadores.asignar' = ANY("capacidades"));

-- 4) Se retiran los códigos que ya no existen (la página Mapa y sus dos botones, que nunca tuvieron botón en la pantalla).
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT x FROM unnest("capacidades") AS x WHERE x NOT IN ('pagina.mapa', 'mapa.bahia.asignar', 'mapa.bahia.quitar'))
WHERE "capacidades" && ARRAY['pagina.mapa', 'mapa.bahia.asignar', 'mapa.bahia.quitar'];

-- 5) La pantalla «mapa-operativo» ya no existe: sale del listado de módulos y de las pantallas guardadas en los roles
--    (quien la tenía ve ahora «agencias», que es donde vive el mapa).
UPDATE "roles"
SET "permisos" = ARRAY(SELECT DISTINCT unnest(array_remove("permisos", 'mapa-operativo') || ARRAY['agencias']))
WHERE 'mapa-operativo' = ANY("permisos");

DELETE FROM "modulos_sistema" WHERE "codigo" = 'mapa-operativo';
