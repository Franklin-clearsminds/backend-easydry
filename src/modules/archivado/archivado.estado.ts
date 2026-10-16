import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { rolDeUsuario } from '../../common/permisos/alias-roles.js';
import { PrismaService } from '../prisma/prisma.service.js';

const ROLES_ESTADO = ['ADMIN', 'SUPER_ADMIN'];

/**
 * El estado del archivado, para que un administrador vea de un vistazo si el sistema hace su trabajo sin tocar la base: si está
 * encendido, cuándo corrió por última vez y cómo le fue, cuánto se ha archivado por tabla, y si hay algo que atender (lotes que
 * fallaron, pendientes viejos o problemas hallados por la verificación).
 */
@Injectable()
export class EstadoArchivadoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async estado(user: any) {
    if (!ROLES_ESTADO.includes(rolDeUsuario(user))) throw new ForbiddenException('El estado del archivado es solo para administradores.');

    const [porEstado, porTabla, recientes, candado, problemas, pendientesViejos, interrumpidas] = await Promise.all([
      this.prisma.archivadoLote.groupBy({ by: ['estado'], _count: { _all: true } }),
      this.prisma.archivadoLote.groupBy({ by: ['tabla'], where: { estado: 'BORRADO' }, _count: { _all: true }, _sum: { filas: true, bytes: true }, _min: { fechaMin: true }, _max: { fechaMax: true } }),
      this.prisma.archivadoCorrida.findMany({ orderBy: { inicio: 'desc' }, take: 50 }),
      this.prisma.$queryRaw<Array<{ propietario: string; hasta: Date }>>`SELECT propietario, hasta FROM archivado_candado WHERE id = 'archivado' AND hasta > (now() AT TIME ZONE 'UTC')`,
      this.prisma.archivadoLote.findMany({ where: { problema: { not: null } }, select: { tabla: true, clave: true, problema: true, verificadoEn: true }, orderBy: { verificadoEn: 'desc' }, take: 20 }),
      // Lotes subidos o verificados que nunca terminaron de borrarse de la base, con más de un día: algo los frenó.
      this.prisma.archivadoLote.count({ where: { estado: { in: ['SUBIDO', 'VERIFICADO'] }, createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
      // Corridas que figuran "en curso" desde hace más de una hora: el proceso se cayó sin cerrarlas (la próxima corrida real las cierra).
      this.prisma.archivadoCorrida.count({ where: { estado: 'EN_CURSO', inicio: { lt: new Date(Date.now() - 60 * 60 * 1000) } } }),
    ]);

    const esVerificacion = (r: { resumen: unknown }) => !!(r.resumen as any)?._verificacion;
    const ultimaCorrida = recientes.find((r) => !esVerificacion(r) && !r.simulacro) ?? null;
    const ultimoSimulacro = recientes.find((r) => !esVerificacion(r) && r.simulacro) ?? null;
    const ultimaVerificacion = recientes.find(esVerificacion) ?? null;
    const lotes = Object.fromEntries(porEstado.map((g) => [g.estado, g._count._all]));

    const resumirCorrida = (r: (typeof recientes)[number] | null) =>
      r && {
        id: r.id,
        inicio: r.inicio,
        fin: r.fin,
        estado: r.estado,
        error: r.error,
        tablas: esVerificacion(r)
          ? undefined
          : Object.fromEntries(Object.entries((r.resumen as Record<string, any>) ?? {}).map(([t, v]) => [t, { archivadas: v.archivadas, purgadas: v.purgadas, simuladas: v.simuladas, errores: v.errores?.length ?? 0 }])),
        verificacion: esVerificacion(r) ? { revisados: (r.resumen as any)._verificacion.revisados, problemas: (r.resumen as any)._verificacion.problemas.length } : undefined,
      };

    const tablas = porTabla
      .map((g) => ({ tabla: g.tabla, lotes: g._count._all, filas: g._sum.filas ?? 0, bytes: g._sum.bytes ?? 0, desde: g._min.fechaMin, hasta: g._max.fechaMax }))
      .sort((a, b) => a.tabla.localeCompare(b.tabla));

    const atencion: string[] = [];
    if (lotes['FALLIDO']) atencion.push(`${lotes['FALLIDO']} lote(s) fallido(s): no se leen y sus filas siguen en la base.`);
    if (pendientesViejos) atencion.push(`${pendientesViejos} lote(s) pendiente(s) desde hace más de un día: algo frenó su borrado.`);
    if (problemas.length) atencion.push(`${problemas.length} archivo(s) con problemas hallados por la verificación.`);
    if (interrumpidas) atencion.push(`${interrumpidas} corrida(s) figuran en curso desde hace más de una hora: el proceso se interrumpió sin cerrarlas.`);
    if (ultimaCorrida?.estado === 'ERROR') atencion.push('La última corrida terminó con errores.');
    if (ultimaVerificacion?.estado === 'ERROR') atencion.push('La última verificación encontró problemas.');

    return {
      configuracion: {
        activo: this.config.get<string>('ARCHIVADO_ACTIVO')?.trim() === 'true',
        // Mientras no se diga lo contrario, la corrida solo simula: informa qué haría sin subir ni borrar nada.
        simulacro: this.config.get<string>('ARCHIVADO_SIMULACRO')?.trim() !== 'false',
      },
      /** Si hay una corrida real en curso: el candado vence en `hasta` si no se renueva. */
      corriendoAhora: candado[0] ? { hasta: candado[0].hasta } : null,
      ultimaCorrida: resumirCorrida(ultimaCorrida),
      ultimoSimulacro: resumirCorrida(ultimoSimulacro),
      ultimaVerificacion: resumirCorrida(ultimaVerificacion),
      lotes,
      tablas,
      totales: { filas: tablas.reduce((a, t) => a + t.filas, 0), bytes: tablas.reduce((a, t) => a + t.bytes, 0), archivos: tablas.reduce((a, t) => a + t.lotes, 0) },
      problemas,
      atencion,
    };
  }
}
