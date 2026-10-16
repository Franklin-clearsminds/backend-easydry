import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ALMACEN_ARCHIVO, PREFIJO_ARCHIVO, type AlmacenArchivo } from './almacen.js';
import { contarFilas, sha256 } from './parquet.js';

export interface ProblemaDeArchivo {
  clave: string;
  tabla: string;
  motivo: string;
}

export interface ResultadoVerificacion {
  corridaId: string;
  estado: 'OK' | 'ERROR';
  revisados: number;
  correctos: number;
  problemas: ProblemaDeArchivo[];
}

const POR_VERIFICACION = 200;

/**
 * Verificación periódica del archivo histórico. El archivador comprueba cada archivo UNA vez, justo después de subirlo y antes de
 * borrar de la base. Esto lo vuelve a comprobar con el tiempo: que siga en el bucket, que su huella y su número de filas sean los
 * registrados y que su manifiesto exista. Si alguien borra o altera un archivo a mano, se entera aquí y no el día que haga falta.
 *
 * Cada pasada revisa los lotes menos recientemente comprobados (hasta `maxLotes`), así que con el tiempo recorre todo el archivo
 * sin leer cientos de gigas de una vez.
 */
@Injectable()
export class VerificacionArchivadoService {
  private readonly logger = new Logger(VerificacionArchivadoService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ALMACEN_ARCHIVO) private readonly almacen: AlmacenArchivo,
  ) {}

  async verificar(opc: { maxLotes?: number; tablas?: string[]; soloLotes?: string[] } = {}): Promise<ResultadoVerificacion> {
    const corrida = await this.prisma.archivadoCorrida.create({ data: { simulacro: false } });
    const lotes = await this.prisma.archivadoLote.findMany({
      where: {
        estado: { in: ['BORRADO', 'VERIFICADO'] },
        ...(opc.tablas ? { tabla: { in: opc.tablas } } : {}),
        ...(opc.soloLotes ? { id: { in: opc.soloLotes } } : {}),
      },
      // Primero los que nunca se comprobaron y luego los comprobados hace más tiempo.
      orderBy: [{ verificadoEn: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
      take: opc.maxLotes ?? POR_VERIFICACION,
    });

    const problemas: ProblemaDeArchivo[] = [];
    for (const lote of lotes) {
      const motivo = await this.comprobar(lote);
      if (motivo) problemas.push({ clave: lote.clave, tabla: lote.tabla, motivo });
      await this.prisma.archivadoLote.update({ where: { id: lote.id }, data: { verificadoEn: new Date(), problema: motivo } });
    }

    const estado = problemas.length ? 'ERROR' : 'OK';
    const resumen = { _verificacion: { revisados: lotes.length, correctos: lotes.length - problemas.length, problemas } };
    await this.prisma.archivadoCorrida.update({
      where: { id: corrida.id },
      data: { fin: new Date(), estado, resumen: resumen as never, error: problemas.length ? problemas.map((p) => `${p.clave}: ${p.motivo}`).join('\n').slice(0, 4000) : null },
    });
    if (problemas.length) this.logger.error(`[Archivado] La verificación encontró ${problemas.length} problema(s) en ${lotes.length} archivos.`);
    return { corridaId: corrida.id, estado, revisados: lotes.length, correctos: lotes.length - problemas.length, problemas };
  }

  /** `null` si el archivo está bien; si no, qué le pasa. */
  private async comprobar(lote: { clave: string; sha256: string; filas: number }): Promise<string | null> {
    try {
      const archivo = await this.almacen.get(lote.clave);
      if (!archivo) return 'El archivo ya no está en el bucket.';
      if (sha256(archivo) !== lote.sha256) return 'La huella no coincide con la registrada: el archivo cambió o está dañado.';
      if (contarFilas(archivo) !== lote.filas) return 'El número de filas no coincide con el registrado.';
      const manifiesto = lote.clave.replace(`${PREFIJO_ARCHIVO}/`, `${PREFIJO_ARCHIVO}/_manifiestos/`).replace(/\.parquet$/, '.json');
      if (!(await this.almacen.get(manifiesto))) return 'Falta el manifiesto del lote.';
      return null;
    } catch (e: any) {
      return `No se pudo comprobar: ${e?.message ?? e}`;
    }
  }
}
