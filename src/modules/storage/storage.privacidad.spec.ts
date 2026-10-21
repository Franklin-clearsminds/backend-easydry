import { describe, expect, it, vi } from 'vitest';
import { StorageController } from './storage.controller.js';
import { StorageService } from './storage.service.js';
import { ROLES_BASE } from '../../common/permisos/roles-base.js';

const usuario = (namerol: string, extra: Record<string, unknown> = {}) => {
  const r = ROLES_BASE.find((x) => x.namerol === namerol)!;
  return { id: `id-${namerol}`, roleDetails: { namerol, capacidades: r.capacidades, ambito: r.ambito }, ...extra };
};

function armar(agencias: Array<{ id: string; nombre: string }> = [], maquina: unknown = null) {
  const prisma: any = {
    agencia: { findMany: vi.fn().mockResolvedValue(agencias) },
    maquinaria: { findFirst: vi.fn().mockResolvedValue(maquina) },
  };
  const servicio = Object.create(StorageService.prototype) as StorageService;
  (servicio as any).prisma = prisma;
  (servicio as any).publicUrlPrefix = 'https://bucket.s3.amazonaws.com';
  servicio.getPresignedDownloadUrl = vi.fn().mockResolvedValue('https://firmada') as any;
  return { prisma, controlador: new StorageController(servicio), servicio };
}
const res = () => ({ redirect: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() }) as any;

describe('evidencias privadas: presigned-url', () => {
  it('avatares e imágenes del catálogo: cualquier usuario con sesión', async () => {
    const { controlador } = armar();
    await expect(controlador.getPresignedUrl('usuarios/u1/perfil/avatar.jpg', usuario('LIDER', { agenciaId: 'a1' }))).resolves.toEqual({ url: 'https://firmada' });
    await expect(controlador.getPresignedUrl('catalogo/insumos/jabon/jabon.jpg', usuario('LAVADOR'))).resolves.toEqual({ url: 'https://firmada' });
  });

  it('evidencia de una agencia: solo dentro del alcance y con permiso para ver evidencias', async () => {
    const llave = 'agencias/toyocosta-carlos-julio/servicios/generales/OT-1/fotos/a.jpg';
    const propia = armar([{ id: 'a1', nombre: 'Toyocosta Carlos Julio' }]);
    await expect(propia.controlador.getPresignedUrl(llave, usuario('LIDER', { agenciaId: 'a1' }))).resolves.toEqual({ url: 'https://firmada' });

    const ajena = armar([{ id: 'a1', nombre: 'Otra Agencia' }]);
    await expect(ajena.controlador.getPresignedUrl(llave, usuario('LIDER', { agenciaId: 'a1' }))).rejects.toThrow(/fuera de tu alcance/);

    // un lavador no tiene ningún permiso: no ve ni la de su propia agencia
    const lavador = armar([{ id: 'a1', nombre: 'Toyocosta Carlos Julio' }]);
    await expect(lavador.controlador.getPresignedUrl(llave, usuario('LAVADOR', { agenciaId: 'a1' }))).rejects.toThrow(/No tienes permiso/);
  });

  it('el supervisor ve las agencias de su región; administradores y jefe comercial, todas', async () => {
    const llave = 'agencias/toyocosta-carlos-julio/servicios/generales/OT-1/videos/final/v.mp4';
    const supervisor = armar([{ id: 'a1', nombre: 'Toyocosta Carlos Julio' }]);
    await expect(supervisor.controlador.getPresignedUrl(llave, usuario('SUPERVISOR', { regionId: 'r1' }))).resolves.toBeDefined();
    expect(supervisor.prisma.agencia.findMany.mock.calls[0][0].where).toEqual({ regionId: 'r1' });
    const admin = armar();
    await expect(admin.controlador.getPresignedUrl(llave, usuario('ADMIN'))).resolves.toBeDefined();
    expect(admin.prisma.agencia.findMany).not.toHaveBeenCalled();
    const sinRegion = armar();
    await expect(sinRegion.controlador.getPresignedUrl(llave, usuario('SUPERVISOR'))).rejects.toThrow(/fuera de tu alcance/);
  });

  it('las variantes miniatura y vista siguen las mismas reglas', async () => {
    const { controlador } = armar([{ id: 'a1', nombre: 'Agencia Uno' }]);
    await expect(controlador.getPresignedUrl('thumbs/agencias/agencia-uno/servicios/generales/OT-1/fotos/a.jpg', usuario('APROBADOR', { agenciaId: 'a1' }))).resolves.toBeDefined();
    await expect(controlador.getPresignedUrl('view/agencias/otra/servicios/generales/OT-1/fotos/a.jpg', usuario('APROBADOR', { agenciaId: 'a1' }))).rejects.toThrow(/fuera de tu alcance/);
  });

  it('las fotos de inventario piden permiso de inventario', async () => {
    const llave = 'agencias/agencia-uno/inventario/ingresos/jabon/a.jpg';
    const { controlador } = armar([{ id: 'a1', nombre: 'Agencia Uno' }]);
    await expect(controlador.getPresignedUrl(llave, usuario('LIDER', { agenciaId: 'a1' }))).resolves.toBeDefined();
    await expect(controlador.getPresignedUrl(llave, usuario('TECNICO'))).resolves.toBeDefined(); // el técnico tiene evidencias.ver
    await expect(controlador.getPresignedUrl(llave, usuario('LAVADOR', { agenciaId: 'a1' }))).rejects.toThrow(/No tienes permiso/);
  });
});

describe('archivos de maquinaria: presigned-url', () => {
  const conPermisos = (...capacidades: string[]) => ({ id: 'u1', roleDetails: { namerol: 'LIDER', capacidades, ambito: 'GLOBAL' } });

  it('la foto y la ficha técnica las ve quien puede ver maquinaria', async () => {
    const { controlador } = armar();
    const foto = 'maquinaria/hd-20022/perfil/foto/a.jpg';
    await expect(controlador.getPresignedUrl(foto, conPermisos('maquinaria.ver'))).resolves.toBeDefined();
    await expect(controlador.getPresignedUrl(foto, conPermisos('incidentes.ver'))).rejects.toThrow(/No tienes permiso/);
  });

  it('las evidencias de incidentes y limpiezas piden su permiso, no el de ver maquinaria', async () => {
    const { controlador } = armar();
    const inc = 'maquinaria/hd-20022/incidentes/i1/reporte/fotos/a.jpg';
    const limp = 'maquinaria/hd-20022/limpiezas/2026-10-15/a.jpg';
    await expect(controlador.getPresignedUrl(inc, conPermisos('incidentes.ver'))).resolves.toBeDefined();
    await expect(controlador.getPresignedUrl(limp, conPermisos('limpiezas.ver'))).resolves.toBeDefined();
    await expect(controlador.getPresignedUrl(inc, conPermisos('maquinaria.ver'))).rejects.toThrow(/No tienes permiso/);
  });
});

describe('archivos de maquinaria: alcance por ámbito', () => {
  const foto = 'maquinaria/hd-20022/perfil/foto/a.jpg';
  const maquina = { agenciaId: 'a1', operadorAsignadoId: null, agencia: { regionId: 'r1' } };
  const rol = (ambito: string, extra: Record<string, unknown> = {}) => ({
    id: 'u1', ...extra, roleDetails: { namerol: 'ROL_X', capacidades: ['maquinaria.ver'], ambito },
  });

  it('todo el país ve las máquinas de cualquier región', async () => {
    const { controlador, prisma } = armar([], { ...maquina, agencia: { regionId: 'otra' } });
    await expect(controlador.getPresignedUrl(foto, rol('GLOBAL'))).resolves.toBeDefined();
    expect(prisma.maquinaria.findFirst).not.toHaveBeenCalled();
  });

  it('región: solo las de su región', async () => {
    const { controlador } = armar([], maquina);
    await expect(controlador.getPresignedUrl(foto, rol('REGION', { regionId: 'r1' }))).resolves.toBeDefined();
    await expect(controlador.getPresignedUrl(foto, rol('REGION', { regionId: 'r2' }))).rejects.toThrow(/fuera de tu alcance/);
  });

  it('agencia: solo las de su agencia', async () => {
    const { controlador } = armar([], maquina);
    await expect(controlador.getPresignedUrl(foto, rol('AGENCIA', { agenciaId: 'a1' }))).resolves.toBeDefined();
    await expect(controlador.getPresignedUrl(foto, rol('AGENCIA', { agenciaId: 'a2' }))).rejects.toThrow(/fuera de tu alcance/);
  });
});

describe('GET /storage/file ya no entrega evidencias', () => {
  it('solo sirve avatares e imágenes del catálogo; el resto exige presigned-url', async () => {
    const { controlador, servicio } = armar();
    const ok = res();
    await controlador.getFile('catalogo/insumos/jabon/jabon.jpg', ok);
    expect(ok.redirect).toHaveBeenCalled();
    for (const llave of [
      'agencias/a/servicios/generales/OT-1/fotos/a.jpg',
      'agencias/a/servicios/especiales/OT-2/videos/final/v.mp4',
      'agencias/a/inventario/ingresos/x/a.jpg',
      'maquinaria/hidro-01/perfil/foto/a.jpg',
      'documentos/algo.pdf',
    ]) {
      await expect(controlador.getFile(llave, res())).rejects.toThrow(/requiere sesión/);
    }
    expect(servicio.getPresignedDownloadUrl).toHaveBeenCalledTimes(1);
  });
});

describe('permisos de subida de evidencias de maquinaria', () => {
  const usuarioCon = (...capacidades: string[]) => ({
    id: 'lider-1',
    roleDetails: { namerol: 'LIDER', capacidades },
  });

  it('permite subir limpieza con el permiso separado y bloquea la subida de incidentes', async () => {
    const { controlador, servicio } = armar();
    servicio.generateUploadTicket = vi.fn().mockResolvedValue({ ticketId: 'ticket' }) as any;
    const usuario = usuarioCon('limpiezas.evidencias');

    await expect(controlador.getUploadTicket({
      type: 'FOTO_LIMPIEZA',
      category: 'MAQUINARIA_LIMPIEZA',
    }, usuario)).resolves.toEqual({ ticketId: 'ticket' });
    await expect(controlador.getUploadTicket({
      type: 'FOTO_INCIDENTE',
      category: 'MAQUINARIA_INCIDENTE',
    }, usuario)).rejects.toThrow(/incidencias o mantenimiento/);
    expect(servicio.generateUploadTicket).toHaveBeenCalledTimes(1);
  });

  it('no permite usar maquinaria.evidencias para subir fotos de limpieza', async () => {
    const { controlador, servicio } = armar();
    servicio.generateUploadTicket = vi.fn().mockResolvedValue({ ticketId: 'ticket' }) as any;

    await expect(controlador.getUploadTicket({
      type: 'FOTO_LIMPIEZA',
      category: 'MAQUINARIA_LIMPIEZA',
    }, usuarioCon('maquinaria.evidencias'))).rejects.toThrow(/evidencias de limpieza/);
    expect(servicio.generateUploadTicket).not.toHaveBeenCalled();
  });

  it('no permite usar evidencias.subir de servicios para subir fotos de limpieza', async () => {
    const { controlador, servicio } = armar();
    servicio.generateUploadTicket = vi.fn().mockResolvedValue({ ticketId: 'ticket' }) as any;

    await expect(controlador.getUploadTicket({
      type: 'FOTO_LIMPIEZA',
      category: 'MAQUINARIA_LIMPIEZA',
    }, usuarioCon('evidencias.subir'))).rejects.toThrow(/evidencias de limpieza/);
    expect(servicio.generateUploadTicket).not.toHaveBeenCalled();
  });
});
