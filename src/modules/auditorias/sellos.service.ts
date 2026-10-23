import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { compare as compararHash, hash as generarHash } from '@node-rs/bcrypt';
import { PrismaService } from '../prisma/prisma.service.js';
import { exigirPasswordSegura } from '../../common/utils/password-politica.js';
import { CryptoService } from '../../common/crypto/crypto.service.js';
import { CrearSelloDto, EditarSelloDto } from './dto/sellos.dto.js';
import { MAX_LOGO_CARACTERES, esImagenDataUrl } from './informes.reglas.js';

/** Contraseñas incorrectas seguidas que bloquean el sello, y cuánto dura el bloqueo. */
const INTENTOS_MAXIMOS = 5;
const MINUTOS_BLOQUEO = 15;

const texto = (s: string | undefined | null): string => String(s ?? '').trim();

/**
 * Sellos de los jefes de taller: nombre, apellido, logo (marca de agua bajo su firma) y la contraseña que se pide al calificar
 * un informe. Los configuran solo Admin y Super Admin; quien elabora un informe solo ve el nombre para elegirlo.
 */
@Injectable()
export class SellosService {
  constructor(
    private readonly prisma: PrismaService,
    /** El logo se guarda cifrado en la base. */
    private readonly crypto: CryptoService,
  ) {}

  private aSello(s: { id: string; nombre: string; apellido: string; logo: string | null; estado: number; bloqueadoHasta: Date | null; createdAt: Date; updatedAt: Date }) {
    return {
      id: s.id,
      nombre: s.nombre,
      apellido: s.apellido,
      logo: this.crypto.revelarEnReposo(s.logo),
      estado: s.estado,
      bloqueado: !!s.bloqueadoHasta && s.bloqueadoHasta.getTime() > Date.now(),
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  /** Todos los sellos, con su logo, para la pantalla de configuración. Nunca devuelve el hash de la contraseña. */
  async list() {
    const sellos = await this.prisma.selloJefeTaller.findMany({ orderBy: [{ estado: 'desc' }, { nombre: 'asc' }, { apellido: 'asc' }] });
    return sellos.map((s) => this.aSello(s));
  }

  /** Sellos activos para elegir al calificar un informe: solo el nombre, sin logo ni nada de la contraseña. */
  async opciones() {
    const sellos = await this.prisma.selloJefeTaller.findMany({
      where: { estado: 1 },
      orderBy: [{ nombre: 'asc' }, { apellido: 'asc' }],
      select: { id: true, nombre: true, apellido: true },
    });
    return sellos.map((s) => ({ id: s.id, nombre: s.nombre, apellido: s.apellido, nombreCompleto: `${s.nombre} ${s.apellido}`.trim() }));
  }

  async crear(dto: CrearSelloDto, user: any) {
    const nombre = texto(dto.nombre);
    const apellido = texto(dto.apellido);
    if (!nombre || !apellido) throw new BadRequestException('El nombre y el apellido son obligatorios.');
    exigirPasswordSegura(dto.password);
    const logo = this.crypto.protegerEnReposo(this.validarLogo(dto.logo));
    await this.exigirNombreLibre(nombre, apellido);
    const creado = await this.prisma.selloJefeTaller.create({
      data: { nombre, apellido, logo, passwordHash: await generarHash(dto.password, { cost: 10 }), creadoPorId: user?.id ?? null },
    });
    return this.aSello(creado);
  }

  async editar(dto: EditarSelloDto) {
    const actual = await this.prisma.selloJefeTaller.findUnique({ where: { id: dto.id } });
    if (!actual) throw new NotFoundException('El sello no existe.');
    const nombre = dto.nombre !== undefined ? texto(dto.nombre) : actual.nombre;
    const apellido = dto.apellido !== undefined ? texto(dto.apellido) : actual.apellido;
    if (!nombre || !apellido) throw new BadRequestException('El nombre y el apellido son obligatorios.');
    if (nombre !== actual.nombre || apellido !== actual.apellido) await this.exigirNombreLibre(nombre, apellido, actual.id);
    const data: Record<string, unknown> = { nombre, apellido };
    if (dto.logo !== undefined) data.logo = dto.logo === '' ? null : this.crypto.protegerEnReposo(this.validarLogo(dto.logo));
    if (dto.estado !== undefined) data.estado = dto.estado;
    if (dto.password) {
      exigirPasswordSegura(dto.password);
      data.passwordHash = await generarHash(dto.password, { cost: 10 });
      // Con una contraseña nueva se levanta el bloqueo por intentos fallidos.
      data.intentosFallidos = 0;
      data.bloqueadoHasta = null;
    }
    const guardado = await this.prisma.selloJefeTaller.update({ where: { id: dto.id }, data });
    return this.aSello(guardado);
  }

  /**
   * Comprueba la contraseña de un sello. Tras varios intentos fallidos seguidos el sello se bloquea unos minutos, para que nadie
   * pueda adivinar la contraseña de un jefe de taller. Devuelve el sello (con su logo, tal como está guardado: cifrado) para copiarlo al informe.
   */
  async verificar(selloId: string, password: string) {
    const sello = await this.prisma.selloJefeTaller.findUnique({ where: { id: selloId } });
    if (!sello || sello.estado !== 1) throw new NotFoundException('El jefe de taller no está disponible.');
    if (sello.bloqueadoHasta && sello.bloqueadoHasta.getTime() > Date.now()) {
      const minutos = Math.max(1, Math.ceil((sello.bloqueadoHasta.getTime() - Date.now()) / 60000));
      throw new ForbiddenException(`Demasiados intentos con contraseña incorrecta. Vuelve a intentarlo en ${minutos} min.`);
    }
    if (!(await compararHash(String(password ?? ''), sello.passwordHash))) {
      const intentos = sello.intentosFallidos + 1;
      const bloquea = intentos >= INTENTOS_MAXIMOS;
      await this.prisma.selloJefeTaller.update({
        where: { id: sello.id },
        data: bloquea
          ? { intentosFallidos: 0, bloqueadoHasta: new Date(Date.now() + MINUTOS_BLOQUEO * 60000) }
          : { intentosFallidos: intentos },
      });
      throw new ForbiddenException(
        bloquea
          ? `Contraseña incorrecta. El sello quedó bloqueado ${MINUTOS_BLOQUEO} minutos por demasiados intentos.`
          : `Contraseña incorrecta (${INTENTOS_MAXIMOS - intentos} intento(s) restantes).`,
      );
    }
    if (sello.intentosFallidos || sello.bloqueadoHasta) {
      await this.prisma.selloJefeTaller.update({ where: { id: sello.id }, data: { intentosFallidos: 0, bloqueadoHasta: null } });
    }
    return { id: sello.id, nombre: sello.nombre, apellido: sello.apellido, logo: sello.logo };
  }

  private validarLogo(logo: string | undefined): string | null {
    if (logo === undefined || logo === null || logo === '') return null;
    if (!esImagenDataUrl(logo, MAX_LOGO_CARACTERES)) {
      throw new BadRequestException('El logo debe ser una imagen PNG, JPG o WEBP de menos de 300 KB.');
    }
    return logo;
  }

  private async exigirNombreLibre(nombre: string, apellido: string, ignorarId?: string) {
    const repetido = await this.prisma.selloJefeTaller.findFirst({
      where: {
        nombre: { equals: nombre, mode: 'insensitive' },
        apellido: { equals: apellido, mode: 'insensitive' },
        ...(ignorarId ? { id: { not: ignorarId } } : {}),
      },
      select: { id: true },
    });
    if (repetido) throw new ConflictException('Ya existe un sello con ese nombre y apellido.');
  }
}
