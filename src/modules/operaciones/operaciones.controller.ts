import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { OperacionesService } from './operaciones.service.js';
import { CreateServicioDto } from './dto/create-servicio.dto.js';
import { UpdateServicioDto } from './dto/update-servicio.dto.js';
import { QueryServiciosDto } from './dto/query-servicios.dto.js';
import { DetailServicioDto } from './dto/detail-servicio.dto.js';
import { AsignarRecetaDto, ListRecetaDto, EliminarRecetaItemDto, SimularConsumoDto } from './dto/receta.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';

@ApiTags('Operaciones y Lavados (100% POST)')
@Controller('operaciones')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class OperacionesController {
  constructor(private readonly operacionesService: OperacionesService) {}

  // ──────────────────────────────────────────────────────────────────
  //  SERVICIOS DE LAVADO
  // ──────────────────────────────────────────────────────────────────

  @Post('servicios/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar órdenes de servicio con filtros en body (POST Seguro)' })
  @ApiResponse({ status: 200, description: 'Lista de servicios filtrados' })
  async findAll(@Body() queryDto: QueryServiciosDto) {
    return this.operacionesService.findAll({
      sucursalId: queryDto?.sucursalId,
      estado: queryDto?.estado,
      search: queryDto?.search,
    });
  }

  @Post('servicios/detail')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Detalle completo: servicio + receta + consumos registrados al finalizar' })
  @ApiResponse({ status: 200, description: 'Detalle de la orden de lavado' })
  async findOne(@Body() detailDto: DetailServicioDto) {
    return this.operacionesService.findOne(detailDto.id);
  }

  @Post('servicios/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registrar nuevo ingreso de vehículo a bahía (POST)' })
  @ApiResponse({ status: 201, description: 'Servicio registrado con éxito. Incluye receta del catálogo.' })
  async create(
    @Body() createDto: CreateServicioDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.operacionesService.create(createDto, userId);
  }

  @Post('servicios/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Actualizar estado del servicio. Al pasar a FINALIZADO, descuenta insumos automáticamente.',
    description:
      'Si el nuevo estado es FINALIZADO: verifica stock suficiente de insumos obligatorios en la agencia de la bahía. ' +
      'Si falta stock → 400 BadRequest. Si hay stock → descuenta y registra consumos.',
  })
  @ApiResponse({ status: 200, description: 'Servicio actualizado. Consumos incluidos en la respuesta.' })
  @ApiResponse({ status: 400, description: 'Stock insuficiente para finalizar el servicio' })
  async update(@Body() updateDto: UpdateServicioDto) {
    return this.operacionesService.update(updateDto.id, updateDto);
  }

  // ──────────────────────────────────────────────────────────────────
  //  RECETAS DE INSUMOS POR CATÁLOGO DE SERVICIO
  // ──────────────────────────────────────────────────────────────────

  @Post('catalogos/recetas/asignar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Asignar o actualizar la receta de insumos de un servicio del catálogo (COORD_BODEGA / ADMIN)',
    description:
      'Cada ítem define: insumoId, cantidadUsada, unidadConsumoId (puede ser ML aunque el insumo esté en L), ' +
      'y si es esOpcional (los opcionales no bloquean la finalización si no hay stock).',
  })
  @ApiResponse({ status: 200, description: 'Receta asignada/actualizada' })
  @ApiResponse({ status: 404, description: 'Catálogo o insumo no encontrado' })
  async asignarReceta(@Body() dto: AsignarRecetaDto) {
    return this.operacionesService.asignarReceta(dto);
  }

  @Post('catalogos/recetas/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ver la receta de insumos completa de un servicio del catálogo' })
  @ApiResponse({ status: 200, description: 'Receta del catálogo de servicio' })
  async listReceta(@Body() dto: ListRecetaDto) {
    return this.operacionesService.listReceta(dto);
  }

  @Post('catalogos/recetas/eliminar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Quitar un insumo de la receta de un servicio (COORD_BODEGA / ADMIN)' })
  @ApiResponse({ status: 404, description: 'Receta no encontrada' })
  async eliminarRecetaItem(@Body() dto: EliminarRecetaItemDto) {
    return this.operacionesService.eliminarRecetaItem(dto);
  }

  @Post('servicios/simular-consumo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Simular el consumo de insumos antes de finalizar (vista previa sin descontar)',
    description:
      'Devuelve qué insumos se descontarían, cuánto stock disponible hay, si hay suficiente, ' +
      'y si el servicio puede finalizar sin errores.',
  })
  async simularConsumo(@Body() dto: SimularConsumoDto) {
    return this.operacionesService.simularConsumo(dto);
  }
}
