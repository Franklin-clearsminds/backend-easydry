import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Si `DATABASE_URL` no trae `connection_limit`/`pool_timeout` (p.ej. porque se pegó tal cual desde el dashboard
 * de Supabase), se les pone un valor conservador por código: sin esto, Prisma abre hasta `num_cpus*2+1` conexiones
 * por instancia, lo que con el Session Pooler de Supabase (un slot de su pool por conexión) puede agotar el cupo
 * del plan free si hay más de una instancia o algún script corriendo a la vez.
 */
function conUrlDeConexionAcotada(url: string | undefined): string | undefined {
  if (!url) return url;
  try {
    const u = new URL(url);
    if (!u.searchParams.has('connection_limit')) u.searchParams.set('connection_limit', '5');
    if (!u.searchParams.has('pool_timeout')) u.searchParams.set('pool_timeout', '20');
    return u.toString();
  } catch {
    return url;
  }
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({ datasources: { db: { url: conUrlDeConexionAcotada(process.env.DATABASE_URL) } } });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      // Prueba activa de consulta para asegurar que PostgreSQL responde
      await this.$queryRaw`SELECT 1`;
      // Abre unas conexiones de más ahora: abrir una conexión nueva cuesta ~100 ms y, sin esto, la primera vez que el inicio de sesión
      // hace consultas en paralelo cada una la pagaría.
      await Promise.all([this.$queryRaw`SELECT 1`, this.$queryRaw`SELECT 1`, this.$queryRaw`SELECT 1`]);
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

