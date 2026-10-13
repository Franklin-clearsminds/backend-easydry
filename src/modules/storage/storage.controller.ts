import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { StorageService } from './storage.service.js';
import { tieneAlgunPermiso } from '../../common/permisos/capacidades.js';
import { exigirPermisoSubida } from './upload-permissions.js';
import type { GenerateUploadTicketDto } from './storage.service.js';

import {
  Publico,
  SoloAutenticado,
} from '../../common/permisos/permisos.decorators.js';

/** Foto de perfil de un usuario: cualquier usuario con sesión puede verla y subir la suya. */
const CLAVE_PERFIL = /^usuarios\/[^/]+\/perfil\//i;
/** Imágenes del catálogo de insumos y avatares: no llevan datos de clientes y se muestran en muchas pantallas; `/storage/file` solo sirve estas. */
const CLAVE_PUBLICA =
  /^(?:thumbs\/|view\/)?(?:catalogo\/insumos\/|usuarios\/[^/]+\/perfil\/)/i;
/** Evidencias de una agencia (servicios, inventario…): `agencias/<nombre de la agencia>/…`. Privadas: solo con sesión y dentro del alcance. */
const CLAVE_AGENCIA = /^(?:thumbs\/|view\/)?agencias\/([^/]+)\//i;
/**
 * La evidencia de maquinaria (incluye sus miniaturas y las rutas antiguas) es privada:
 * solo se entrega con sesión iniciada y a los roles que pueden ver la trazabilidad.
 */

const CLAVE_ENVIO = /^(thumbs\/|view\/)?inventario\/envios\//i;
const CLAVE_MAQUINARIA = /^(thumbs\/|view\/)?(agencias\/)?maquinaria\//i;

@ApiTags('Almacenamiento S3')
@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @SoloAutenticado()
  @Post('ticket')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Genera un ticket de subida S3' })
  @ApiResponse({ status: 200, description: 'Ticket de subida generado' })
  async getUploadTicket(
    @Body() dto: GenerateUploadTicketDto,
    @CurrentUser() user: any,
  ) {
    const userId = String(user.id);
    if (dto.type === 'FOTO_PERFIL' || dto.category === 'PERFIL_USUARIO') {
      dto.userId = userId;
      dto.clientUuid = userId;
    } else {
      exigirPermisoSubida(user, dto);
    }
    if (dto.category === 'SERVICIOS_ESPECIALES') {
      await this.storageService.asegurarPuedeSubirEvidenciaEspecial(
        dto.servicioId || dto.clientUuid,
        user,
      );
    }
    return this.storageService.generateUploadTicket(dto);
  }

  @SoloAutenticado()
  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }),
  )
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Sube un archivo a S3 a través del backend (evita CORS del navegador)',
  })
  async uploadFile(
    @UploadedFile() file: { buffer?: Buffer; mimetype?: string } | undefined,
    @Body() dto: GenerateUploadTicketDto,
    @CurrentUser() user: any,
  ) {
    const userId = String(user.id);
    if (!file?.buffer?.length) {
      throw new BadRequestException('El archivo de evidencia es obligatorio.');
    }
    if (dto.type === 'FOTO_PERFIL' || dto.category === 'PERFIL_USUARIO') {
      dto.userId = userId;
      dto.clientUuid = userId;
    } else {
      exigirPermisoSubida(user, dto);
    }
    if (dto.category === 'SERVICIOS_ESPECIALES') {
      await this.storageService.asegurarPuedeSubirEvidenciaEspecial(
        dto.servicioId || dto.clientUuid,
        user,
      );
    }
    return this.storageService.uploadObject(
      dto,
      file.buffer,
      file.mimetype || dto.contentType,
    );
  }

  @SoloAutenticado()
  @Get('presigned-url')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Obtiene la URL prefirmada temporal para visualizar o reproducir un archivo (requiere sesión)',
  })
  async getPresignedUrl(
    @Query('key') rawKey: string,
    @CurrentUser() user: any,
  ): Promise<{ url: string }> {
    if (!rawKey) throw new BadRequestException('Parámetro key es obligatorio.');
    const key = this.storageService.keyFromUrl(rawKey) ?? rawKey;
    if (CLAVE_MAQUINARIA.test(key)) {
      if (
        !tieneAlgunPermiso(user, [
          'maquinaria.trazabilidad',
          'mantenimientos.ver',
        ])
      ) {
        throw new ForbiddenException(
          'No tienes permiso para ver la evidencia de maquinaria.',
        );
      }
    } else if (CLAVE_ENVIO.test(key)) {
      // Fotos de recepción, rechazo y resolución de un envío: quien ve envíos o los resuelve.
      if (!tieneAlgunPermiso(user, ['despachos.ver', 'envios.confirmar', 'envios.rechazar', 'envios.faltantes'])) {
        throw new ForbiddenException('No tienes permiso para ver la evidencia de envíos.');
      }
    } else if (CLAVE_PUBLICA.test(key)) {
      // avatares e imágenes de catálogo: cualquier usuario con sesión
    } else {
      const agencia = CLAVE_AGENCIA.exec(key);
      const permisos = key.includes('/inventario/')
        ? ['inventario.ver', 'evidencias.ver']
        : ['evidencias.ver'];
      if (!tieneAlgunPermiso(user, permisos)) {
        throw new ForbiddenException(
          'No tienes permiso para ver esta evidencia.',
        );
      }
      if (
        agencia &&
        !(await this.storageService.agenciaSegmentoEnAlcance(user, agencia[1]))
      ) {
        throw new ForbiddenException(
          'Esta evidencia pertenece a una agencia fuera de tu alcance.',
        );
      }
    }
    const url = await this.storageService.getPresignedDownloadUrl(rawKey, 3600);
    return { url };
  }

  @Publico()
  @Get('file')
  @ApiOperation({
    summary:
      'Redirige a una URL temporal solo para avatares e imágenes del catálogo de insumos; el resto de archivos es privado (usa presigned-url)',
  })
  async getFile(
    @Query('key') rawKey: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!rawKey) throw new BadRequestException('Parámetro key es obligatorio.');
    const key = this.storageService.keyFromUrl(rawKey) ?? rawKey;
    if (CLAVE_MAQUINARIA.test(key)) {
      // Esta ruta se usa desde etiquetas <img> sin sesión: la evidencia de maquinaria solo va por presigned-url.
      throw new ForbiddenException(
        'La evidencia de maquinaria requiere sesión: usa /storage/presigned-url.',
      );
    }

    if (!CLAVE_PUBLICA.test(key)) {
      // Las evidencias son privadas: se piden con sesión a /storage/presigned-url, que valida el alcance del usuario.
      throw new ForbiddenException(
        'Este archivo requiere sesión: usa /storage/presigned-url.',
      );
    }

    try {
      const presignedUrl = await this.storageService.getPresignedDownloadUrl(
        rawKey,
        3600,
      );
      res.redirect(HttpStatus.FOUND, presignedUrl);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Error desconocido';
      res
        .status(HttpStatus.NOT_FOUND)
        .json({ message: 'Archivo no encontrado.', error: message });
    }
  }
}
