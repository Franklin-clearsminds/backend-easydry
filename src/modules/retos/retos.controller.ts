import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { CerrarRetoDto, CreateRetoDto, DeleteRetoDto, ListRetosDto, PersonasRetoDto, RankingRetoDto } from './dto/retos.dto.js';
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

  @Permiso('retos.ver')
  @Post('ranking')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Consultar vehículos atendidos para un reto' })
  ranking(@Body() dto: RankingRetoDto, @CurrentUser() user: any) {
    return this.retosService.ranking(dto.id, user);
  }

  @Permiso('retos.crear')
  @Post('pulidores')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar pulidores disponibles para retos' })
  pulidores(@CurrentUser() user: any) {
    return this.retosService.pulidores(user);
  }

  @Permiso('retos.crear')
  @Post('personas')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lavadores o pulidores que se pueden elegir como participantes (los del alcance de quien crea)' })
  personas(@Body() dto: PersonasRetoDto, @CurrentUser() user: any) {
    return this.retosService.personas(dto.tipo, user);
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

  @Permiso('retos.cerrar')
  @Post('cerrar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cerrar un reto registrando ganador y resultado' })
  cerrar(@Body() dto: CerrarRetoDto, @CurrentUser() user: any) {
    return this.retosService.cerrar(dto, user);
  }
}
