import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { StorageService } from './storage.service.js';

function createService(overrides?: Record<string, string>) {
  const config: Record<string, string> = {
    AWS_REGION: 'us-east-1',
    AWS_S3_BUCKET_NAME: 'easydry-storage-test',
    AWS_ACCESS_KEY_ID: 'test-access-key',
    AWS_SECRET_ACCESS_KEY: 'test-secret-key',
    ...overrides,
  };
  return new StorageService({
    get: (key: string) => config[key] ?? null,
  } as unknown as ConfigService);
}

describe('StorageService', () => {
  it.each([
    ['VIDEO_INICIAL', 'SERVICIOS_GENERALES', 'servicios/generales/ot-1/videos/inicial/', 'video/mp4'],
    ['VIDEO_FINAL', 'SERVICIOS_ESPECIALES', 'servicios/especiales/ot-1/videos/final/', 'video/mp4'],
    ['FOTO_INCIDENTE', 'MAQUINARIA_INCIDENTE', 'maquinaria/maq-1/incidentes/inc-1/fotos/', 'image/jpeg'],
    ['DOCUMENTO_INCIDENTE', 'MAQUINARIA_INCIDENTE', 'maquinaria/maq-1/incidentes/inc-1/documentos/', 'application/pdf'],
  ] as const)('construye la ruta oficial para %s', async (type, category, expectedPath, contentType) => {
    const result = await createService().buildS3Key({
      agenciaId: 'AGENCIA 01',
      clientUuid: 'OT-1',
      maquinariaId: 'MAQ-1',
      incidenteId: 'INC-1',
      type,
      category,
    });
    expect(result.key).toContain(`agencias/agencia-01/${expectedPath}`);
    expect(result.contentType).toBe(contentType);
  });

  it('rechaza combinaciones de tipo y categoría incompatibles', async () => {
    await expect(createService().buildS3Key({
      type: 'DOCUMENTO_INCIDENTE',
      category: 'SERVICIOS_GENERALES',
    })).rejects.toThrow(BadRequestException);
  });

  it('rechaza iniciar sin la configuración mínima de S3', () => {
    expect(() => new StorageService({ get: () => null } as unknown as ConfigService)).toThrow(/AWS_REGION/);
    expect(() => new StorageService(new ConfigService({
      AWS_REGION: '',
      AWS_S3_BUCKET_NAME: '',
    }))).toThrow(/AWS_REGION/);
    expect(() => new StorageService({
      get: (key: string) => ({
        AWS_REGION: 'us-east-1',
        AWS_S3_BUCKET_NAME: 'bucket',
        AWS_ACCESS_KEY_ID: 'incomplete',
      }[key] ?? null),
    } as unknown as ConfigService)).toThrow(/deben configurarse juntos/);
    expect(() => new StorageService(new ConfigService({
      AWS_REGION: 'us-east-1',
      AWS_S3_BUCKET_NAME: 'bucket',
      AWS_ACCESS_KEY_ID: 'incomplete',
      AWS_SECRET_ACCESS_KEY: '',
    }))).toThrow(/deben configurarse juntos/);
  });
});
