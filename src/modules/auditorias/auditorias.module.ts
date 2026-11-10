import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RrhhModule } from '../rrhh/rrhh.module.js';
import { Auditoria5sController } from './auditoria5s.controller.js';
import { Auditoria5sService } from './auditoria5s.service.js';
import { InformesInspeccionController } from './informes.controller.js';
import { InformesInspeccionService } from './informes.service.js';
import { SellosController } from './sellos.controller.js';
import { SellosService } from './sellos.service.js';

@Module({
  imports: [PrismaModule, RrhhModule],
  controllers: [InformesInspeccionController, Auditoria5sController, SellosController],
  providers: [InformesInspeccionService, Auditoria5sService, SellosService],
  exports: [InformesInspeccionService, Auditoria5sService, SellosService],
})
export class AuditoriasModule {}
