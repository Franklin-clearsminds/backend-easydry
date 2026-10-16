import { describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { exigirPermisoSubida } from './upload-permissions.js';
import { StorageService } from './storage.service.js';

const con = (...capacidades: string[]) => ({ id: 'u', role: { namerol: 'ROL_DE_PRUEBA', capacidades, ambito: 'GLOBAL' } });

describe('Evidencias de envíos en el almacenamiento', () => {
  it('quien confirma, rechaza o resuelve faltantes puede subir fotos del envío; el resto no', () => {
    for (const casilla of ['envios.confirmar', 'envios.rechazar', 'envios.faltantes']) {
      expect(() => exigirPermisoSubida(con(casilla), { type: 'FOTO_ENVIO', category: 'INVENTARIO_ENVIOS' })).not.toThrow();
    }
    expect(() => exigirPermisoSubida(con('despachos.ver'), { type: 'FOTO_ENVIO', category: 'INVENTARIO_ENVIOS' })).toThrow(ForbiddenException);
  });

  it('las fotos quedan en inventario/envios/{guía}/{etapa}/, juntas por guía', async () => {
    const storage = new StorageService({ get: (k: string) => (k === 'AWS_REGION' ? 'us-east-1' : k === 'AWS_S3_BUCKET_NAME' ? 'bucket-de-prueba' : '') } as never);
    const rec = await storage.buildS3Key({ type: 'FOTO_ENVIO', envioGuia: 'DESP-2026-0022', envioEtapa: 'recepcion', fileName: 'a.jpg' });
    const rech = await storage.buildS3Key({ type: 'FOTO_ENVIO', envioGuia: 'DESP-2026-0022', envioEtapa: 'rechazo', fileName: 'b.png' });
    const res = await storage.buildS3Key({ type: 'FOTO_ENVIO', envioGuia: 'DESP-2026-0022', envioEtapa: 'resolucion' });

    expect(rec.key).toMatch(/^inventario\/envios\/desp-2026-0022\/recepcion\/\d+_foto_envio_[0-9a-f]{8}\.jpg$/);
    expect(rech.key).toMatch(/^inventario\/envios\/desp-2026-0022\/rechazo\/.+\.png$/);
    expect(res.key).toContain('/resolucion/');
  });
});
