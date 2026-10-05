import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { rolDeUsuario } from '../../common/permisos/alias-roles.js';

export const TIPOS_CHECKLIST = ['PREVENTIVO', 'CORRECTIVO'] as const;
export type TipoChecklist = (typeof TIPOS_CHECKLIST)[number];

const MAX_PASOS = 30;
const TEXTO_MIN = 3;
const TEXTO_MAX = 300;

export interface PasoPlantillaDto {
  texto: string;
  obligatorio?: boolean;
}

/**
 * Checklist de mantenimiento: plantillas por tipo (versionadas) y lo que el técnico marca en cada orden.
 *
 * - Editar una plantilla crea una versión nueva; la anterior queda inactiva y lo ya marcado en órdenes anteriores no cambia
 *   (cada orden guarda una copia del texto de sus pasos).
 * - Una orden toma los pasos de la plantilla activa de su tipo la primera vez que se consulta o se intenta cerrar.
 * - No se puede cerrar una orden mientras haya pasos obligatorios sin marcar. Si el tipo no tiene plantilla, se cierra como siempre.
 */
@Injectable()
export class ChecklistService {
  constructor(private readonly prisma: PrismaService) {}

  private tipoValido(tipo: unknown): TipoChecklist {
    const t = String(tipo ?? '').trim().toUpperCase();
    if (!(TIPOS_CHECKLIST as readonly string[]).includes(t)) {
      throw new BadRequestException(`El tipo de mantenimiento debe ser ${TIPOS_CHECKLIST.join(' o ')}.`);
    }
    return t as TipoChecklist;
  }

  /** Plantillas activas (una por tipo) con sus pasos ordenados. */
  async listarPlantillas() {
    return this.prisma.checklistPlantilla.findMany({
      where: { activa: true },
      include: { pasos: { orderBy: { orden: 'asc' } } },
      orderBy: { tipo: 'asc' },
    });
  }

  /** Guarda los pasos de un tipo como una versión nueva y desactiva la anterior. */
  async guardarPlantilla(dto: { tipo: string; nombre?: string; pasos: PasoPlantillaDto[] }, actor: any) {
    const tipo = this.tipoValido(dto.tipo);
    const pasos = (dto.pasos ?? []).map((p) => ({ texto: String(p?.texto ?? '').trim(), obligatorio: p?.obligatorio !== false }));
    if (pasos.length === 0) throw new BadRequestException('La plantilla necesita al menos un paso.');
    if (pasos.length > MAX_PASOS) throw new BadRequestException(`Una plantilla admite hasta ${MAX_PASOS} pasos.`);
    const malo = pasos.findIndex((p) => p.texto.length < TEXTO_MIN || p.texto.length > TEXTO_MAX);
    if (malo >= 0) throw new BadRequestException(`El paso ${malo + 1} debe tener entre ${TEXTO_MIN} y ${TEXTO_MAX} caracteres.`);

    const nombre = dto.nombre?.trim() || `Checklist ${tipo === 'PREVENTIVO' ? 'preventivo' : 'correctivo'}`;
    const creadaPorNombre = [actor?.name, actor?.lastname].filter(Boolean).join(' ').trim() || actor?.email || null;

    return this.prisma.$transaction(async (tx) => {
      const ultima = await tx.checklistPlantilla.findFirst({ where: { tipo }, orderBy: { version: 'desc' }, select: { version: true } });
      await tx.checklistPlantilla.updateMany({ where: { tipo, activa: true }, data: { activa: false } });
      return tx.checklistPlantilla.create({
        data: {
          tipo,
          nombre,
          version: (ultima?.version ?? 0) + 1,
          activa: true,
          creadaPorId: actor?.id ? String(actor.id) : null,
          creadaPorNombre,
          pasos: { create: pasos.map((p, i) => ({ orden: i + 1, texto: p.texto, obligatorio: p.obligatorio })) },
        },
        include: { pasos: { orderBy: { orden: 'asc' } } },
      });
    });
  }

  /**
   * Los pasos de una orden. La primera vez se copian de la plantilla activa de su tipo. Devuelve también si ya se puede cerrar.
   */
  async obtenerDeMantenimiento(mantenimientoId: string, tipo: string) {
    const existentes = await this.prisma.checklistRespuesta.findMany({ where: { mantenimientoId }, orderBy: { orden: 'asc' } });
    let filas = existentes;
    if (existentes.length === 0) {
      const plantilla = await this.prisma.checklistPlantilla.findFirst({
        where: { tipo: this.tipoValido(tipo), activa: true },
        include: { pasos: { orderBy: { orden: 'asc' } } },
      });
      if (plantilla && plantilla.pasos.length) {
        await this.prisma.checklistRespuesta.createMany({
          data: plantilla.pasos.map((p) => ({
            mantenimientoId,
            plantillaId: plantilla.id,
            plantillaVersion: plantilla.version,
            orden: p.orden,
            texto: p.texto,
            obligatorio: p.obligatorio,
          })),
        });
        filas = await this.prisma.checklistRespuesta.findMany({ where: { mantenimientoId }, orderBy: { orden: 'asc' } });
      }
    }
    const pendientes = filas.filter((f) => f.obligatorio && !f.completado).length;
    return { pasos: filas, requerido: filas.length > 0, obligatoriosPendientes: pendientes, completo: pendientes === 0 };
  }

  /** Marca o desmarca un paso; guarda quién y cuándo. */
  async marcar(dto: { mantenimientoId: string; pasoId: string; completado: boolean; observacion?: string }, actor: any) {
    const paso = await this.prisma.checklistRespuesta.findUnique({ where: { id: dto.pasoId } });
    if (!paso || paso.mantenimientoId !== dto.mantenimientoId) throw new NotFoundException('Paso del checklist no encontrado.');
    const observacion = dto.observacion?.trim() || null;
    const completado = dto.completado === true;
    return this.prisma.checklistRespuesta.update({
      where: { id: paso.id },
      data: {
        completado,
        observacion,
        marcadoPorId: completado ? String(actor.id) : null,
        marcadoPorNombre: completado ? [actor?.name, actor?.lastname].filter(Boolean).join(' ').trim() || actor?.email || rolDeUsuario(actor) : null,
        marcadoEn: completado ? new Date() : null,
      },
    });
  }

  /** Impide cerrar la orden si hay pasos obligatorios sin marcar. Sin plantilla para el tipo, no exige nada. */
  async exigirCompleto(mantenimientoId: string, tipo: string): Promise<void> {
    const c = await this.obtenerDeMantenimiento(mantenimientoId, tipo);
    if (!c.requerido || c.completo) return;
    const faltan = c.pasos.filter((p) => p.obligatorio && !p.completado).map((p) => `${p.orden}. ${p.texto}`);
    throw new BadRequestException(`No se puede cerrar la orden: faltan pasos obligatorios del checklist:\n${faltan.join('\n')}`);
  }

  /** Solo el técnico asignado o un administrador marcan pasos (misma regla que ejecutar la orden). */
  asegurarPuedeMarcar(mantenimiento: { tecnicoId: string; estado: string }, actor: any): void {
    if (mantenimiento.estado === 'FINALIZADO') throw new BadRequestException('El mantenimiento ya fue ejecutado: el checklist no se puede modificar.');
    if (mantenimiento.tecnicoId !== String(actor?.id) && !['SUPER_ADMIN', 'ADMIN'].includes(rolDeUsuario(actor))) {
      throw new ForbiddenException('Solo el técnico asignado puede marcar el checklist de esta orden.');
    }
  }
}
