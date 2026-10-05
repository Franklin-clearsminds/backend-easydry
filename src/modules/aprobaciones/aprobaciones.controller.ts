import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AprobacionesService } from './aprobaciones.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { SolicitarAprobacionDto, DecidirAprobacionDto, ListAprobacionesDto } from './dto/aprobaciones.dto.js';

import { Permiso } from '../../common/permisos/permisos.decorators.js';
@ApiTags('Gobernanza & Aprobaciones (100% POST)')
@Controller('aprobaciones')
@ApiBearerAuth()
export class AprobacionesController {
  constructor(private readonly aprobacionesService: AprobacionesService) {}

  @Permiso('solicitudes.ver')
  @Post('list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bandeja de solicitudes de aprobación con DataGrid (Rol APROBADOR, LÍDER, ADMIN)' })
  @ApiResponse({ status: 200, description: 'Listado paginado DataGrid de solicitudes' })
  async list(
    @Body() dto: ListAprobacionesDto,
    @CurrentUser() user: any,
  ) {
    return this.aprobacionesService.list(dto, user);
  }

  @Permiso('solicitudes.crear')
  @Post('solicitar')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear nueva solicitud de aprobación (Despachos altos, mermas, repuestos)' })
  @ApiResponse({ status: 201, description: 'Solicitud creada con estado PENDIENTE' })
  async solicitar(
    @Body() dto: SolicitarAprobacionDto,
    @CurrentUser() user: any,
  ) {
    return this.aprobacionesService.solicitar(dto, user);
  }

  @Permiso('servicios.decidir')
  @Post('aprobar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Aprobar solicitud (Rol APROBADOR, ADMIN, SUPER_ADMIN)' })
  @ApiResponse({ status: 200, description: 'Solicitud aprobada exitosamente' })
  async aprobar(
    @Body() dto: DecidirAprobacionDto,
    @CurrentUser() user: any,
  ) {
    return this.aprobacionesService.aprobar(dto, user);
  }

  @Permiso('servicios.decidir')
  @Post('rechazar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rechazar solicitud con motivo justificado (Rol APROBADOR, ADMIN)' })
  @ApiResponse({ status: 200, description: 'Solicitud rechazada' })
  async rechazar(
    @Body() dto: DecidirAprobacionDto,
    @CurrentUser() user: any,
  ) {
    return this.aprobacionesService.rechazar(dto, user);
  }
}
