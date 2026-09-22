import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, PayloadTooLargeException, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
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
  @ApiOperation({ summary: 'Genera un ticket de subida S3 o local' })
  @ApiResponse({ status: 200, description: 'Ticket de subida generado' })
  getUploadTicket(@Body() dto: GenerateUploadTicketDto) {
    return this.storageService.generateUploadTicket(dto);
  }

  @Get('presigned-url')
  @ApiOperation({ summary: 'Obtiene la URL prefirmada temporal para visualizar o reproducir un archivo' })
  async getPresignedUrl(@Query('key') rawKey: string): Promise<{ url: string }> {
    if (!rawKey) throw new BadRequestException('Parámetro key es obligatorio.');
    const url = await this.storageService.getPresignedDownloadUrl(rawKey, 3600);
    return { url };
  }

  @Get('file')
  @ApiOperation({ summary: 'Obtiene o visualiza un archivo almacenado en S3 o Local con soporte de streaming y Rangos' })
  async getFile(@Query('key') rawKey: string, @Res() res: Response): Promise<void> {
    if (!rawKey) throw new BadRequestException('Parámetro key es obligatorio.');

    let key = String(rawKey).trim();
    if (key.includes('amazonaws.com/')) {
      key = key.split('amazonaws.com/')[1] || key;
    } else if (key.startsWith('/uploads/')) {
      key = key.replace(/^\/uploads\//, '');
    } else if (key.startsWith('uploads/')) {
      key = key.replace(/^uploads\//, '');
    }
    key = key.replace(/^[/\\]+/, '').replace(/\\/g, '/');

    try {
      if (this.storageService.isUsingS3()) {
        const presignedUrl = await this.storageService.getPresignedDownloadUrl(key, 3600);
        return res.redirect(HttpStatus.FOUND, presignedUrl);
      }

      // Modo Local con soporte nativo de Range Requests (HTTP 206) para video/audio
      const target = path.resolve(this.storageService.getLocalRoot(), ...key.split('/'));
      if (!target.startsWith(this.storageService.getLocalRoot()) || !existsSync(target)) {
        res.status(HttpStatus.NOT_FOUND).json({ message: 'Archivo no encontrado.' });
        return;
      }
      return res.sendFile(target, { acceptRanges: true, maxAge: 86400000 });
    } catch (err: any) {
      res.status(HttpStatus.NOT_FOUND).json({ message: 'Archivo no encontrado.', error: err?.message });
    }
  }

  @Put('local-upload')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Recibe el binario de un ticket local firmado' })
  async uploadLocal(
    @Req() request: Request,
    @Query('key') key: string,
    @Query('expires') expiresRaw: string,
    @Query('token') token: string,
  ): Promise<void> {
    const target = this.storageService.verifyLocalTicket(key, Number(expiresRaw), token);
    const maxBytes = this.storageService.getMaxFileSizeBytes();
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > maxBytes) throw new PayloadTooLargeException(`El archivo supera el límite de ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
      chunks.push(buffer);
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, Buffer.concat(chunks));
  }
}
