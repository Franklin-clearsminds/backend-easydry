import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CacheService } from '../../common/cache/cache.service.js';
import { HorariosService } from './horarios.service.js';
import { TareasService } from './tareas.service.js';

@Injectable()
export class RrhhCronService {
  private readonly logger = new Logger(RrhhCronService.name);

  constructor(
    private readonly tareas: TareasService,
    private readonly horarios: HorariosService,
    @Optional() private readonly cache?: CacheService,
  ) {}

  /** Todos los días a las 06:30: avisa de las tareas vencidas (una sola vez por tarea). Con varias instancias, solo una lo ejecuta. */
  @Cron('30 6 * * *', { timeZone: 'America/Guayaquil' })
  async programado_avisarTareasVencidas(): Promise<void> {
    const tarea = async () => {
      try {
        await this.tareas.avisarVencidas();
      } catch (e: any) {
        this.logger.error(`No se pudieron avisar las tareas vencidas: ${e?.message || e}`);
      }
    };
    if (this.cache) await this.cache.unaVez('cron:rrhhTareasVencidas', 3600, tarea);
    else await tarea();
  }

  /** Cada 5 minutos: avisa de quien ya no puede marcar su entrada o su salida de hoy (una sola vez por persona, día y situación). */
  @Cron('*/5 * * * *', { timeZone: 'America/Guayaquil' })
  async programado_revisarHorarios(): Promise<void> {
    const tarea = async () => {
      try {
        await this.horarios.revisarIncidencias();
      } catch (e: any) {
        this.logger.error(`No se pudieron revisar las incidencias de horario: ${e?.message || e}`);
      }
    };
    if (this.cache) await this.cache.unaVez('cron:rrhhHorarios', 240, tarea);
    else await tarea();
  }
}
