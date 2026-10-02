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
    ['FOTO_INCIDENTE', 'MAQUINARIA_INCIDENTE', 'maquinaria/maq-1/incidentes/inc-1/reporte/multimedia/', 'image/jpeg'],
    ['DOCUMENTO_INCIDENTE', 'MAQUINARIA_INCIDENTE', 'maquinaria/maq-1/incidentes/inc-1/reporte/documento/', 'application/pdf'],
  ] as const)('construye la ruta oficial para %s', async (type, category, expectedPath, contentType) => {
    const result = await createService().buildS3Key({
      agenciaId: 'AGENCIA 01',
      clientUuid: 'OT-1',
      maquinariaId: 'MAQ-1',
      incidenteId: 'INC-1',
      type,
      category,
    });
    expect(result.key).toContain(expectedPath);
    expect(result.contentType).toBe(contentType);
  });

  it('guarda foto y ficha de maquinaria en una carpeta fija del equipo', async () => {
    const foto = await createService().buildS3Key({
      maquinariaCodigo: 'MQ-HIDRO-01',
      maquinariaNombre: 'Hidrolavadora Costa',
      type: 'FOTO_MAQUINA',
      category: 'MAQUINARIA_IMAGEN',
      fileName: 'equipo.jpg',
    });
    const ficha = await createService().buildS3Key({
      maquinariaCodigo: 'MQ-HIDRO-01',
      type: 'FICHA_TECNICA',
      category: 'MAQUINARIA_FICHA',
      fileName: 'ficha.png',
    });
    expect(foto.key).toContain('maquinaria/mq-hidro-01/perfil/foto/');
    expect(ficha.key).toContain('maquinaria/mq-hidro-01/perfil/ficha-tecnica/');
    // Fuera de las agencias: la ruta nunca depende de dónde esté la máquina
    expect(foto.key.startsWith('maquinaria/')).toBe(true);
  });

  it('guarda las fotos de limpieza en una carpeta por día dentro del equipo', async () => {
    const limpieza = await createService().buildS3Key({
      maquinariaCodigo: 'MQ-HIDRO-01',
      type: 'FOTO_LIMPIEZA',
      category: 'MAQUINARIA_LIMPIEZA',
      fileName: 'limpieza.jpg',
    });
    expect(limpieza.key).toMatch(/^maquinaria\/mq-hidro-01\/limpiezas\/\d{4}-\d{2}-\d{2}\//);
  });

  it('separa evidencias de reporte y de reparación del mismo incidente', async () => {
    const resolucion = await createService().buildS3Key({
      maquinariaCodigo: 'MQ-HIDRO-01',
      incidenteId: 'INC-9',
      incidenteFase: 'resoluciones',
      type: 'FOTO_INCIDENTE',
      category: 'MAQUINARIA_INCIDENTE',
    });
    expect(resolucion.key).toContain('maquinaria/mq-hidro-01/incidentes/inc-9/reparacion/multimedia/');
  });

  it('ordena la evidencia de un mantenimiento por máquina y por mantenimiento', async () => {
    const video = await createService().buildS3Key({
      maquinariaCodigo: 'MQ-HIDRO-01',
      mantenimientoId: 'MANT-3',
      type: 'VIDEO_INCIDENTE',
      category: 'MAQUINARIA_MANTENIMIENTO',
    });
    const doc = await createService().buildS3Key({
      maquinariaCodigo: 'MQ-HIDRO-01',
      mantenimientoId: 'MANT-3',
      type: 'DOCUMENTO',
      category: 'MAQUINARIA_MANTENIMIENTO',
    });
    expect(video.key).toContain('maquinaria/mq-hidro-01/mantenimientos/mant-3/multimedia/');
    expect(doc.key).toContain('maquinaria/mq-hidro-01/mantenimientos/mant-3/documento/');
    expect(doc.key).toMatch(/_documento_[0-9a-f]{8}\.pdf$/);
  });

  it('extrae la clave S3 de una URL pública o del proxy /storage/file', () => {
    const service = createService();
    const key = 'maquinaria/mq-01/incidentes/i1/reporte/multimedia/x.jpg';
    expect(service.keyFromUrl(`https://easydry-storage-test.s3.us-east-1.amazonaws.com/${key}`)).toBe(key);
    expect(service.keyFromUrl(`https://api.example.com/storage/file?key=${encodeURIComponent(key)}`)).toBe(key);
    expect(service.keyFromUrl('https://otro-sitio.com/foto.jpg')).toBeNull();
    expect(service.maquinariaPrefix('MQ 01')).toBe('maquinaria/mq-01/');
  });

  it('guarda la foto de perfil en una ruta fija por usuario', async () => {
    const userId = '16f400ca-04b5-40a2-af7f-becfd850037c';
    const result = await createService().buildS3Key({
      userId,
      clientUuid: userId,
      type: 'FOTO_PERFIL',
      category: 'PERFIL_USUARIO',
      fileName: 'cualquier-nombre.png',
    });
    expect(result.key).toBe(`usuarios/${userId}/perfil/avatar.jpg`);
    expect(result.contentType).toBe('image/jpeg');
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
