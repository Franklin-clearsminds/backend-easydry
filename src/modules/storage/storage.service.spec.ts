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

  it('conserva contenedor MOV y MIME real en videos seleccionados desde iOS', async () => {
    const result = await createService().buildS3Key({
      agenciaId: 'AGENCIA 01',
      servicioId: 'OT-2026-100',
      clientUuid: 'uuid-local',
      type: 'VIDEO_INICIAL',
      category: 'SERVICIOS_ESPECIALES',
      fileName: 'captura.mov',
    });

    expect(result.key).toContain('agencias/agencia-01/servicios/especiales/ot-2026-100/videos/inicial/');
    expect(result.key).toMatch(/\.mov$/);
    expect(result.contentType).toBe('video/quicktime');
  });

  it('conserva la extensión y el MIME real de una fotografía PNG', async () => {
    const result = await createService().buildS3Key({
      agenciaId: 'AGENCIA 01',
      servicioId: 'OT-2026-101',
      clientUuid: 'uuid-local',
      type: 'FOTO_INGRESO',
      category: 'SERVICIOS_GENERALES',
      fileName: 'captura.png',
    });

    expect(result.key).toMatch(/\.png$/);
    expect(result.contentType).toBe('image/png');
  });

  it('acepta solamente URLs públicas pertenecientes al bucket configurado', () => {
    const service = createService();
    expect(service.isManagedPublicUrl(
      'https://easydry-storage-test.s3.us-east-1.amazonaws.com/agencias/agencia-01/foto.jpg',
    )).toBe(true);
    expect(service.isManagedPublicUrl('https://images.unsplash.com/foto.jpg')).toBe(false);
    expect(service.isManagedPublicUrl('file:///data/user/0/foto.jpg')).toBe(false);
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
