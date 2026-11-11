import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { puedeSobreAgencia, resolverAlcance } from '../../common/permisos/alcance.js';
import type { GuardarUbicacionDto, QuitarUbicacionDto } from './dto/rrhh.dto.js';
import { RADIO_POR_DEFECTO_M } from './rrhh.reglas.js';

export interface SitioConUbicacion {
  tipo: 'AGENCIA' | 'BODEGA';
  id: string;
  codigo: string;
  nombre: string;
  regionId: string | null;
  activo: boolean;
  latitud: number | null;
  longitud: number | null;
  radioM: number;
}

/**
 * Ubicación de cada agencia y bodega: contra ella se valida la timbrada del personal. Solo quien tiene `rrhh.ubicaciones.gestionar`
 * la cambia, y cada cambio queda en la bitácora con el valor anterior.
 */
@Injectable()
export class UbicacionesService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(user: any): Promise<SitioConUbicacion[]> {
    const alcance = resolverAlcance(user);
    const [agencias, bodegas] = await Promise.all([
      this.prisma.agencia.findMany({
        select: { id: true, codigo: true, nombre: true, regionId: true, estado: true, latitud: true, longitud: true, radioTimbradaM: true },
        orderBy: { nombre: 'asc' },
      }),
      this.prisma.bodega.findMany({
        select: { id: true, codigo: true, nombre: true, regionId: true, activa: true, latitud: true, longitud: true, radioTimbradaM: true },
        orderBy: { nombre: 'asc' },
      }),
    ]);
    const enAlcance = (regionId: string | null, id: string, tipo: 'AGENCIA' | 'BODEGA') =>
      tipo === 'AGENCIA' ? puedeSobreAgencia(alcance, { id, regionId }) : alcance.tipo === 'GLOBAL' || (alcance.tipo === 'REGION' && !!regionId && regionId === alcance.regionId);
    return [
      ...agencias
        .filter((a) => enAlcance(a.regionId, a.id, 'AGENCIA'))
        .map((a): SitioConUbicacion => ({ tipo: 'AGENCIA', id: a.id, codigo: a.codigo, nombre: a.nombre, regionId: a.regionId, activo: a.estado === 1, latitud: a.latitud, longitud: a.longitud, radioM: a.radioTimbradaM })),
      ...bodegas
        .filter((b) => enAlcance(b.regionId, b.id, 'BODEGA'))
        .map((b): SitioConUbicacion => ({ tipo: 'BODEGA', id: b.id, codigo: b.codigo, nombre: b.nombre, regionId: b.regionId, activo: b.activa, latitud: b.latitud, longitud: b.longitud, radioM: b.radioTimbradaM })),
    ];
  }

  async guardar(dto: GuardarUbicacionDto, user: any): Promise<SitioConUbicacion> {
    // El radio ya no se configura (es fijo por canal): se conserva el valor por defecto en la columna.
    return this.actualizar(dto.sitioTipo, dto.sitioId, user, { latitud: dto.latitud, longitud: dto.longitud, radioM: RADIO_POR_DEFECTO_M });
  }

  /** Quita la ubicación (el radio vuelve al valor por defecto): hasta que se configure otra, el personal de ese sitio no puede timbrar. */
  async quitar(dto: QuitarUbicacionDto, user: any): Promise<SitioConUbicacion> {
    return this.actualizar(dto.sitioTipo, dto.sitioId, user, { latitud: null, longitud: null, radioM: RADIO_POR_DEFECTO_M });
  }

  private async actualizar(
    tipo: 'AGENCIA' | 'BODEGA',
    id: string,
    user: any,
    nuevo: { latitud: number | null; longitud: number | null; radioM: number },
  ): Promise<SitioConUbicacion> {
    const alcance = resolverAlcance(user);
    const datos = { latitud: nuevo.latitud, longitud: nuevo.longitud, radioTimbradaM: nuevo.radioM };
    const antesDe = (r: { latitud: number | null; longitud: number | null; radioTimbradaM: number }) => ({ latitud: r.latitud, longitud: r.longitud, radioM: r.radioTimbradaM });

    if (tipo === 'AGENCIA') {
      const agencia = await this.prisma.agencia.findUnique({ where: { id }, select: { id: true, codigo: true, nombre: true, regionId: true, estado: true, latitud: true, longitud: true, radioTimbradaM: true } });
      if (!agencia) throw new NotFoundException('La agencia no existe.');
      if (!puedeSobreAgencia(alcance, agencia)) throw new ForbiddenException('Esta agencia está fuera de tu alcance.');
      const [actualizada] = await this.prisma.$transaction([
        this.prisma.agencia.update({ where: { id }, data: datos, select: { latitud: true, longitud: true, radioTimbradaM: true } }),
        this.prisma.ubicacionCambio.create({
          data: { sitioTipo: 'AGENCIA', sitioId: id, sitioNombre: agencia.nombre, antes: antesDe(agencia), despues: { ...nuevo }, actorId: String(user.id) },
        }),
      ]);
      return { tipo, id, codigo: agencia.codigo, nombre: agencia.nombre, regionId: agencia.regionId, activo: agencia.estado === 1, latitud: actualizada.latitud, longitud: actualizada.longitud, radioM: actualizada.radioTimbradaM };
    }

    const bodega = await this.prisma.bodega.findUnique({ where: { id }, select: { id: true, codigo: true, nombre: true, regionId: true, activa: true, latitud: true, longitud: true, radioTimbradaM: true } });
    if (!bodega) throw new NotFoundException('La bodega no existe.');
    // Una bodega regional pertenece a una región; la central y las sin región solo las gestiona el alcance nacional.
    const permitida = alcance.tipo === 'GLOBAL' || (alcance.tipo === 'REGION' && !!bodega.regionId && bodega.regionId === alcance.regionId);
    if (!permitida) throw new ForbiddenException('Esta bodega está fuera de tu alcance.');
    const [actualizada] = await this.prisma.$transaction([
      this.prisma.bodega.update({ where: { id }, data: datos, select: { latitud: true, longitud: true, radioTimbradaM: true } }),
      this.prisma.ubicacionCambio.create({
        data: { sitioTipo: 'BODEGA', sitioId: id, sitioNombre: bodega.nombre, antes: antesDe(bodega), despues: { ...nuevo }, actorId: String(user.id) },
      }),
    ]);
    return { tipo, id, codigo: bodega.codigo, nombre: bodega.nombre, regionId: bodega.regionId, activo: bodega.activa, latitud: actualizada.latitud, longitud: actualizada.longitud, radioM: actualizada.radioTimbradaM };
  }
}
