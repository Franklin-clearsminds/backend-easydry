import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
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
  @ApiOperation({ summary: 'Genera un ticket de subida S3' })
  @ApiResponse({ status: 200, description: 'Ticket de subida generado' })
  getUploadTicket(@Body() dto: GenerateUploadTicketDto) {
    return this.storageService.generateUploadTicket(dto);
  }

}
