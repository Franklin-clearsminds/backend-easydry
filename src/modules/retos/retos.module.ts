import { Module } from '@nestjs/common';
import { RetosController } from './retos.controller.js';
import { RetosService } from './retos.service.js';

@Module({
  controllers: [RetosController],
  providers: [RetosService],
  exports: [RetosService],
})
export class RetosModule {}
