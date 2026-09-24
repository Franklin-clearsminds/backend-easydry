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
  CreateClienteDto,
  UpdateClienteDto,
  ListClientesDto,
  ToggleEstadoClienteDto,
  CreateMarcaDto,
  UpdateMarcaDto,
  ListMarcasDto,
  ToggleEstadoMarcaDto,
} from './dto/clientes.dto.js';
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
  AsignarOperadorBahiaDto,
  ListHistorialAsignacionesDto,
  DesasignarOperadorBahiaDto,
} from './dto/bahias.dto.js';
import {
  AsignarUsuarioAgenciaDto,
  ListUsuariosAgenciaDto,
  ToggleEstadoUsuarioDto,
  UpdateUsuarioDto,
  CreateUsuarioDto,
  DeleteUsuarioDto,
  ListOperadoresDto,
  CreateOperadorDto,
  UpdateOperadorDto,
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
  // 2. CLIENTES (CRUD + ESTADO)
  // =========================================================================

  @Post('clientes/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar clientes corporativos registrados (POST)' })
  async listClientes(@Body() dto: ListClientesDto) {
    return this.agenciasService.listClientes(dto);
  }

  @Post('clientes/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear nuevo cliente corporativo (SUPER_ADMIN, ADMIN)' })
  async createCliente(@Body() dto: CreateClienteDto, @CurrentUser() user: any) {
    this._requireAdmin(user, 'crear clientes');
    return this.agenciasService.createCliente(dto);
  }

  @Post('clientes/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar cliente corporativo existente (SUPER_ADMIN, ADMIN)' })
  async updateCliente(@Body() dto: UpdateClienteDto, @CurrentUser() user: any) {
    this._requireAdmin(user, 'actualizar clientes');
    return this.agenciasService.updateCliente(dto);
  }

  @Post('clientes/toggle-estado')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activar o desactivar cliente corporativo (0/1) (SUPER_ADMIN, ADMIN)' })
  async toggleEstadoCliente(@Body() dto: ToggleEstadoClienteDto, @CurrentUser() user: any) {
    this._requireAdmin(user, 'cambiar estado de clientes');
    return this.agenciasService.toggleEstadoCliente(dto);
  }

  // Endpoints retrocompatibles para marcas
  @Post('marcas/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar marcas (alias de clientes) (POST)' })
  async listMarcas(@Body() dto: ListMarcasDto) {
    return this.agenciasService.listClientes(dto);
  }

  @Post('marcas/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear nueva marca (alias de clientes) (SUPER_ADMIN, ADMIN)' })
  async createMarca(@Body() dto: CreateMarcaDto, @CurrentUser() user: any) {
    this._requireAdmin(user, 'crear marcas');
    return this.agenciasService.createCliente(dto);
  }

  @Post('marcas/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar marca (alias de clientes) (SUPER_ADMIN, ADMIN)' })
  async updateMarca(@Body() dto: UpdateMarcaDto, @CurrentUser() user: any) {
    this._requireAdmin(user, 'actualizar marcas');
    return this.agenciasService.updateCliente(dto);
  }

  @Post('marcas/toggle-estado')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activar o desactivar marca (alias de clientes) (SUPER_ADMIN, ADMIN)' })
  async toggleEstadoMarca(@Body() dto: ToggleEstadoMarcaDto, @CurrentUser() user: any) {
    this._requireAdmin(user, 'cambiar estado de marcas');
    return this.agenciasService.toggleEstadoCliente(dto);
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

  @Post('bahias/asignar-operador')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Asignar operador dinámico a una bahía con registro en historial (SUPER_ADMIN, ADMIN)' })
  @ApiResponse({ status: 200, description: 'Bahía actualizada con nuevo operador asignado' })
  async asignarOperador(
    @Body() dto: AsignarOperadorBahiaDto,
    @CurrentUser('id') userId: string,
    @CurrentUser() user: any,
  ) {
    this._requireAdmin(user, 'asignar operadores a bahías');
    return this.agenciasService.asignarOperadorABahia(dto, userId);
  }

  @Post('bahias/historial-asignaciones')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Consultar historial de asignaciones de operadores por bahía o por operador' })
  @ApiResponse({ status: 200, description: 'Listado histórico de asignaciones con fechas y responsables' })
  async historialAsignaciones(@Body() dto: ListHistorialAsignacionesDto) {
    return this.agenciasService.obtenerHistorialAsignaciones(dto);
  }

  @Post('bahias/listar-operadores')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar operadores activos asignados a una bahía' })
  @ApiResponse({ status: 200, description: 'Listado de operadores activos de la bahía' })
  async listarOperadoresBahia(@Body() body: { bahiaId: string }) {
    return this.agenciasService.listarOperadoresDeBahia(body.bahiaId);
  }

  @Post('bahias/desasignar-operador')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Desasignar un operador específico de una bahía (SUPER_ADMIN, ADMIN)' })
  @ApiResponse({ status: 200, description: 'Bahía actualizada sin el operador desasignado' })
  async desasignarOperador(
    @Body() dto: DesasignarOperadorBahiaDto,
    @CurrentUser('id') userId: string,
    @CurrentUser() user: any,
  ) {
    this._requireAdmin(user, 'desasignar operadores de bahías');
    return this.agenciasService.desasignarOperadorDeBahia(dto, userId);
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
  @ApiOperation({ summary: 'Listar usuarios del sistema o filtrados por agencia/rol/estado' })
  async listUsuarios(@Body() dto: ListUsuariosAgenciaDto, @CurrentUser() user: any) {
    return this.agenciasService.listUsuariosPorAgencia(dto, user?.role?.namerol || user?.role);
  }

  @Post('usuarios/toggle-estado')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activar o desactivar usuario (1/0) (SUPER_ADMIN, ADMIN)' })
  async toggleEstadoUsuario(@Body() dto: ToggleEstadoUsuarioDto, @CurrentUser() user: any) {
    this._requireAdmin(user, 'cambiar estado de usuarios');
    return this.agenciasService.toggleEstadoUsuario(dto);
  }

  @Post('usuarios/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar datos y estado de usuario (SUPER_ADMIN, ADMIN)' })
  async updateUsuario(@Body() dto: UpdateUsuarioDto, @CurrentUser() user: any) {
    this._requireAdmin(user, 'actualizar usuarios');
    return this.agenciasService.updateUsuario(dto, user);
  }

  @Post('usuarios/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear nuevo usuario con credenciales y contraseña (SUPER_ADMIN, ADMIN)' })
  async createUsuario(@Body() dto: CreateUsuarioDto, @CurrentUser() user: any) {
    this._requireAdmin(user, 'crear usuarios');
    return this.agenciasService.createUsuario(dto);
  }

  @Post('usuarios/delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Eliminar usuario de la base de datos (SUPER_ADMIN, ADMIN)' })
  async deleteUsuario(@Body() dto: DeleteUsuarioDto, @CurrentUser() user: any) {
    this._requireAdmin(user, 'eliminar usuarios');
    return this.agenciasService.deleteUsuario(dto);
  }

  // =========================================================================
  // 6. GESTIÓN OFICIAL DE OPERADORES DE BAHÍA (100% BASE DE DATOS)
  // =========================================================================

  @Post('operadores/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar operadores registrados en base de datos' })
  async listOperadores(@Body() dto: ListOperadoresDto, @CurrentUser() user?: any) {
    return this.agenciasService.listOperadores(dto, user);
  }

  @Post('operadores/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registrar nuevo operador y asignarlo a agencia y bahía en BD (SUPER_ADMIN, ADMIN)' })
  async createOperador(@Body() dto: CreateOperadorDto, @CurrentUser() user: any) {
    this._requireAdmin(user, 'crear operadores');
    return this.agenciasService.createOperador(dto, user?.id);
  }

  @Post('operadores/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar operador y su asignación de bahía en BD (SUPER_ADMIN, ADMIN)' })
  async updateOperador(@Body() dto: UpdateOperadorDto, @CurrentUser() user: any) {
    this._requireAdmin(user, 'editar operadores');
    return this.agenciasService.updateOperador(dto, user?.id);
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
    if (!['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'LIDER_AGENCIA', 'LIDER', 'APROBADOR', 'GERENTE', 'COORD_SERVICIOS_ESPECIALES'].includes(rol)) {
      throw new ForbiddenException(`No tiene permisos para ${accion}`);
    }
  }
}
