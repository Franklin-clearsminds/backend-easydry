import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RetosModule } from '../retos/retos.module.js';
import { ArchivadoModule } from '../archivado/archivado.module.js';
import { ReportesArchivoService } from './reportes.archivo.js';
import { ReportesController } from './reportes.controller.js';
import { ReportesService } from './reportes.service.js';

@Module({
  imports: [PrismaModule, RetosModule, ArchivadoModule],
  controllers: [ReportesController],
  providers: [ReportesService, ReportesArchivoService],
})
export class ReportesModule {}
