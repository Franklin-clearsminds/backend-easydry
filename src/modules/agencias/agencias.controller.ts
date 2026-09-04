import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AgenciasService } from './agencias.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';

// DTOs
import {
  CreateAgenciaDto,
  UpdateAgenciaDto,
  ListAgenciasDto,
  DetailAgenciaDto,
  ToggleEstadoAgenciaDto,
  ResumenAgenciaDto,
} from './dto/agencias.dto.js';
import {
  CreateMarcaDto,
  UpdateMarcaDto,
  ListMarcasDto,
  ToggleEstadoMarcaDto,
} from './dto/marcas.dto.js';
import {
  CreateRegionDto,
  UpdateRegionDto,
  ListRegionesDto,
  ToggleEstadoRegionDto,
} from './dto/regiones.dto.js';
import {
  CreateBahiaDto,
  UpdateBahiaDto,
  ListBahiasDto,
  ToggleActivaBahiaDto,
} from './dto/bahias.dto.js';
import {
  AsignarUsuarioAgenciaDto,
  ListUsuariosAgenciaDto,
} from './dto/usuarios-agencia.dto.js';

@ApiTags('Agencias, Bahías, Regiones y Marcas (100% POST)')
@Controller('agencias')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AgenciasController {
  constructor(private readonly agenciasService: AgenciasService) {}

  // =========================================================================
  // 1. REGIONES (CRUD + ESTADO)
  // =========================================================================

  @Post('regiones/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar regiones operativas con conteos (POST)' })
  async listRegiones(@Body() dto: ListRegionesDto) {
    return this.agenciasService.listRegiones(dto);
  }

  @Post('regiones/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear nueva región operativa (SUPER_ADMIN, ADMIN)' })
  async createRegion(@Body() dto: CreateRegionDto, @CurrentUser() user: any) {
    this._requireAdmin(user, 'crear regiones');
    return this.agenciasService.createRegion(dto);
  }

  @Post('regiones/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar región existente (SUPER_ADMIN, ADMIN)' })
  async updateRegion(@Body() dto: UpdateRegionDto, @CurrentUser() user: any) {
    this._requireAdmin(user, 'actualizar regiones');
    return this.agenciasService.updateRegion(dto);
  }

  @Post('regiones/toggle-estado')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activar o desactivar región (1/0) (SUPER_ADMIN, ADMIN)' })
  async toggleEstadoRegion(@Body() dto: ToggleEstadoRegionDto, @CurrentUser() user: any) {
    this._requireAdmin(user, 'cambiar estado de regiones');
    return this.agenciasService.toggleEstadoRegion(dto);
  }

  // =========================================================================
  // 2. MARCAS (CRUD + ESTADO)
  // =========================================================================

  @Post('marcas/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar marcas registradas (POST)' })
  async listMarcas(@Body() dto: ListMarcasDto) {
    return this.agenciasService.listMarcas(dto);
  }

  @Post('marcas/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear nueva marca (SUPER_ADMIN, ADMIN)' })
  async createMarca(@Body() dto: CreateMarcaDto, @CurrentUser() user: any) {
    this._requireAdmin(user, 'crear marcas');
    return this.agenciasService.createMarca(dto);
  }

  @Post('marcas/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar marca existente (SUPER_ADMIN, ADMIN)' })
  async updateMarca(@Body() dto: UpdateMarcaDto, @CurrentUser() user: any) {
    this._requireAdmin(user, 'actualizar marcas');
    return this.agenciasService.updateMarca(dto);
  }

  @Post('marcas/toggle-estado')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activar o desactivar marca (0/1) (SUPER_ADMIN, ADMIN)' })
  async toggleEstadoMarca(@Body() dto: ToggleEstadoMarcaDto, @CurrentUser() user: any) {
    this._requireAdmin(user, 'cambiar estado de marcas');
    return this.agenciasService.toggleEstadoMarca(dto);
  }

  // =========================================================================
  // 3. AGENCIAS (CRUD + DETALLE + DASHBOARD)
  // =========================================================================

  @Post('list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar agencias con filtros y conteos (POST)' })
  async listAgencias(@Body() dto: ListAgenciasDto, @CurrentUser() user: any) {
    return this.agenciasService.listAgencias(dto, user);
  }

  @Post('detail')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Obtener detalle completo de agencia: bahías, personal, stock, alertas' })
  async detailAgencia(@Body() dto: DetailAgenciaDto) {
    return this.agenciasService.detailAgencia(dto.id);
  }

  @Post('create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear nueva agencia (SUPER_ADMIN, ADMIN)' })
  async createAgencia(@Body() dto: CreateAgenciaDto, @CurrentUser() user: any) {
    this._requireAdmin(user, 'crear agencias');
    return this.agenciasService.createAgencia(dto);
  }

  @Post('update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar datos de agencia (SUPER_ADMIN, ADMIN, SUPERVISOR)' })
  async updateAgencia(@Body() dto: UpdateAgenciaDto, @CurrentUser() user: any) {
    this._requireSupervisorOrAdmin(user, 'editar agencias');
    return this.agenciasService.updateAgencia(dto);
  }

  @Post('toggle-estado')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activar o desactivar agencia (SUPER_ADMIN, ADMIN)' })
  async toggleEstadoAgencia(@Body() dto: ToggleEstadoAgenciaDto, @CurrentUser() user: any) {
    this._requireAdmin(user, 'activar o desactivar agencias');
    return this.agenciasService.toggleEstadoAgencia(dto);
  }

  @Post('resumen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dashboard ejecutivo de la agencia: servicios hoy, personal, stock crítico' })
  async resumenAgencia(@Body() dto: ResumenAgenciaDto, @CurrentUser() user: any) {
    return this.agenciasService.resumenAgencia(dto.agenciaId, user);
  }

  // =========================================================================
  // 4. BAHÍAS (CRUD + TOGGLE ACTIVA)
  // =========================================================================

  @Post('bahias/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar bahías de una agencia o del sistema' })
  async listBahias(@Body() dto: ListBahiasDto) {
    return this.agenciasService.listBahias(dto);
  }

  @Post('bahias/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear nueva bahía operativa (SUPER_ADMIN, ADMIN)' })
  async createBahia(@Body() dto: CreateBahiaDto, @CurrentUser() user: any) {
    this._requireAdmin(user, 'crear bahías');
    return this.agenciasService.createBahia(dto);
  }

  @Post('bahias/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar bahía operativa (ADMIN, SUPERVISOR, LIDER_AGENCIA)' })
  async updateBahia(@Body() dto: UpdateBahiaDto, @CurrentUser() user: any) {
    this._requireAgenciaManager(user, 'editar bahías');
    return this.agenciasService.updateBahia(dto);
  }

  @Post('bahias/toggle-activa')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Habilitar o inhabilitar bahía de lavado (ADMIN, SUPERVISOR, LIDER_AGENCIA)' })
  async toggleActivaBahia(@Body() dto: ToggleActivaBahiaDto, @CurrentUser() user: any) {
    this._requireAgenciaManager(user, 'modificar disponibilidad de bahías');
    return this.agenciasService.toggleActivaBahia(dto);
  }

  // =========================================================================
  // 5. ASIGNACIÓN DE USUARIOS A AGENCIAS Y REGIONES
  // =========================================================================

  @Post('usuarios/asignar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Asignar o reasignar usuario a una agencia o región (SUPER_ADMIN, ADMIN)' })
  async asignarUsuario(@Body() dto: AsignarUsuarioAgenciaDto, @CurrentUser() user: any) {
    this._requireAdmin(user, 'asignar usuarios a agencias o regiones');
    return this.agenciasService.asignarUsuario(dto);
  }

  @Post('usuarios/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar personal asignado a una agencia (ADMIN, SUPERVISOR, LIDER_AGENCIA)' })
  async listUsuarios(@Body() dto: ListUsuariosAgenciaDto) {
    return this.agenciasService.listUsuariosPorAgencia(dto);
  }

  // =========================================================================
  // HELPERS DE PERMISOS POR ROL
  // =========================================================================

  private _getRole(user: any): string {
    return user?.role?.namerol || user?.roleDetails?.namerol || (typeof user?.role === 'string' ? user.role : '');
  }

  private _requireAdmin(user: any, accion: string) {
    const rol = this._getRole(user);
    if (!['SUPER_ADMIN', 'ADMIN'].includes(rol)) {
      throw new ForbiddenException(`Solo SUPER_ADMIN o ADMIN pueden ${accion}`);
    }
  }

  private _requireSupervisorOrAdmin(user: any, accion: string) {
    const rol = this._getRole(user);
    if (!['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR'].includes(rol)) {
      throw new ForbiddenException(`No tiene permisos para ${accion}`);
    }
  }

  private _requireAgenciaManager(user: any, accion: string) {
    const rol = this._getRole(user);
    if (!['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'LIDER_AGENCIA'].includes(rol)) {
      throw new ForbiddenException(`No tiene permisos para ${accion}`);
    }
  }
}
