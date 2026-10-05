import {
  AgenciasOpcionesDto,
  BahiasOpcionesDto,
  ClientesOpcionesDto,
  OperadoresOpcionesDto,
  RegionesOpcionesDto,
  UsuariosOpcionesDto,
} from './dto/opciones.dto.js';
import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AgenciasService } from './agencias.service.js';
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
import { ListPreciosAgenciaDto, SetPreciosAgenciaDto } from './dto/precios-agencia.dto.js';
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

import { Permiso } from '../../common/permisos/permisos.decorators.js';
@ApiTags('Agencias, Bahías, Regiones y Marcas (100% POST)')
@Controller('agencias')
@ApiBearerAuth()
export class AgenciasController {
  constructor(private readonly agenciasService: AgenciasService) {}

  // =========================================================================
  // 1. REGIONES (CRUD + ESTADO)
  // =========================================================================

  @Permiso('agencias.ver')
  @Post('regiones/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar regiones operativas con conteos (POST)' })
  async listRegiones(@Body() dto: ListRegionesDto, @CurrentUser() user: any) {
    return this.agenciasService.listRegiones(dto, user);
  }

  @Permiso('agencias.ver')
  @Post('regiones/opciones')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Regiones para un desplegable con buscador: { value, label, sublabel } paginado' })
  async opcionesRegiones(@Body() dto: RegionesOpcionesDto) {
    return this.agenciasService.listRegionesOpciones(dto);
  }

  @Permiso('regiones.gestionar')
  @Post('regiones/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear nueva región operativa (SUPER_ADMIN, ADMIN)' })
  async createRegion(@Body() dto: CreateRegionDto, @CurrentUser() user: any) {
    return this.agenciasService.createRegion(dto);
  }

  @Permiso('regiones.gestionar')
  @Post('regiones/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar región existente (SUPER_ADMIN, ADMIN)' })
  async updateRegion(@Body() dto: UpdateRegionDto, @CurrentUser() user: any) {
    return this.agenciasService.updateRegion(dto);
  }

  @Permiso('regiones.gestionar')
  @Post('regiones/toggle-estado')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activar o desactivar región (1/0) (SUPER_ADMIN, ADMIN)' })
  async toggleEstadoRegion(@Body() dto: ToggleEstadoRegionDto, @CurrentUser() user: any) {
    return this.agenciasService.toggleEstadoRegion(dto);
  }

  // =========================================================================
  // 2. CLIENTES (CRUD + ESTADO)
  // =========================================================================

  @Permiso('agencias.ver')
  @Post('clientes/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar clientes corporativos registrados (POST)' })
  async listClientes(@Body() dto: ListClientesDto) {
    return this.agenciasService.listClientes(dto);
  }

  @Permiso('agencias.ver')
  @Post('clientes/opciones')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clientes/marcas para un desplegable con buscador: { value, label } paginado' })
  async opcionesClientes(@Body() dto: ClientesOpcionesDto) {
    return this.agenciasService.listClientesOpciones(dto);
  }

  @Permiso('agencias.ver')
  @Post('marcas/opciones')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Alias de clientes/opciones' })
  async opcionesMarcas(@Body() dto: ClientesOpcionesDto) {
    return this.agenciasService.listClientesOpciones(dto);
  }

  @Permiso('clientes.gestionar')
  @Post('clientes/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear nuevo cliente corporativo (SUPER_ADMIN, ADMIN)' })
  async createCliente(@Body() dto: CreateClienteDto, @CurrentUser() user: any) {
    return this.agenciasService.createCliente(dto);
  }

  @Permiso('clientes.gestionar')
  @Post('clientes/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar cliente corporativo existente (SUPER_ADMIN, ADMIN)' })
  async updateCliente(@Body() dto: UpdateClienteDto, @CurrentUser() user: any) {
    return this.agenciasService.updateCliente(dto);
  }

  @Permiso('clientes.gestionar')
  @Post('clientes/toggle-estado')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activar o desactivar cliente corporativo (0/1) (SUPER_ADMIN, ADMIN)' })
  async toggleEstadoCliente(@Body() dto: ToggleEstadoClienteDto, @CurrentUser() user: any) {
    return this.agenciasService.toggleEstadoCliente(dto);
  }

  // Endpoints retrocompatibles para marcas
  @Permiso('agencias.ver')
  @Post('marcas/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar marcas (alias de clientes) (POST)' })
  async listMarcas(@Body() dto: ListMarcasDto) {
    return this.agenciasService.listClientes(dto);
  }

  @Permiso('clientes.gestionar')
  @Post('marcas/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear nueva marca (alias de clientes) (SUPER_ADMIN, ADMIN)' })
  async createMarca(@Body() dto: CreateMarcaDto, @CurrentUser() user: any) {
    return this.agenciasService.createCliente(dto);
  }

  @Permiso('clientes.gestionar')
  @Post('marcas/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar marca (alias de clientes) (SUPER_ADMIN, ADMIN)' })
  async updateMarca(@Body() dto: UpdateMarcaDto, @CurrentUser() user: any) {
    return this.agenciasService.updateCliente(dto);
  }

  @Permiso('clientes.gestionar')
  @Post('marcas/toggle-estado')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activar o desactivar marca (alias de clientes) (SUPER_ADMIN, ADMIN)' })
  async toggleEstadoMarca(@Body() dto: ToggleEstadoMarcaDto, @CurrentUser() user: any) {
    return this.agenciasService.toggleEstadoCliente(dto);
  }

  // =========================================================================
  // 3. AGENCIAS (CRUD + DETALLE + DASHBOARD)
  // =========================================================================

  @Permiso('agencias.ver')
  @Post('list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar agencias con filtros y conteos (POST)' })
  async listAgencias(@Body() dto: ListAgenciasDto, @CurrentUser() user: any) {
    return this.agenciasService.listAgencias(dto, user);
  }

  @Permiso('agencias.ver')
  @Post('opciones')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Agencias para un desplegable con buscador (mismo alcance por rol que list): { value, label, sublabel } paginado' })
  async opcionesAgencias(@Body() dto: AgenciasOpcionesDto, @CurrentUser() user: any) {
    return this.agenciasService.listAgenciasOpciones(dto, user);
  }

  @Permiso('agencias.ver')
  @Post('detail')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Obtener detalle completo de agencia: bahías, personal, stock, alertas' })
  async detailAgencia(@Body() dto: DetailAgenciaDto, @CurrentUser() user: any) {
    return this.agenciasService.detailAgencia(dto.id, user);
  }

  @Permiso('agencias.crear')
  @Post('create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear nueva agencia (SUPER_ADMIN, ADMIN)' })
  async createAgencia(@Body() dto: CreateAgenciaDto, @CurrentUser() user: any) {
    return this.agenciasService.createAgencia(dto);
  }

  @Permiso('agencias.editar')
  @Post('update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar datos de agencia (SUPER_ADMIN, ADMIN, SUPERVISOR)' })
  async updateAgencia(@Body() dto: UpdateAgenciaDto, @CurrentUser() user: any) {
    return this.agenciasService.updateAgencia(dto, user);
  }

  @Permiso('agencias.ver')
  @Post('precios/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Precio de cada servicio general activo de la agencia (override propio o precio del catálogo)' })
  async listPreciosServicios(@Body() dto: ListPreciosAgenciaDto, @CurrentUser() user: any) {
    return this.agenciasService.listPreciosServicios(dto, user);
  }

  @Permiso('agencias.precios.gestionar')
  @Post('precios/set')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fijar el precio por agencia de uno o varios servicios generales (solo ADMIN/SUPER_ADMIN)' })
  async setPreciosServicios(@Body() dto: SetPreciosAgenciaDto, @CurrentUser() user: any) {
    return this.agenciasService.setPreciosServicios(dto, user);
  }

  @Permiso('agencias.estado')
  @Post('toggle-estado')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activar o desactivar agencia (SUPER_ADMIN, ADMIN)' })
  async toggleEstadoAgencia(@Body() dto: ToggleEstadoAgenciaDto, @CurrentUser() user: any) {
    return this.agenciasService.toggleEstadoAgencia(dto);
  }

  @Permiso('agencias.ver')
  @Post('resumen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dashboard ejecutivo de la agencia: servicios hoy, personal, stock crítico' })
  async resumenAgencia(@Body() dto: ResumenAgenciaDto, @CurrentUser() user: any) {
    return this.agenciasService.resumenAgencia(dto.agenciaId, user);
  }

  // =========================================================================
  // 4. BAHÍAS (CRUD + TOGGLE ACTIVA)
  // =========================================================================

  @Permiso('agencias.ver')
  @Post('bahias/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar bahías de una agencia o del sistema' })
  async listBahias(@Body() dto: ListBahiasDto, @CurrentUser() user: any) {
    return this.agenciasService.listBahias(dto, user);
  }

  @Permiso('agencias.ver')
  @Post('bahias/opciones')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bahías para un desplegable con buscador: { value, label, sublabel } paginado' })
  async opcionesBahias(@Body() dto: BahiasOpcionesDto, @CurrentUser() user: any) {
    return this.agenciasService.listBahiasOpciones(dto, user);
  }

  @Permiso('bahias.crear')
  @Post('bahias/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear nueva bahía operativa (SUPER_ADMIN, ADMIN)' })
  async createBahia(@Body() dto: CreateBahiaDto, @CurrentUser() user: any) {
    return this.agenciasService.createBahia(dto);
  }

  @Permiso('bahias.editar')
  @Post('bahias/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar bahía operativa (ADMIN, SUPERVISOR, LIDER_AGENCIA)' })
  async updateBahia(@Body() dto: UpdateBahiaDto, @CurrentUser() user: any) {
    return this.agenciasService.updateBahia(dto, user);
  }

  @Permiso('bahias.editar')
  @Post('bahias/toggle-activa')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Habilitar o inhabilitar bahía de lavado (ADMIN, SUPERVISOR, LIDER_AGENCIA)' })
  async toggleActivaBahia(@Body() dto: ToggleActivaBahiaDto, @CurrentUser() user: any) {
    return this.agenciasService.toggleActivaBahia(dto, user);
  }

  @Permiso('bahias.asignar')
  @Post('bahias/asignar-operador')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Asignar operador dinámico a una bahía con registro en historial (SUPER_ADMIN, ADMIN)' })
  @ApiResponse({ status: 200, description: 'Bahía actualizada con nuevo operador asignado' })
  async asignarOperador(
    @Body() dto: AsignarOperadorBahiaDto,
    @CurrentUser('id') userId: string,
    @CurrentUser() user: any,
  ) {
    return this.agenciasService.asignarOperadorABahia(dto, userId, user);
  }

  @Permiso('agencias.ver')
  @Post('bahias/historial-asignaciones')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Consultar historial de asignaciones de operadores por bahía o por operador' })
  @ApiResponse({ status: 200, description: 'Listado histórico de asignaciones con fechas y responsables' })
  async historialAsignaciones(@Body() dto: ListHistorialAsignacionesDto, @CurrentUser() user: any) {
    return this.agenciasService.obtenerHistorialAsignaciones(dto, user);
  }

  @Permiso('agencias.ver')
  @Post('bahias/listar-operadores')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar operadores activos asignados a una bahía' })
  @ApiResponse({ status: 200, description: 'Listado de operadores activos de la bahía' })
  async listarOperadoresBahia(@Body() body: { bahiaId: string }, @CurrentUser() user: any) {
    return this.agenciasService.listarOperadoresDeBahia(body.bahiaId, user);
  }

  @Permiso('bahias.asignar')
  @Post('bahias/desasignar-operador')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Desasignar un operador específico de una bahía (SUPER_ADMIN, ADMIN)' })
  @ApiResponse({ status: 200, description: 'Bahía actualizada sin el operador desasignado' })
  async desasignarOperador(
    @Body() dto: DesasignarOperadorBahiaDto,
    @CurrentUser('id') userId: string,
    @CurrentUser() user: any,
  ) {
    return this.agenciasService.desasignarOperadorDeBahia(dto, userId, user);
  }

  // =========================================================================
  // 5. ASIGNACIÓN DE USUARIOS A AGENCIAS Y REGIONES
  // =========================================================================

  @Permiso('usuarios.gestionar')
  @Post('usuarios/asignar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Asignar o reasignar usuario a una agencia o región (SUPER_ADMIN, ADMIN)' })
  async asignarUsuario(@Body() dto: AsignarUsuarioAgenciaDto, @CurrentUser() user: any) {
    return this.agenciasService.asignarUsuario(dto);
  }

  @Permiso('usuarios.ver')
  @Post('usuarios/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar usuarios del sistema o filtrados por agencia/rol/estado' })
  async listUsuarios(@Body() dto: ListUsuariosAgenciaDto, @CurrentUser() user: any) {
    return this.agenciasService.listUsuariosPorAgencia(dto, user);
  }

  @Permiso('usuarios.ver')
  @Post('usuarios/opciones')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Usuarios para un desplegable con buscador: { value, label, sublabel } paginado' })
  async opcionesUsuarios(@Body() dto: UsuariosOpcionesDto, @CurrentUser() user: any) {
    return this.agenciasService.listUsuariosOpciones(dto, user);
  }

  @Permiso('usuarios.gestionar')
  @Post('usuarios/toggle-estado')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activar o desactivar usuario (1/0) (SUPER_ADMIN, ADMIN)' })
  async toggleEstadoUsuario(@Body() dto: ToggleEstadoUsuarioDto, @CurrentUser() user: any) {
    return this.agenciasService.toggleEstadoUsuario(dto);
  }

  @Permiso('usuarios.gestionar')
  @Post('usuarios/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar datos y estado de usuario (SUPER_ADMIN, ADMIN)' })
  async updateUsuario(@Body() dto: UpdateUsuarioDto, @CurrentUser() user: any) {
    return this.agenciasService.updateUsuario(dto, user);
  }

  @Permiso('usuarios.gestionar')
  @Post('usuarios/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear nuevo usuario con credenciales y contraseña (SUPER_ADMIN, ADMIN)' })
  async createUsuario(@Body() dto: CreateUsuarioDto, @CurrentUser() user: any) {
    return this.agenciasService.createUsuario(dto, user);
  }

  @Permiso('usuarios.gestionar')
  @Post('usuarios/delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Eliminar usuario de la base de datos (SUPER_ADMIN, ADMIN)' })
  async deleteUsuario(@Body() dto: DeleteUsuarioDto, @CurrentUser() user: any) {
    return this.agenciasService.deleteUsuario(dto);
  }

  // =========================================================================
  // 6. GESTIÓN OFICIAL DE OPERADORES DE BAHÍA (100% BASE DE DATOS)
  // =========================================================================

  @Permiso('usuarios.ver')
  @Post('operadores/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar operadores registrados en base de datos' })
  async listOperadores(@Body() dto: ListOperadoresDto, @CurrentUser() user?: any) {
    return this.agenciasService.listOperadores(dto, user);
  }

  @Permiso('usuarios.ver')
  @Post('operadores/opciones')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Operadores para un desplegable con buscador (mismo alcance por rol que list): { value, label, sublabel } paginado' })
  async opcionesOperadores(@Body() dto: OperadoresOpcionesDto, @CurrentUser() user?: any) {
    return this.agenciasService.listOperadoresOpciones(dto, user);
  }

  @Permiso('operadores.gestionar')
  @Post('operadores/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registrar nuevo operador y asignarlo a agencia y bahía en BD (SUPER_ADMIN, ADMIN)' })
  async createOperador(@Body() dto: CreateOperadorDto, @CurrentUser() user: any) {
    return this.agenciasService.createOperador(dto, user?.id);
  }

  @Permiso('operadores.gestionar')
  @Post('operadores/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar operador y su asignación de bahía en BD (SUPER_ADMIN, ADMIN)' })
  async updateOperador(@Body() dto: UpdateOperadorDto, @CurrentUser() user: any) {
    return this.agenciasService.updateOperador(dto, user?.id);
  }

  // =========================================================================
  // HELPERS DE PERMISOS POR ROL
  // =========================================================================

  private _getRole(user: any): string {
    return user?.role?.namerol || user?.roleDetails?.namerol || (typeof user?.role === 'string' ? user.role : '');
  }
}
