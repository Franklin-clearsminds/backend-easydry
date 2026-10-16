import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ALMACEN_ARCHIVO, AlmacenS3 } from './almacen.js';
import { ArchivadoCronService } from './archivado.cron.js';
import { ArchivadoController } from './archivado.controller.js';
import { EstadoArchivadoService } from './archivado.estado.js';
import { ArchivadoService } from './archivado.service.js';
import { VerificacionArchivadoService } from './archivado.verificacion.js';
import { LECTOR_ARCHIVO } from './archivo-lector.js';
import { HistoricoService } from './historico.service.js';
import { LectorDuckDb } from './lector-duckdb.js';

@Module({
  imports: [PrismaModule],
  controllers: [ArchivadoController],
  providers: [
    ArchivadoService,
    VerificacionArchivadoService,
    EstadoArchivadoService,
    ArchivadoCronService,
    HistoricoService,
    { provide: ALMACEN_ARCHIVO, useClass: AlmacenS3 },
    { provide: LECTOR_ARCHIVO, useClass: LectorDuckDb },
  ],
  exports: [ArchivadoService, HistoricoService],
})
export class ArchivadoModule {}
