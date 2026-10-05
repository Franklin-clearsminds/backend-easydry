import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { CerrarRetoDto, CreateRetoDto, DeleteRetoDto, ListRetosDto } from './dto/retos.dto.js';
import { RetosService } from './retos.service.js';

import { Permiso } from '../../common/permisos/permisos.decorators.js';
@ApiTags('Retos de productividad')
@ApiBearerAuth()
@Controller('retos')
export class RetosController {
  constructor(private readonly retosService: RetosService) {}

  @Permiso('retos.ver')
  @Post('list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar retos almacenados en PostgreSQL' })
  list(@Body() dto: ListRetosDto, @CurrentUser() user: any) {
    return this.retosService.list(dto, user);
  }

  @Permiso('retos.crear')
  @Post('create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear un reto de productividad' })
  create(@Body() dto: CreateRetoDto, @CurrentUser() user: any) {
    return this.retosService.create(dto, user);
  }

  @Permiso('retos.eliminar')
  @Post('delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Eliminar un reto' })
  delete(@Body() dto: DeleteRetoDto, @CurrentUser() user: any) {
    return this.retosService.delete(dto.id, user);
  }

  @Permiso('retos.crear')
  @Post('cerrar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cerrar un reto registrando ganador y resultado' })
  cerrar(@Body() dto: CerrarRetoDto, @CurrentUser() user: any) {
    return this.retosService.cerrar(dto, user);
  }
}
