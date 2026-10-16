import { Module } from '@nestjs/common';
import { ArchivadoModule } from '../archivado/archivado.module.js';
import { InventarioController } from './inventario.controller.js';
import { InventarioService } from './inventario.service.js';

@Module({
  imports: [ArchivadoModule],
  controllers: [InventarioController],
  providers: [InventarioService],
  exports: [InventarioService],
})
export class InventarioModule {}
