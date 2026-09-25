import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { StorageService } from './storage.service.js';
import { actorFromUser, PERMISOS, tieneRol } from '../maquinaria/maquinaria.permisos.js';
import type { GenerateUploadTicketDto } from './storage.service.js';

/**
 * La evidencia de maquinaria (incluye sus miniaturas y las rutas antiguas) es privada:
 * solo se entrega con sesión iniciada y a los roles que pueden ver la trazabilidad.
 */
const CLAVE_MAQUINARIA = /^(thumbs\/|view\/)?(agencias\/)?maquinaria\//i;

@ApiTags('Almacenamiento S3')
@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Post('ticket')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Genera un ticket de subida S3' })
  @ApiResponse({ status: 200, description: 'Ticket de subida generado' })
  getUploadTicket(@Body() dto: GenerateUploadTicketDto, @CurrentUser('id') userId: string) {
    if (dto.type === 'FOTO_PERFIL' || dto.category === 'PERFIL_USUARIO') {
      dto.userId = userId;
      dto.clientUuid = userId;
    }
    return this.storageService.generateUploadTicket(dto);
  }

  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sube un archivo a S3 a través del backend (evita CORS del navegador)' })
  async uploadFile(
    @UploadedFile() file: { buffer?: Buffer; mimetype?: string } | undefined,
    @Body() dto: GenerateUploadTicketDto,
    @CurrentUser('id') userId: string,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('El archivo de evidencia es obligatorio.');
    }
    if (dto.type === 'FOTO_PERFIL' || dto.category === 'PERFIL_USUARIO') {
      dto.userId = userId;
      dto.clientUuid = userId;
    }
    return this.storageService.uploadObject(dto, file.buffer, file.mimetype || dto.contentType);
  }

  @Get('presigned-url')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtiene la URL prefirmada temporal para visualizar o reproducir un archivo (requiere sesión)' })
  async getPresignedUrl(@Query('key') rawKey: string, @CurrentUser() user: any): Promise<{ url: string }> {
    if (!rawKey) throw new BadRequestException('Parámetro key es obligatorio.');
    const key = this.storageService.keyFromUrl(rawKey) ?? rawKey;
    if (CLAVE_MAQUINARIA.test(key)) {
      const actor = actorFromUser(user);
      if (!tieneRol(actor, [...PERMISOS.verTrazabilidad, ...PERMISOS.verMantenimientos])) {
        throw new ForbiddenException('No tienes permiso para ver la evidencia de maquinaria.');
      }
    }
    const url = await this.storageService.getPresignedDownloadUrl(rawKey, 3600);
    return { url };
  }

  @Get('file')
  @ApiOperation({ summary: 'Redirige a una URL temporal para visualizar o reproducir un archivo de S3' })
  async getFile(@Query('key') rawKey: string, @Res() res: Response): Promise<void> {
    if (!rawKey) throw new BadRequestException('Parámetro key es obligatorio.');
    const key = this.storageService.keyFromUrl(rawKey) ?? rawKey;
    if (CLAVE_MAQUINARIA.test(key)) {
      // Esta ruta se usa desde etiquetas <img> sin sesión: la evidencia de maquinaria solo va por presigned-url.
      throw new ForbiddenException('La evidencia de maquinaria requiere sesión: usa /storage/presigned-url.');
    }

    try {
      const presignedUrl = await this.storageService.getPresignedDownloadUrl(rawKey, 3600);
      res.redirect(HttpStatus.FOUND, presignedUrl);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Error desconocido';
      res.status(HttpStatus.NOT_FOUND).json({ message: 'Archivo no encontrado.', error: message });
    }
  }
}
