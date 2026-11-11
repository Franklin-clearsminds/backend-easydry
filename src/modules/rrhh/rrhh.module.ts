import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { RrhhController } from './rrhh.controller.js';
import { HorariosService } from './horarios.service.js';
import { RrhhCronService } from './rrhh.cron.js';
import { TareasService } from './tareas.service.js';
import { TimbradasService } from './timbradas.service.js';
import { UbicacionesService } from './ubicaciones.service.js';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [RrhhController],
  providers: [TimbradasService, TareasService, UbicacionesService, HorariosService, RrhhCronService],
  exports: [TareasService],
})
export class RrhhModule {}
