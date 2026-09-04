import { Module } from '@nestjs/common';
import { AgenciasService } from './agencias.service.js';
import { AgenciasController } from './agencias.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [AgenciasController],
  providers: [AgenciasService],
  exports: [AgenciasService],
})
export class AgenciasModule {}
