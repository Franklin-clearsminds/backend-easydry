import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SyncService } from './sync.service.js';
import { SyncPushDto } from './dto/sync-push.dto.js';
import { SyncPullQueryDto } from './dto/sync-pull.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';

@ApiTags('Sincronización Offline Móvil')
@Controller('sync')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post(['push', 'operations'])
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Envío de cambios offline del móvil al backend (Idempotente)' })
  @ApiResponse({ status: 200, description: 'Lote o evento procesado con éxito' })
  async pushMutations(
    @Body() body: any,
    @CurrentUser('id') userId: string,
    @Headers('x-operation-id') headerOpId?: string,
    @Headers('idempotency-key') headerIdempotencyKey?: string,
  ) {
    return this.syncService.processPush(body, userId, headerOpId || headerIdempotencyKey);
  }

  @Post(['pull', 'delta'])
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Descarga incremental de cambios del servidor con parámetros en body (POST Seguro)' })
  @ApiResponse({ status: 200, description: 'Lista de servicios modificados' })
  async pullChanges(@Body() query: SyncPullQueryDto, @CurrentUser('id') userId: string) {
    return this.syncService.processPull(query, userId);
  }

  @Post('bootstrap')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Carga inicial de catálogos, bahías e insumos para inicializar app móvil' })
  @ApiResponse({ status: 200, description: 'Datos maestros para inicialización offline de la app' })
  async bootstrap(@CurrentUser('id') userId: string) {
    return this.syncService.getBootstrapData(userId);
  }

  @Post(['media/presigned-url', 'media/ticket'])
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Genera ticket/URL prefirmada para subida binaria desacoplada de fotos (S3/Cloud)' })
  @ApiResponse({ status: 200, description: 'Ticket con URL de subida directa sin saturar JSON' })
  async getMediaTicket(
    @Body() body: { clientUuid: string; type: 'FOTO_INGRESO' | 'FOTO_SALIDA'; fileName?: string },
  ) {
    return this.syncService.generateMediaUploadTicket(body);
  }

  @Post('media/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirma la subida de foto y la asocia a la orden de trabajo' })
  @ApiResponse({ status: 200, description: 'Foto vinculada con éxito' })
  async confirmMediaUpload(
    @Body() body: { clientUuid: string; type: 'FOTO_INGRESO' | 'FOTO_SALIDA'; fileUrl: string },
  ) {
    return this.syncService.confirmMediaUpload(body);
  }

  @Post('dlq/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar mutaciones aisladas en la Dead-Letter Queue (Poison Pills)' })
  @ApiResponse({ status: 200, description: 'Lista de fallos de sincronización para soporte técnico' })
  async listDlq(@Body() body: { resuelto?: boolean }) {
    return this.syncService.listDeadLetterQueue(body?.resuelto);
  }

  @Post('dlq/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Marcar mutación de DLQ como resuelta' })
  @ApiResponse({ status: 200, description: 'Registro actualizado' })
  async resolveDlq(@Body() body: { id: string; resuelto?: boolean }) {
    return this.syncService.resolveDeadLetterItem(body.id, body.resuelto !== false);
  }
}
