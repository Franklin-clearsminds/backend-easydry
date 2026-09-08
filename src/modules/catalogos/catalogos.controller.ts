import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CatalogosService } from './catalogos.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import {
  CreateCatalogoServicioDto,
  UpdateCatalogoServicioDto,
  ListCatalogoServiciosDto,
  DeleteCatalogoServicioDto,
} from './dto/servicios.dto.js';

@ApiTags('Catálogo de Servicios (100% POST)')
@Controller('catalogos')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CatalogosController {
  constructor(private readonly catalogosService: CatalogosService) {}

  @Post('servicios/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar catálogo de servicios (GENERAL / ESPECIAL) con sus recetas de insumos' })
  @ApiResponse({ status: 200, description: 'Listado de servicios de catálogo' })
  async listServicios(@Body() dto?: ListCatalogoServiciosDto) {
    return this.catalogosService.listServicios(dto);
  }

  @Post('servicios/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear nuevo servicio en el catálogo maestro' })
  @ApiResponse({ status: 201, description: 'Servicio creado exitosamente' })
  async createServicio(@Body() dto: CreateCatalogoServicioDto) {
    return this.catalogosService.createServicio(dto);
  }

  @Post('servicios/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar servicio en el catálogo maestro' })
  @ApiResponse({ status: 200, description: 'Servicio actualizado exitosamente' })
  async updateServicio(@Body() dto: UpdateCatalogoServicioDto) {
    return this.catalogosService.updateServicio(dto);
  }

  @Post('servicios/delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Eliminar servicio del catálogo (si no tiene servicios asociados)' })
  @ApiResponse({ status: 200, description: 'Servicio eliminado exitosamente' })
  async deleteServicio(@Body() dto: DeleteCatalogoServicioDto) {
    return this.catalogosService.deleteServicio(dto.id);
  }
}
