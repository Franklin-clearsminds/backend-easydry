import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ArchivadoService, type ResultadoCorrida } from './archivado.service.js';
import { VerificacionArchivadoService, type ResultadoVerificacion } from './archivado.verificacion.js';

/**
 * Corrida semanal del archivado (domingo 03:00). Apagada por defecto:
 *  - ARCHIVADO_ACTIVO=true la enciende;
 *  - ARCHIVADO_SIMULACRO=false hace que suba y borre de verdad (por defecto solo informa qué haría).
 * Antes de la primera corrida real hay que tener un respaldo completo de la base.
 */
@Injectable()
export class ArchivadoCronService {
  private readonly logger = new Logger(ArchivadoCronService.name);
  private enCurso = false;

  constructor(
    private readonly archivado: ArchivadoService,
    private readonly verificacion: VerificacionArchivadoService,
    private readonly notificaciones: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  @Cron('0 3 * * 0')
  async semanal(): Promise<ResultadoCorrida | null> {
    if (this.config.get<string>('ARCHIVADO_ACTIVO')?.trim() !== 'true') return null;
    if (this.enCurso) return null;
    this.enCurso = true;
    try {
      const simulacro = this.config.get<string>('ARCHIVADO_SIMULACRO')?.trim() !== 'false';
      this.logger.log(`[Archivado] Inicio de corrida${simulacro ? ' (simulacro)' : ''}.`);
      const resultado = await this.archivado.ejecutar({ simulacro });
      if (resultado.omitida) {
        this.logger.log('[Archivado] Otra instancia ya estaba archivando: esta corrida no hizo nada.');
        return resultado;
      }
      const resumen = Object.entries(resultado.tablas)
        .map(([t, r]) => `${t}: ${simulacro ? `${r.simuladas} por archivar` : `${r.archivadas} archivadas, ${r.purgadas} purgadas`}`)
        .join(' | ');
      this.logger.log(`[Archivado] Corrida ${resultado.estado}. ${resumen}`);
      if (resultado.estado === 'ERROR') await this.avisarFallo(resultado);
      return resultado;
    } catch (e: any) {
      this.logger.error(`[Archivado] La corrida no pudo ejecutarse: ${e?.message ?? e}`);
      return null;
    } finally {
      this.enCurso = false;
    }
  }

  /** Domingo 04:00, después del archivado: vuelve a comprobar que los archivos sigan íntegros en el bucket. */
  @Cron('0 4 * * 0')
  async verificacionSemanal(): Promise<ResultadoVerificacion | null> {
    if (this.config.get<string>('ARCHIVADO_ACTIVO')?.trim() !== 'true') return null;
    try {
      const resultado = await this.verificacion.verificar();
      this.logger.log(`[Archivado] Verificación ${resultado.estado}: ${resultado.correctos} de ${resultado.revisados} archivos correctos.`);
      if (resultado.estado === 'ERROR') {
        const destinatarios = await this.notificaciones.resolverDestinatariosPorRol({ global: ['SUPER_ADMIN'] });
        await this.notificaciones.notificarUsuarios(
          destinatarios,
          'Problema en el archivo histórico',
          `La verificación semanal encontró ${resultado.problemas.length} archivo(s) con problemas (ausentes o alterados). Revisa el estado del archivado.`,
          { type: 'ARCHIVADO_FALLIDO', corridaId: resultado.corridaId },
          { tipo: 'ARCHIVADO_FALLIDO', entidadTipo: 'ARCHIVADO_CORRIDA', entidadId: resultado.corridaId },
        );
      }
      return resultado;
    } catch (e: any) {
      this.logger.error(`[Archivado] La verificación no pudo ejecutarse: ${e?.message ?? e}`);
      return null;
    }
  }

  private async avisarFallo(resultado: ResultadoCorrida): Promise<void> {
    const tablas = Object.entries(resultado.tablas)
      .filter(([, r]) => r.errores.length)
      .map(([t]) => t)
      .join(', ');
    const destinatarios = await this.notificaciones.resolverDestinatariosPorRol({ global: ['SUPER_ADMIN'] });
    await this.notificaciones.notificarUsuarios(
      destinatarios,
      'Falló el archivado de datos',
      `La corrida semanal terminó con errores en: ${tablas}. Lo que no se pudo verificar no se borró de la base.`,
      { type: 'ARCHIVADO_FALLIDO', corridaId: resultado.corridaId },
      { tipo: 'ARCHIVADO_FALLIDO', entidadTipo: 'ARCHIVADO_CORRIDA', entidadId: resultado.corridaId },
    );
  }
}
