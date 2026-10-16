import { Module } from '@nestjs/common';
import { ArchivadoModule } from '../archivado/archivado.module.js';
import { OperacionesController } from './operaciones.controller.js';
import { OperacionesService } from './operaciones.service.js';
import { ServiciosEspecialesController } from './servicios-especiales.controller.js';
import { ServiciosEspecialesService } from './servicios-especiales.service.js';

@Module({
  imports: [ArchivadoModule],
  controllers: [OperacionesController, ServiciosEspecialesController],
  providers: [OperacionesService, ServiciosEspecialesService],
  exports: [OperacionesService, ServiciosEspecialesService],
})
export class OperacionesModule {}
