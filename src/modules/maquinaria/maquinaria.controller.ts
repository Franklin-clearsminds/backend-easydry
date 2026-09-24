import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { MaquinariaService } from './maquinaria.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import {
  CreateMaquinariaDto,
  UpdateMaquinariaDto,
  ListMaquinariaDto,
  ReportarIncidenteDto,
  ResolverIncidenteDto,
  ListIncidentesDto,
  RegistrarMantenimientoDto,
  EjecutarMantenimientoDto,
  ListMantenimientosDto,
  AsignarIncidenteDto,
  AsignarMantenimientoDto,
  TransferirMaquinariaDto,
  ListMovimientosMaquinariaDto,
} from './dto/maquinaria.dto.js';

@ApiTags('Taller & Maquinaria (100% POST)')
@Controller('maquinaria')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MaquinariaController {
  constructor(private readonly maquinariaService: MaquinariaService) {}

  // ==============================================================
  // MAQUINARIA
  // ==============================================================

  @Post('list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar maquinaria con filtros de agencia, bahía y estado' })
  async list(@Body() dto: ListMaquinariaDto) {
    return this.maquinariaService.list(dto);
  }

  @Post('create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registrar nueva maquinaria (ADMIN / COORD_MANTENIMIENTO)' })
  async create(@Body() dto: CreateMaquinariaDto) {
    return this.maquinariaService.create(dto);
  }

  @Post('update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar datos u horas de uso de maquinaria' })
  async update(@Body() dto: UpdateMaquinariaDto) {
    return this.maquinariaService.update(dto);
  }

  // ==============================================================
  // INCIDENTES TÉCNICOS
  // ==============================================================

  @Post('incidentes/reportar')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Reportar incidente técnico o avería de equipo (Técnicos u Operadores)' })
  async reportarIncidente(
    @Body() dto: ReportarIncidenteDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.maquinariaService.reportarIncidente(dto, userId);
  }

  @Post('incidentes/resolver')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolver incidente técnico reportado (Técnico de Mantenimiento)' })
  async resolverIncidente(
    @Body() dto: ResolverIncidenteDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.maquinariaService.resolverIncidente(dto, userId);
  }

  @Post('incidentes/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar incidentes técnicos con filtros de máquina y estado' })
  async listIncidentes(@Body() dto: ListIncidentesDto) {
    return this.maquinariaService.listIncidentes(dto);
  }

  // ==============================================================
  // MANTENIMIENTOS
  // ==============================================================

  @Post('mantenimientos/registrar')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registrar checklist o mantenimiento ejecutado en máquina' })
  async registrarMantenimiento(
    @Body() dto: RegistrarMantenimientoDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.maquinariaService.registrarMantenimiento(dto, userId);
  }

  @Post('mantenimientos/ejecutar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ejecutar un mantenimiento agendado. Requiere al menos una imagen.' })
  async ejecutarMantenimiento(
    @Body() dto: EjecutarMantenimientoDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.maquinariaService.ejecutarMantenimiento(dto, userId);
  }

  @Post('mantenimientos/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Historial de mantenimientos técnicos preventivos y correctivos' })
  async listMantenimientos(@Body() dto: ListMantenimientosDto) {
    return this.maquinariaService.listMantenimientos(dto);
  }

  @Post('incidentes/asignar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Asignar incidente a técnico o auto-asignarse (Ejecutar yo)' })
  async asignarIncidente(
    @Body() dto: AsignarIncidenteDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.maquinariaService.asignarIncidente(dto, userId);
  }

  @Post('mantenimientos/asignar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Asignar mantenimiento a técnico o auto-asignarse' })
  async asignarMantenimiento(
    @Body() dto: AsignarMantenimientoDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.maquinariaService.asignarMantenimiento(dto, userId);
  }

  @Post('transferir')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Transferir maquinaria a agencia operativa o taller (nacional/regional)' })
  async transferir(
    @Body() dto: TransferirMaquinariaDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.maquinariaService.transferirMaquinaria(dto, userId);
  }

  @Post('movimientos/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Historial de transferencias de maquinaria' })
  async listMovimientos(@Body() dto: ListMovimientosMaquinariaDto) {
    return this.maquinariaService.listMovimientos(dto);
  }

  @Post('talleres/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar talleres nacional y regionales' })
  async listTalleres() {
    return this.maquinariaService.listTalleres();
  }
}
