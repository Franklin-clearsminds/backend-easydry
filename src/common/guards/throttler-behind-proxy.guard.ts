import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** Rutas públicas de autenticación: ahí el límite se cuenta SOLO por IP, porque todo lo que manda el cliente puede falsificarse. */
const RUTAS_AUTENTICACION = /\/auth\/(login|refresh|logout)(?:\?|$)/;

@Injectable()
export class DeviceThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    // `req.ip` respeta la configuración `trust proxy` de Express (variable TRUST_PROXY); no se lee `X-Forwarded-For` a mano,
    // porque cualquiera puede mandar esa cabecera y saltarse el límite.
    const ip = `ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
    if (RUTAS_AUTENTICACION.test(req.originalUrl ?? req.url ?? '')) return ip;

    // Resto de rutas (requieren JWT válido): el dispositivo evita que una oficina entera compartiendo IP se limite entre sí.
    const deviceId = req.headers?.['x-device-id'] || req.body?.deviceId;
    if (deviceId) return `device:${deviceId}`;

    return ip;
  }
}
