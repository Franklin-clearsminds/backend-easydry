import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    try {
      await this.$connect();
      // Prueba activa de consulta para asegurar que PostgreSQL responde
      await this.$queryRaw`SELECT 1`;
      this.logger.log('Conexión con PostgreSQL establecida y verificada correctamente (DB: easydry_db).');
    } catch (error: any) {
      this.logger.error('Error al conectar con la base de datos PostgreSQL:', error?.message || error);
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Desconectado de la base de datos PostgreSQL.');
  }
}

