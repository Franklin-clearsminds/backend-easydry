import { Module } from '@nestjs/common';
import { ScheduleModule as NestScheduleModule } from '@nestjs/schedule';
import { MaintenanceCronService } from './maintenance-cron.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [
    NestScheduleModule.forRoot(),
    PrismaModule,
  ],
  providers: [MaintenanceCronService],
  exports: [MaintenanceCronService],
})
export class AppScheduleModule {}
