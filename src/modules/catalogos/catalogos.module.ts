import { Module } from '@nestjs/common';
import { CatalogosService } from './catalogos.service.js';

@Module({
  controllers: [],
  providers: [CatalogosService],
  exports: [CatalogosService],
})
export class CatalogosModule {}
