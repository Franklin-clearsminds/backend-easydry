import { createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function stableUuid(value: string): string {
  const hex = createHash('sha256')
    .update(value)
    .digest('hex')
    .slice(0, 32)
    .split('');
  hex[12] = '5';
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const compact = hex.join('');
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function sqlArray(values: string[]): string {
  return `ARRAY[${values.map((value) => `'${value.replaceAll("'", "''")}'`).join(',')}]::TEXT[]`;
}

function sqlIntArray(values: number[]): string {
  return `ARRAY[${values.join(',')}]::INTEGER[]`;
}

function fechaEnMes(dia: number, hora = 10): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), dia, hora));
}

async function main(): Promise<void> {
  const resultado = await prisma.$transaction(async (tx) => {
    const agencias = await tx.$queryRawUnsafe<any[]>(`
      WITH elegibles AS (
        SELECT
          a.id,
          a.nombre,
          a."regionId",
          r.nombre AS "regionNombre",
          a."clienteId",
          c.nombre AS "clienteNombre",
          array_agg(DISTINCT b.id ORDER BY b.id) AS "bahiasIds",
          (array_agg(DISTINCT u.id ORDER BY u.id) FILTER (WHERE u.id IS NOT NULL))[1] AS "operadorId"
        FROM "Agencia" a
        JOIN "Bahia" b ON b."agenciaId" = a.id AND b.activa = true
        JOIN "Region" r ON r.id = a."regionId"
        JOIN "Cliente" c ON c.id = a."clienteId"
        LEFT JOIN "User" u ON u."agenciaId" = a.id AND u.estado = 1
        WHERE a.estado = 1
        GROUP BY a.id, a.nombre, a."regionId", r.nombre, a."clienteId", c.nombre
        HAVING count(DISTINCT b.id) >= 2 AND count(DISTINCT u.id) > 0
      ),
      grupos AS (
        SELECT "regionId", "clienteId"
        FROM elegibles
        GROUP BY "regionId", "clienteId"
        HAVING count(*) >= 2
        ORDER BY "regionId", "clienteId"
        LIMIT 1
      )
      SELECT e.*
      FROM elegibles e
      JOIN grupos g USING ("regionId", "clienteId")
      ORDER BY e.nombre
      LIMIT 2
    `);
    if (agencias.length !== 2) {
      throw new Error(
        'No se encontraron dos agencias activas del mismo cliente/región con dos bahías y operadores.',
      );
    }

    const pulidores = await tx.$queryRawUnsafe<any[]>(`
      SELECT u.id, u.name, u.lastname, u."agenciaId",
        COALESCE(r.nombre, ra.nombre, '') AS "regionNombre"
      FROM "User" u
      JOIN "roles" ro ON ro.id = u."roleId"
      LEFT JOIN "Agencia" a ON a.id = u."agenciaId"
      LEFT JOIN "Region" r ON r.id = u."regionId"
      LEFT JOIN "Region" ra ON ra.id = a."regionId"
      WHERE u.estado = 1
        AND ro.namerol IN ('PULIDOR', 'PULIDOR_FIJO', 'PULIDOR_MOVIL')
        AND (u."regionId" = '${agencias[0].regionId}' OR a."regionId" = '${agencias[0].regionId}')
      ORDER BY u.id
      LIMIT 4
    `);
    if (pulidores.length < 2) {
      throw new Error(
        `Se encontraron solo ${pulidores.length} pulidores activos en ${agencias[0].regionNombre}.`,
      );
    }

    const servicios = await tx.$queryRawUnsafe<any[]>(`
      SELECT id, nombre, categoria
      FROM "CatalogoServicio"
      WHERE estado = 'Activo' AND categoria IN ('GENERAL', 'ESPECIAL')
      ORDER BY id
    `);
    const servicioGeneralIds = servicios
      .filter((servicio) => servicio.categoria === 'GENERAL')
      .slice(0, 2)
      .map((servicio) => Number(servicio.id));
    const serviciosEspeciales = servicios
      .filter((servicio) => servicio.categoria === 'ESPECIAL')
      .slice(0, 2);
    const servicioEspecialIds = serviciosEspeciales.map((servicio) =>
      Number(servicio.id),
    );
    if (servicioGeneralIds.length < 2 || servicioEspecialIds.length < 2) {
      throw new Error(
        'Se requieren al menos dos servicios generales y dos especiales activos.',
      );
    }

    const inicio = fechaEnMes(1, 0);
    const fin = new Date(
      Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth() + 1, 0),
    );
    const sucursalesIds = agencias.map((agencia) => String(agencia.id));
    const pulidoresIds = pulidores.map((pulidor) => String(pulidor.id));
    const serviciosSeleccionados = [
      ...servicioGeneralIds,
      ...servicioEspecialIds,
    ];

    const retos = [
      {
        id: stableUuid('demo-retos-agencias-v1'),
        titulo: `[DEMO RETOS] Agencias · ${inicio.toLocaleDateString('es-EC', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`,
        descripcion:
          'Datos sintéticos: gana la agencia con más servicios generales del mes.',
        premio: 'Premio de prueba',
        tipo: 'AGENCIA',
        tipoServicios: 'GENERALES',
        regiones: [String(agencias[0].regionNombre)],
        marcas: [String(agencias[0].clienteNombre)],
        agenciasIds: sucursalesIds,
        participantesIds: [],
        serviciosIds: servicioGeneralIds,
      },
      {
        id: stableUuid('demo-retos-pulidores-v1'),
        titulo: `[DEMO RETOS] Pulidores · ${inicio.toLocaleDateString('es-EC', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`,
        descripcion:
          'Datos sintéticos: gana el pulidor con más servicios especiales del mes.',
        premio: 'Premio de prueba',
        tipo: 'PULIDOR',
        tipoServicios: 'ESPECIALES',
        regiones: [String(agencias[0].regionNombre)],
        marcas: ['Todas'],
        agenciasIds: [],
        participantesIds: pulidoresIds,
        serviciosIds: servicioEspecialIds,
      },
    ];

    for (const reto of retos) {
      const query = `
        INSERT INTO "Reto" (
          "id", "titulo", "descripcion", "premio", "fechaInicio", "fechaFin",
          "regiones", "marcas", "sucursalesIds", "creadoPorId", "creadorNombre",
          "creadorRol", "estado", "catalogoServicioId",
          "catalogoServicioIds", "tipoReto", "pulidoresIds", "tipoServicios", "metrica",
          "modoGanador", "cantidadGanadores", "createdAt", "updatedAt"
        ) VALUES (
          '${reto.id}', '${reto.titulo.replaceAll("'", "''")}',
          '${reto.descripcion.replaceAll("'", "''")}', '${reto.premio}',
          '${inicio.toISOString().slice(0, 10)}', '${fin.toISOString().slice(0, 10)}',
          ${sqlArray(reto.regiones)}, ${sqlArray(reto.marcas)}, ${sqlArray(reto.agenciasIds)},
          NULL, 'Datos demo', 'ADMIN', 'ACTIVO',
          ${reto.serviciosIds[0]}, ${sqlIntArray(reto.serviciosIds)},
          '${reto.tipo}', ${sqlArray(reto.participantesIds)}, '${reto.tipoServicios}', 'SERVICIOS',
          'RANKING', 1, NOW(), NOW()
        )
        ON CONFLICT ("id") DO UPDATE SET
          "titulo" = EXCLUDED."titulo", "descripcion" = EXCLUDED."descripcion",
          "premio" = EXCLUDED."premio", "fechaInicio" = EXCLUDED."fechaInicio",
          "fechaFin" = EXCLUDED."fechaFin", "regiones" = EXCLUDED."regiones",
          "marcas" = EXCLUDED."marcas", "sucursalesIds" = EXCLUDED."sucursalesIds",
          "creadorNombre" = EXCLUDED."creadorNombre", "creadorRol" = EXCLUDED."creadorRol",
          "estado" = EXCLUDED."estado",
          "catalogoServicioId" = EXCLUDED."catalogoServicioId",
          "catalogoServicioIds" = EXCLUDED."catalogoServicioIds",
          "tipoReto" = EXCLUDED."tipoReto", "pulidoresIds" = EXCLUDED."pulidoresIds",
          "tipoServicios" = EXCLUDED."tipoServicios", "metrica" = EXCLUDED."metrica",
          "modoGanador" = EXCLUDED."modoGanador", "cantidadGanadores" = EXCLUDED."cantidadGanadores",
          "updatedAt" = NOW()
      `;
      await tx.$executeRawUnsafe(query);
    }

    let lavadosCreados = 0;
    const serviciosPorBahia = [6, 3, 4, 7];
    for (
      let agenciaIndex = 0;
      agenciaIndex < agencias.length;
      agenciaIndex += 1
    ) {
      const agencia = agencias[agenciaIndex];
      const bahiasIds = agencia.bahiasIds as string[];
      const operadorId = String(agencia.operadorId);
      for (
        let indice = 0;
        indice < serviciosPorBahia[agenciaIndex * 2];
        indice += 1
      ) {
        const row = {
          id: stableUuid(`demo-reto-lavado-${agencia.id}-b1-${indice}`),
          clientUuid: stableUuid(
            `demo-reto-lavado-client-${agencia.id}-b1-${indice}`,
          ),
          ot: `DEMO-RETO-${agenciaIndex + 1}-B1-${String(indice + 1).padStart(2, '0')}`,
          placa: `DM${agenciaIndex + 1}${String(Math.floor(indice / 2) + 1).padStart(3, '0')}`,
          servicioId: servicioGeneralIds[indice % servicioGeneralIds.length],
          bahiaId: bahiasIds[0],
          operadorId,
          dia: (indice % 6) + 1,
        };
        await insertarLavado(
          tx,
          row,
          fechaEnMes(row.dia),
          indice % 2 ? 'APROBADO' : 'FINALIZADO',
        );
        lavadosCreados += 1;
      }
      for (
        let indice = 0;
        indice < serviciosPorBahia[agenciaIndex * 2 + 1];
        indice += 1
      ) {
        const row = {
          id: stableUuid(`demo-reto-lavado-${agencia.id}-b2-${indice}`),
          clientUuid: stableUuid(
            `demo-reto-lavado-client-${agencia.id}-b2-${indice}`,
          ),
          ot: `DEMO-RETO-${agenciaIndex + 1}-B2-${String(indice + 1).padStart(2, '0')}`,
          placa: `DM${agenciaIndex + 1}${String(Math.floor(indice / 2) + 1).padStart(3, '0')}`,
          servicioId:
            servicioGeneralIds[(indice + 1) % servicioGeneralIds.length],
          bahiaId: bahiasIds[1],
          operadorId,
          dia: (indice % 6) + 1,
        };
        await insertarLavado(
          tx,
          row,
          fechaEnMes(row.dia),
          indice % 2 ? 'FINALIZADO' : 'APROBADO',
        );
        lavadosCreados += 1;
      }
    }

    let especialesCreados = 0;
    for (
      let pulidorIndex = 0;
      pulidorIndex < pulidores.length;
      pulidorIndex += 1
    ) {
      const pulidor = pulidores[pulidorIndex];
      const serviciosACompletar = [3, 5, 2, 6][pulidorIndex];
      const agencia =
        agencias.find((item) => item.id === pulidor.agenciaId) ||
        agencias[pulidorIndex % agencias.length];
      const bahiasIds = agencia.bahiasIds as string[];
      for (let indice = 0; indice < serviciosACompletar; indice += 1) {
        const idBase = `demo-reto-especial-${pulidor.id}-${indice}`;
        const fechaFin = fechaEnMes((indice % 6) + 1, 15);
        const codigo = `DEMO-RETO-SE-${pulidorIndex + 1}-${String(indice + 1).padStart(2, '0')}`;
        const tipoServicio = String(
          serviciosEspeciales[indice % serviciosEspeciales.length].nombre,
        );
        const servicioCatalogoId =
          servicioEspecialIds[indice % servicioEspecialIds.length];
        await tx.$executeRawUnsafe(
          `INSERT INTO "ServicioEspecial" (
             "id", "clientUuid", "codigoSE", "ordenTrabajoOT", "tipoServicio",
             "servicioCatalogoId", "clienteNombre", "placa", "modelo", "estado",
             "agenciaId", "operadorId", "creadoPorNombre", "bahiaId", "regionId",
             "regionNombre", "fechaProgramada", "fechaInicio", "fechaFin",
             "syncedAt", "version", "createdAt", "updatedAt"
           ) VALUES (
             $1, $2, $3, $3, $4, $5, 'Cliente demo', $6, 'Vehículo demo',
             'Completado', $7, $8, 'Datos demo', $9, $10, $11, $12, $12, $13,
             NOW(), 1, NOW(), NOW()
           )
           ON CONFLICT ("clientUuid") DO UPDATE SET
             "codigoSE" = EXCLUDED."codigoSE", "ordenTrabajoOT" = EXCLUDED."ordenTrabajoOT",
             "tipoServicio" = EXCLUDED."tipoServicio", "servicioCatalogoId" = EXCLUDED."servicioCatalogoId",
             "clienteNombre" = EXCLUDED."clienteNombre", "placa" = EXCLUDED."placa",
             "modelo" = EXCLUDED."modelo", "estado" = EXCLUDED."estado",
             "agenciaId" = EXCLUDED."agenciaId", "operadorId" = EXCLUDED."operadorId",
             "bahiaId" = EXCLUDED."bahiaId", "regionId" = EXCLUDED."regionId",
             "regionNombre" = EXCLUDED."regionNombre", "fechaProgramada" = EXCLUDED."fechaProgramada",
             "fechaInicio" = EXCLUDED."fechaInicio", "fechaFin" = EXCLUDED."fechaFin",
             "updatedAt" = NOW()`,
          stableUuid(`${idBase}-id`),
          stableUuid(`${idBase}-client`),
          codigo,
          tipoServicio,
          servicioCatalogoId,
          `DM-P${pulidorIndex + 1}-${String(Math.floor(indice / 2) + 1).padStart(3, '0')}`,
          agencia.id,
          pulidor.id,
          bahiasIds[indice % bahiasIds.length],
          pulidor.regionId || agencia.regionId,
          pulidor.regionNombre || agencia.regionNombre,
          fechaEnMes((indice % 6) + 1, 8),
          fechaFin,
        );
        especialesCreados += 1;
      }
    }

    return {
      retos: retos.map(({ id, titulo, tipo, serviciosIds }) => ({
        id,
        titulo,
        tipo,
        serviciosIds,
      })),
      agencias: agencias.map(({ id, nombre, regionNombre, clienteNombre }) => ({
        id,
        nombre,
        regionNombre,
        clienteNombre,
      })),
      pulidores: pulidores.map((pulidor) =>
        `${pulidor.name} ${pulidor.lastname}`.trim(),
      ),
      lavadosCreados,
      especialesCreados,
    };
  });

  console.log(JSON.stringify(resultado, null, 2));
}

async function insertarLavado(
  tx: Prisma.TransactionClient,
  row: {
    id: string;
    clientUuid: string;
    ot: string;
    placa: string;
    servicioId: number;
    bahiaId: string;
    operadorId: string;
  },
  horaIngreso: Date,
  estado: 'FINALIZADO' | 'APROBADO',
): Promise<void> {
  const horaSalida = new Date(horaIngreso.getTime() + 35 * 60_000);
  await tx.$executeRawUnsafe(
    `INSERT INTO "ServicioLavado" (
       "id", "clientUuid", "ordenTrabajoOT", "placa", "modelo", "estado",
       "bahiaId", "servicioCatalogoId", "operadorId", "horaIngreso", "horaSalida",
       "version", "syncedAt", "createdAt", "updatedAt"
     ) VALUES ($1, $2, $3, $4, 'Vehículo demo', $5::"ServiceStatus", $6, $7, $8, $9, $10, 1, NOW(), NOW(), NOW())
     ON CONFLICT ("clientUuid") DO UPDATE SET
       "ordenTrabajoOT" = EXCLUDED."ordenTrabajoOT", "placa" = EXCLUDED."placa",
       "modelo" = EXCLUDED."modelo", "estado" = EXCLUDED."estado",
       "bahiaId" = EXCLUDED."bahiaId", "servicioCatalogoId" = EXCLUDED."servicioCatalogoId",
       "operadorId" = EXCLUDED."operadorId", "horaIngreso" = EXCLUDED."horaIngreso",
       "horaSalida" = EXCLUDED."horaSalida", "updatedAt" = NOW()`,
    row.id,
    row.clientUuid,
    row.ot,
    row.placa,
    estado,
    row.bahiaId,
    row.servicioId,
    row.operadorId,
    horaIngreso,
    horaSalida,
  );
}

main()
  .catch((error: unknown) => {
    console.error('No se pudieron crear los datos demo de retos.', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
