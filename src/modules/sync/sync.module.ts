
import { Module } from '@nestjs/common';
import { SyncController } from './sync.controller.js';
import { SyncService } from './sync.service.js';
import { OperacionesModule } from '../operaciones/operaciones.module.js';
import { StorageModule } from '../storage/storage.module.js';

@Module({
  imports: [OperacionesModule, StorageModule],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
