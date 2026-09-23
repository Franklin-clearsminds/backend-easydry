import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SyncService } from './sync.service.js';
import { SyncPushDto, ReplayDlqDto, QueryPendingMediaDto } from './dto/sync-push.dto.js';
import { SyncPullQueryDto } from './dto/sync-pull.dto.js';
import { RegisterPushTokenDto } from './dto/sync-device.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';

@ApiTags('Sincronización Offline Móvil')
@Controller('sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('ping')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sondeo ultrarrápido de latencia y reloj del servidor (Fast-Probe Heartbeat < 10ms)',
    description:
      'Permite al móvil verificar conectividad real hacia la API antes de disparar push/pull, ' +
      'evitando cuelgues por Lie-Fi o portales cautivos, y proporcionando serverTime para calibrar clock skew.',
  })
  @ApiResponse({ status: 200, description: 'Servidor alcanzable y operativo' })
  async ping() {
    return this.syncService.ping();
  }

  @Post(['push', 'operations'])
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Envío de cambios offline del móvil al backend (Idempotente)' })
  @ApiResponse({ status: 200, description: 'Lote o evento procesado con éxito' })
  async pushMutations(
    @Body() body: SyncPushDto,
    @CurrentUser('id') userId: string,
    @Headers('x-operation-id') headerOpId?: string,
    @Headers('idempotency-key') headerIdempotencyKey?: string,
  ) {
    return this.syncService.processPush(body, userId, headerOpId || headerIdempotencyKey);
  }

  @Post(['pull', 'delta'])
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Descarga incremental de cambios del servidor con parámetros en body (POST Seguro)' })
  @ApiResponse({ status: 200, description: 'Lista de servicios modificados' })
  async pullChanges(@Body() query: SyncPullQueryDto, @CurrentUser('id') userId: string) {
    return this.syncService.processPull(query, userId);
  }

  @Post('bootstrap')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Carga inicial de catálogos, bahías e insumos para inicializar app móvil' })
  @ApiResponse({ status: 200, description: 'Datos maestros para inicialización offline de la app' })
  async bootstrap(@CurrentUser('id') userId: string) {
    return this.syncService.getBootstrapData(userId);
  }

  @Post(['media/presigned-url', 'media/ticket'])
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Genera ticket/URL prefirmada para subida binaria desacoplada de fotos (S3/Cloud)' })
  @ApiResponse({ status: 200, description: 'Ticket con URL de subida directa sin saturar JSON' })
  async getMediaTicket(
    @Body()
    body: {
      clientUuid: string;
      type: string;
      fileName?: string;
      agenciaId?: string;
      servicioId?: string;
      category?: string;
      maquinariaId?: string;
      incidenteId?: string;
      contentType?: string;
    },
    @CurrentUser('id') userId: string,
  ) {
    if (body.type === 'FOTO_PERFIL' || body.category === 'PERFIL_USUARIO') {
      body.clientUuid = userId;
    }
    return this.syncService.generateMediaUploadTicket({
      ...body,
      userId: body.type === 'FOTO_PERFIL' || body.category === 'PERFIL_USUARIO' ? userId : undefined,
    } as any);
  }

  @Post('media/confirm')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Confirma la subida de foto y la asocia a la orden de trabajo' })
  @ApiResponse({ status: 200, description: 'Foto vinculada con éxito' })
  async confirmMediaUpload(
    @Body() body: {
      clientUuid: string;
      type: string;
      fileUrl: string;
      category?: string;
      maquinariaId?: string;
      incidenteId?: string;
      specialAction?: 'START' | 'PAUSE' | 'RESUME' | 'FINISH';
      specialOperatorId?: string;
      pauseReason?: string;
      resumeNotes?: string;
    },
    @CurrentUser() user: any,
  ) {
    return this.syncService.confirmMediaUpload(body, user);
  }

  @Post('media/pending')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Reconciliador de evidencias multimedia pendientes o huérfanas',
    description:
      'Permite a la app móvil verificar si las órdenes creadas offline ya tienen sus fotos registradas ' +
      'o si alguna quedó huérfana para reintentar la subida binaria de forma atómica.',
  })
  @ApiResponse({ status: 200, description: 'Estado de fotos de las órdenes consultadas' })
  async getPendingMedia(@Body() dto: QueryPendingMediaDto) {
    return this.syncService.getPendingMedia(dto.clientUuids);
  }

  @Post('dlq/list')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar mutaciones aisladas en la Dead-Letter Queue (Poison Pills)' })
  @ApiResponse({ status: 200, description: 'Lista de fallos de sincronización para soporte técnico' })
  async listDlq(@Body() body: { resuelto?: boolean }) {
    return this.syncService.listDeadLetterQueue(body?.resuelto);
  }

  @Post('dlq/resolve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Marcar mutación de DLQ como resuelta' })
  @ApiResponse({ status: 200, description: 'Registro actualizado' })
  async resolveDlq(@Body() body: { id: string; resuelto?: boolean }) {
    return this.syncService.resolveDeadLetterItem(body.id, body.resuelto !== false);
  }

  @Post('dlq/replay')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Re-ejecutar y reinyectar una mutación aislada en la DLQ al pipeline transaccional',
    description:
      'Permite a un administrador corregir parámetros fallidos (ej. bahía o SKU) y volver a aplicar la mutación. ' +
      'Si tiene éxito, marca resuelto: true y aplica el lavado.',
  })
  @ApiResponse({ status: 200, description: 'Mutación reinyectada y aplicada exitosamente' })
  @ApiResponse({ status: 400, description: 'Fallo al reaplicar la mutación' })
  async replayDlq(@Body() dto: ReplayDlqDto, @CurrentUser('id') userId: string) {
    return this.syncService.replayDeadLetterItem(dto.dlqId, dto.payloadCorregido, userId);
  }

  @Post('devices/register-push-token')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Registra el token Expo Push del dispositivo para recibir alertas críticas' })
  @ApiResponse({ status: 200, description: 'Push token registrado exitosamente' })
  async registerPushToken(
    @Body() dto: RegisterPushTokenDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.syncService.registerPushToken(dto, userId);
  }
}

