import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class DeviceThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    // Si viene identificado por dispositivo móvil (Header o Body)
    const deviceId = req.headers?.['x-device-id'] || req.body?.deviceId;
    if (deviceId) {
      return `device:${deviceId}`;
    }

    // Si viene usuario autenticado por JWT
    if (req.user?.id) {
      return `user:${req.user.id}`;
    }

    // Fallback a IP del cliente (considerando proxies/balanceadores)
    const forwarded = req.headers?.['x-forwarded-for'];
    const ip = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.ip || req.connection?.remoteAddress || 'unknown';
    return `ip:${ip}`;
  }
}
