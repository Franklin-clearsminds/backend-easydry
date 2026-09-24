import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { StorageService } from './storage.service.js';
import type { GenerateUploadTicketDto } from './storage.service.js';

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
  @ApiOperation({ summary: 'Obtiene la URL prefirmada temporal para visualizar o reproducir un archivo' })
  async getPresignedUrl(@Query('key') rawKey: string): Promise<{ url: string }> {
    if (!rawKey) throw new BadRequestException('Parámetro key es obligatorio.');
    const url = await this.storageService.getPresignedDownloadUrl(rawKey, 3600);
    return { url };
  }

  @Get('file')
  @ApiOperation({ summary: 'Redirige a una URL temporal para visualizar o reproducir un archivo de S3' })
  async getFile(@Query('key') rawKey: string, @Res() res: Response): Promise<void> {
    if (!rawKey) throw new BadRequestException('Parámetro key es obligatorio.');

    try {
      const presignedUrl = await this.storageService.getPresignedDownloadUrl(rawKey, 3600);
      res.redirect(HttpStatus.FOUND, presignedUrl);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Error desconocido';
      res.status(HttpStatus.NOT_FOUND).json({ message: 'Archivo no encontrado.', error: message });
    }
  }
}
