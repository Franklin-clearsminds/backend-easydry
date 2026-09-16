import { Body, Controller, HttpCode, HttpStatus, PayloadTooLargeException, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
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
