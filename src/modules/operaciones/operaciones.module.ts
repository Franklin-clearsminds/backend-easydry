import { Module } from '@nestjs/common';
import { OperacionesController } from './operaciones.controller.js';
import { OperacionesService } from './operaciones.service.js';
import { ServiciosEspecialesController } from './servicios-especiales.controller.js';
import { ServiciosEspecialesService } from './servicios-especiales.service.js';

@Module({
  controllers: [OperacionesController, ServiciosEspecialesController],
  providers: [OperacionesService, ServiciosEspecialesService],
  exports: [OperacionesService, ServiciosEspecialesService],
})
export class OperacionesModule {}
