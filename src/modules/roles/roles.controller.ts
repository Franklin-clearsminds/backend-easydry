import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { RolesService } from './roles.service.js';
import { CreateRoleDto } from './dto/create-role.dto.js';
import { UpdateRoleDto } from './dto/update-role.dto.js';
import { QueryRolesDto, DetailRoleDto } from './dto/query-roles.dto.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';

import { Permiso } from '../../common/permisos/permisos.decorators.js';
@ApiTags('Roles (100% POST)')
@Controller('roles')
@ApiBearerAuth()
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Permiso('roles.ver')
  @Post('permisos/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar catálogo oficial de permisos/módulos desde BD (POST Seguro)' })
  @ApiResponse({ status: 200, description: 'Catálogo oficial de permisos obtenido exitosamente' })
  async listAvailablePermissions() {
    return this.rolesService.getAvailablePermissions();
  }

  @Permiso('roles.ver')
  @Post('modulos/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar módulos del sistema desde BD (POST Seguro)' })
  @ApiResponse({ status: 200, description: 'Lista de módulos obtenida exitosamente' })
  async listModulos(@Body() body?: { soloActivos?: boolean }) {
    return this.rolesService.listModulos(body?.soloActivos !== false);
  }

  @Permiso('roles.ver')
  @Post('list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar roles con fechas formateadas YYYY-MM-DD HH:mm:ss (POST Seguro)' })
  @ApiResponse({ status: 200, description: 'Lista de roles obtenida exitosamente' })
  async list(@Body() queryDto: QueryRolesDto, @CurrentUser() user: any) {
    return this.rolesService.findAll(queryDto, user?.role?.namerol || user?.role);
  }

  @Permiso('roles.ver')
  @Post('detail')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Obtener detalle de un rol por ID o namerol en el body (POST Seguro)' })
  @ApiResponse({ status: 200, description: 'Detalle del rol encontrado' })
  @ApiResponse({ status: 404, description: 'Rol no encontrado' })
  async detail(@Body() detailDto: DetailRoleDto) {
    return this.rolesService.findOne(detailDto.id);
  }

  @Permiso('usuarios.roles.crear')
  @Post('create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear un nuevo rol dinámico con permisos y estado (POST)' })
  @ApiResponse({ status: 201, description: 'Rol creado exitosamente' })
  @ApiResponse({ status: 409, description: 'El namerol ya existe' })
  async create(@Body() createDto: CreateRoleDto, @CurrentUser() user: any) {
    return this.rolesService.create(createDto, user);
  }

  @Permiso('usuarios.roles.editar')
  @Post('update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar namerol, estado (0/1) o array de permisos (POST Seguro)' })
  @ApiResponse({ status: 200, description: 'Rol actualizado exitosamente' })
  @ApiResponse({ status: 404, description: 'Rol no encontrado' })
  async update(@Body() updateDto: UpdateRoleDto, @CurrentUser() user: any) {
    return this.rolesService.update(updateDto, user);
  }

  @Permiso('usuarios.roles.eliminar')
  @Post('delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Eliminar o desactivar un rol por ID (POST Seguro)' })
  @ApiResponse({ status: 200, description: 'Rol eliminado exitosamente' })
  @ApiResponse({ status: 404, description: 'Rol no encontrado' })
  async delete(@Body() body: { id: string }, @CurrentUser() user: any) {
    return this.rolesService.delete(body.id, user);
  }
}

