import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ListarNotificacionesDto, MarcarLeidaDto } from './dto/notifications.dto.js';
import { SoloAutenticado } from '../../common/permisos/permisos.decorators.js';

/** Notificaciones propias del usuario autenticado: siempre filtradas por su propio id, nunca por rol/permiso. */
@ApiTags('Notificaciones')
@Controller('notifications')
@ApiBearerAuth()
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @SoloAutenticado()
  @Post('list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Historial paginado de notificaciones propias, más reciente primero' })
  async list(@Body() dto: ListarNotificacionesDto, @CurrentUser('id') userId: string) {
    return this.notificationsService.list(dto, userId);
  }

  @SoloAutenticado()
  @Post('resumen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cuántas notificaciones sin leer tiene el usuario (badge de la campanita)' })
  async resumen(@CurrentUser('id') userId: string) {
    return this.notificationsService.resumen(userId);
  }

  @SoloAutenticado()
  @Post('marcar-leida')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Marcar una notificación propia como leída' })
  async marcarLeida(@Body() dto: MarcarLeidaDto, @CurrentUser('id') userId: string) {
    return this.notificationsService.marcarLeida(dto.notificacionId, userId);
  }

  @SoloAutenticado()
  @Post('marcar-todas-leidas')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Marcar todas las notificaciones propias como leídas' })
  async marcarTodasLeidas(@CurrentUser('id') userId: string) {
    return this.notificationsService.marcarTodasLeidas(userId);
  }
}
