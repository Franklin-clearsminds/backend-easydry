import { Module } from '@nestjs/common';
import { ArchivadoModule } from '../archivado/archivado.module.js';
import { RetosController } from './retos.controller.js';
import { RetosService } from './retos.service.js';

@Module({
  imports: [ArchivadoModule],
  controllers: [RetosController],
  providers: [RetosService],
  exports: [RetosService],
})
export class RetosModule {}
