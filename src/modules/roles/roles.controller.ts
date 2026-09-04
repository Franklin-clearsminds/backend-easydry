import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { RolesService } from './roles.service.js';
import { CreateRoleDto } from './dto/create-role.dto.js';
import { UpdateRoleDto } from './dto/update-role.dto.js';
import { QueryRolesDto, DetailRoleDto } from './dto/query-roles.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

@ApiTags('Roles (100% POST)')
@Controller('roles')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Post('permisos/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar catálogo oficial de permisos disponibles del sistema (POST Seguro)' })
  @ApiResponse({ status: 200, description: 'Catálogo oficial de permisos obtenido exitosamente' })
  async listAvailablePermissions() {
    return this.rolesService.getAvailablePermissions();
  }

  @Post('list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar roles con fechas formateadas YYYY-MM-DD HH:mm:ss (POST Seguro)' })
  @ApiResponse({ status: 200, description: 'Lista de roles obtenida exitosamente' })
  async list(@Body() queryDto: QueryRolesDto) {
    return this.rolesService.findAll(queryDto);
  }

  @Post('detail')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Obtener detalle de un rol por ID o namerol en el body (POST Seguro)' })
  @ApiResponse({ status: 200, description: 'Detalle del rol encontrado' })
  @ApiResponse({ status: 404, description: 'Rol no encontrado' })
  async detail(@Body() detailDto: DetailRoleDto) {
    return this.rolesService.findOne(detailDto.id);
  }

  @Post('create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear un nuevo rol dinámico con permisos y estado (POST)' })
  @ApiResponse({ status: 201, description: 'Rol creado exitosamente' })
  @ApiResponse({ status: 409, description: 'El namerol ya existe' })
  async create(@Body() createDto: CreateRoleDto) {
    return this.rolesService.create(createDto);
  }

  @Post('update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar namerol, estado (0/1) o array de permisos (POST Seguro)' })
  @ApiResponse({ status: 200, description: 'Rol actualizado exitosamente' })
  @ApiResponse({ status: 404, description: 'Rol no encontrado' })
  async update(@Body() updateDto: UpdateRoleDto) {
    return this.rolesService.update(updateDto);
  }
}
