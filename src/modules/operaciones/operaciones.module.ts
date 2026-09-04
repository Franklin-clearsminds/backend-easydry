import { Module } from '@nestjs/common';
import { OperacionesController } from './operaciones.controller.js';
import { OperacionesService } from './operaciones.service.js';

@Module({
  controllers: [OperacionesController],
  providers: [OperacionesService],
  exports: [OperacionesService],
})
export class OperacionesModule {}
