import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ArchivadoModule } from '../archivado/archivado.module.js';

@Module({
  imports: [PrismaModule, ArchivadoModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
