import { BadRequestException } from '@nestjs/common';
import { ServiceStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';

/** Ecuador no tiene horario de verano: siempre UTC-5. */
const OFFSET_EC_MS = 5 * 60 * 60 * 1000;
/** Después de finalizada una OT se puede agregar un retoque ese día y los 2 días siguientes. */
export const DIAS_VENTANA_RETOQUE = 2;

/** Último instante en que se puede agregar un retoque: el final (23:59:59.999, hora de Ecuador) del día D + 2. */
export function finVentanaRetoque(finalizadoEn: Date): Date {
  const local = new Date(finalizadoEn.getTime() - OFFSET_EC_MS);
  const inicioDiaSiguienteAlLimiteLocal = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() + DIAS_VENTANA_RETOQUE + 1,
  );
  return new Date(inicioDiaSiguienteAlLimiteLocal - 1 + OFFSET_EC_MS);
}

export function dentroDeVentanaRetoque(finalizadoEn: Date, ahora: Date): boolean {
  return ahora.getTime() <= finVentanaRetoque(finalizadoEn).getTime();
}

function fechaLegible(instante: Date): string {
  const d = new Date(instante.getTime() - OFFSET_EC_MS);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

const ABIERTOS: ServiceStatus[] = [ServiceStatus.EN_ESPERA, ServiceStatus.EN_PROCESO];

/**
 * Regla para agregar un servicio a una OT que ya existe:
 *  - OT abierta (algún servicio en espera o en proceso): se puede agregar cualquier servicio, como siempre;
 *  - OT ya finalizada: solo un retoque, y únicamente hasta el final del segundo día después de finalizada.
 * Los servicios de la OT se finalizan el mismo día, así que la ventana se cuenta desde la última finalización.
 * `catalogoIds` son los servicios que se quieren agregar; `ahora` es el momento del registro (el del teléfono si vino de la app).
 */
export async function validarAgregarServicioAOT(
  prisma: PrismaService,
  datos: { ordenTrabajoOT: string; catalogoIds: number[]; ahora: Date },
): Promise<void> {
  const filas = await prisma.servicioLavado.findMany({
    where: { ordenTrabajoOT: { equals: datos.ordenTrabajoOT, mode: 'insensitive' }, deletedAt: null, estado: { not: ServiceStatus.CANCELADO } },
    select: { estado: true, horaSalida: true, updatedAt: true },
  });
  if (filas.length === 0 || filas.some((f) => ABIERTOS.includes(f.estado))) return;

  const catalogos = await prisma.catalogoServicio.findMany({
    where: { id: { in: datos.catalogoIds } },
    select: { nombre: true, esRetoque: true },
  });
  const noRetoque = catalogos.find((c) => !c.esRetoque);
  if (noRetoque) {
    throw new BadRequestException(
      `La OT ${datos.ordenTrabajoOT} ya está finalizada: solo se puede agregar un retoque (hasta 2 días después), no "${noRetoque.nombre}".`,
    );
  }

  const finalizadoEn = new Date(Math.max(...filas.map((f) => (f.horaSalida ?? f.updatedAt).getTime())));
  if (!dentroDeVentanaRetoque(finalizadoEn, datos.ahora)) {
    throw new BadRequestException(
      `Ya pasó el plazo para agregar un retoque a la OT ${datos.ordenTrabajoOT}: terminó el ${fechaLegible(finVentanaRetoque(finalizadoEn))}.`,
    );
  }
}
