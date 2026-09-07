import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './modules/prisma/prisma.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { SyncModule } from './modules/sync/sync.module.js';
import { CatalogosModule } from './modules/catalogos/catalogos.module.js';
import { OperacionesModule } from './modules/operaciones/operaciones.module.js';
import { RolesModule } from './modules/roles/roles.module.js';
import { CryptoModule } from './common/crypto/crypto.module.js';
import { InventarioModule } from './modules/inventario/inventario.module.js';
import { AgenciasModule } from './modules/agencias/agencias.module.js';
import { MaquinariaModule } from './modules/maquinaria/maquinaria.module.js';
import { AnalyticsModule } from './modules/analytics/analytics.module.js';
import { StorageModule } from './modules/storage/storage.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { AprobacionesModule } from './modules/aprobaciones/aprobaciones.module.js';
import { AppScheduleModule } from './modules/schedule/schedule.module.js';
import { DeviceThrottlerGuard } from './common/guards/throttler-behind-proxy.guard.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // Ventana de 1 minuto
        limit: 120, // 120 peticiones/minuto por tracker (dispositivo/usuario)
      },
    ]),
    PrismaModule,
    CryptoModule,
    StorageModule,
    NotificationsModule,
    AppScheduleModule,
    AuthModule,
    SyncModule,
    CatalogosModule,
    OperacionesModule,
    RolesModule,
    InventarioModule,
    AgenciasModule,
    MaquinariaModule,
    AnalyticsModule,
    AprobacionesModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: DeviceThrottlerGuard,
    },
  ],
})
export class AppModule {}
