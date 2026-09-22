import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { StorageService } from './storage.service.js';

function createService() {
  return new StorageService(new ConfigService({
    STORAGE_DRIVER: 'local',
    UPLOAD_DIR: './uploads-test',
    STORAGE_TICKET_SECRET: 'test-secret',
  }));
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

  it('genera un ticket local firmado y rechaza firmas alteradas', async () => {
    const service = createService();
    const ticket = await service.generateUploadTicket({
      agenciaId: 'a-1',
      clientUuid: 'ot-1',
      type: 'FOTO_INGRESO',
      category: 'SERVICIOS_GENERALES',
    });
    expect(ticket.driver).toBe('local');
    const url = new URL(ticket.uploadUrl, 'http://localhost');
    expect(() => service.verifyLocalTicket(
      url.searchParams.get('key')!,
      Number(url.searchParams.get('expires')),
      `${url.searchParams.get('token')!.slice(0, -1)}0`,
    )).toThrow(UnauthorizedException);
  });
});
