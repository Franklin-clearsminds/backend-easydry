import { Module } from '@nestjs/common';
import { AprobacionesController } from './aprobaciones.controller.js';
import { AprobacionesService } from './aprobaciones.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [AprobacionesController],
  providers: [AprobacionesService],
  exports: [AprobacionesService],
})
export class AprobacionesModule {}
