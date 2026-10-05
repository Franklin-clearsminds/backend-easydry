import { Module } from '@nestjs/common';
import { MaquinariaController } from './maquinaria.controller.js';
import { MaquinariaService } from './maquinaria.service.js';
import { ChecklistService } from './checklist.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { StorageModule } from '../storage/storage.module.js';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [MaquinariaController],
  providers: [MaquinariaService, ChecklistService],
  exports: [MaquinariaService, ChecklistService],
})
export class MaquinariaModule {}
