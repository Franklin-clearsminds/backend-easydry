import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { Auditoria5sController } from './auditoria5s.controller.js';
import { Auditoria5sService } from './auditoria5s.service.js';
import { InformesInspeccionController } from './informes.controller.js';
import { InformesInspeccionService } from './informes.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [InformesInspeccionController, Auditoria5sController],
  providers: [InformesInspeccionService, Auditoria5sService],
  exports: [InformesInspeccionService, Auditoria5sService],
})
export class AuditoriasModule {}
