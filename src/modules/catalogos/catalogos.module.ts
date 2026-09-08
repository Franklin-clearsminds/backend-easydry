import { Module } from '@nestjs/common';
import { CatalogosService } from './catalogos.service.js';
import { CatalogosController } from './catalogos.controller.js';

@Module({
  controllers: [CatalogosController],
  providers: [CatalogosService],
  exports: [CatalogosService],
})
export class CatalogosModule {}
