import { describe, expect, it } from 'vitest';
import { serializeServicioLavado } from './servicio-serializer.util.js';

const baseService = {
  id: 'service-1',
  clientUuid: 'client-1',
  ordenTrabajoOT: 'OT-1',
  placa: 'ABC-1234',
  modelo: 'Rav4',
  estado: 'EN_PROCESO',
  horaIngreso: new Date('2026-09-23T12:00:00.000Z'),
  createdAt: new Date('2026-09-23T12:00:00.000Z'),
};

describe('serializeServicioLavado multimedia', () => {
  it('no expone una fotografía como video', () => {
    const result = serializeServicioLavado({
      ...baseService,
      fotoIngresoUrl: 'https://bucket.example/agencias/a/fotos/ingreso.jpg',
    });

    expect(result.fotoIngresoUrl).toContain('ingreso.jpg');
    expect(result.videoInicialUrl).toBeNull();
    expect(result.videoUrl).toBeNull();
  });

  it('prioriza las columnas de video y mantiene separadas las fotografías', () => {
    const result = serializeServicioLavado({
      ...baseService,
      fotoIngresoUrl: 'https://bucket.example/agencias/a/fotos/ingreso.jpg',
      fotoSalidaUrl: 'https://bucket.example/agencias/a/fotos/salida.jpg',
      videoInicialUrl: 'https://bucket.example/agencias/a/videos/inicial/video.mp4',
      videoFinalUrl: 'https://bucket.example/agencias/a/videos/final/video.mp4',
    });

    expect(result.foto).toContain('salida.jpg');
    expect(result.videoInicialUrl).toContain('/videos/inicial/');
    expect(result.videoFinalUrl).toContain('/videos/final/');
    expect(result.videoUrl).toContain('/videos/final/');
  });

  it('migra visualmente videos antiguos guardados en columnas de foto', () => {
    const result = serializeServicioLavado({
      ...baseService,
      fotoIngresoUrl: 'https://bucket.example/agencias/a/videos/inicial/legacy.mp4',
    });

    expect(result.fotoIngresoUrl).toBeNull();
    expect(result.videoInicialUrl).toContain('legacy.mp4');
  });

});
