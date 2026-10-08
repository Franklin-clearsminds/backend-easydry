import { OcultarPreciosInterceptor } from '../../common/interceptors/ocultar-precios.interceptor.js';
import { Controller, Post, Body, HttpCode, HttpStatus, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { OperacionesService } from './operaciones.service.js';
import { CreateServicioDto } from './dto/create-servicio.dto.js';
import { UpdateServicioDto } from './dto/update-servicio.dto.js';
import { QueryServiciosDto } from './dto/query-servicios.dto.js';
import { DetailServicioDto } from './dto/detail-servicio.dto.js';
import { AsignarRecetaDto, ListRecetaDto, EliminarRecetaItemDto, SimularConsumoDto } from './dto/receta.dto.js';
import { ListConsumosServicioDto } from './dto/consumos-servicio.dto.js';
import { AprobarServicioDto, RechazarServicioDto, AprobarTodosDto, AnularServicioDto } from './dto/aprobaciones.dto.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';

import { Permiso } from '../../common/permisos/permisos.decorators.js';
@ApiTags('Operaciones y Lavados (100% POST)')
@UseInterceptors(OcultarPreciosInterceptor)
@Controller('operaciones')
@ApiBearerAuth()
export class OperacionesController {
  constructor(private readonly operacionesService: OperacionesService) {}

  // ──────────────────────────────────────────────────────────────────
  //  SERVICIOS DE LAVADO
  // ──────────────────────────────────────────────────────────────────

  @Permiso('servicios.ver')
  @Post('servicios/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar órdenes de servicio con filtros en body (POST Seguro)' })
  @ApiResponse({ status: 200, description: 'Lista de servicios filtrados' })
  async findAll(@Body() queryDto: QueryServiciosDto, @CurrentUser() user: any) {
    return this.operacionesService.findAll({
      sucursalId: queryDto?.sucursalId || queryDto?.agenciaId,
      agenciaId: queryDto?.agenciaId,
      regionId: queryDto?.regionId,
      estado: queryDto?.estado,
      search: queryDto?.search,
      page: queryDto?.page,
      pageSize: queryDto?.pageSize,
      sortField: queryDto?.sortField,
      sortOrder: queryDto?.sortOrder,
      bahiaId: queryDto?.bahiaId,
      operadorId: queryDto?.operadorId,
      servicioId: queryDto?.servicioId,
      clienteId: queryDto?.clienteId,
      agenciaNombre: queryDto?.agenciaNombre,
      bahiaNombre: queryDto?.bahiaNombre,
      operadorNombre: queryDto?.operadorNombre,
      clienteNombre: queryDto?.clienteNombre,
      fechaDesde: queryDto?.fechaDesde,
      fechaHasta: queryDto?.fechaHasta,
      incluirResumen: queryDto?.incluirResumen,
    }, user);
  }

  @Permiso('servicios.ver')
  @Post('servicios/detail')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Detalle completo: servicio + receta + consumos registrados al finalizar' })
  @ApiResponse({ status: 200, description: 'Detalle de la orden de lavado' })
  async findOne(@Body() detailDto: DetailServicioDto, @CurrentUser() user: any) {
    return this.operacionesService.findOne(detailDto.id, user);
  }

  @Permiso('servicios.ver')
  @Post('servicios/historial')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Registro de decisiones de un servicio: quién aprobó, rechazó, anuló o corrigió, con qué regla y por qué' })
  async historial(@Body() detailDto: DetailServicioDto, @CurrentUser() user: any) {
    return this.operacionesService.historialDecisiones(detailDto.id, user);
  }

  @Permiso('servicios.crear')
  @Post('servicios/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Registrar nuevo ingreso de vehículo a bahía (POST)',
    description: 'Con servicioCatalogoIds (2 o más) crea una fila por servicio en la misma OT y devuelve un arreglo.',
  })
  @ApiResponse({ status: 201, description: 'Servicio registrado con éxito. Incluye receta del catálogo.' })
  async create(
    @Body() createDto: CreateServicioDto,
    @CurrentUser() user: any,
  ) {
    return this.operacionesService.createMultiple(createDto, user.id, user);
  }

  @Permiso('servicios.editar')
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
  async update(@Body() updateDto: UpdateServicioDto, @CurrentUser() user: any) {
    return this.operacionesService.update(updateDto.id, updateDto, false, user);
  }

  @Permiso('servicios.anular')
  @Post('servicios/delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Anulación / Borrado Lógico de orden de servicio (Tombstone para Sync Móvil)',
    description: 'Marca el servicio con deletedAt: now(), estado: CANCELADO. En el siguiente sync/pull, la app móvil recibe _deleted: true y lo purga de SQLite.',
  })
  @ApiResponse({ status: 200, description: 'Servicio marcado como eliminado exitosamente' })
  async delete(@Body() body: AnularServicioDto, @CurrentUser() user: any) {
    return this.operacionesService.softDelete(body.id, body.motivo, body.reponerInsumos !== false, user);
  }

  // ──────────────────────────────────────────────────────────────────
  //  APROBACIONES Y CIERRE DIARIO (GERENCIA / SUPERVISIÓN)
  // ──────────────────────────────────────────────────────────────────

  @Permiso('aprobaciones.aprobar')
  @Post('servicios/aprobar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Aprobar orden de servicio finalizada (Cierre diario por Gerencia)' })
  @ApiResponse({ status: 200, description: 'Servicio aprobado con éxito' })
  async aprobarServicio(
    @Body() dto: AprobarServicioDto,
    @CurrentUser() user: any,
  ) {
    return this.operacionesService.aprobarServicio(dto.id, dto.observacion, user);
  }

  @Permiso('aprobaciones.rechazar')
  @Post('servicios/rechazar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rechazar orden de servicio por inconformidad técnica o calidad' })
  @ApiResponse({ status: 200, description: 'Servicio rechazado con motivo registrado' })
  async rechazarServicio(
    @Body() dto: RechazarServicioDto,
    @CurrentUser() user: any,
  ) {
    return this.operacionesService.rechazarServicio(dto.id, dto.motivo, user);
  }

  @Permiso('aprobaciones.aprobar.todos')
  @Post('servicios/aprobar-todos')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Aprobación masiva de todos los servicios FINALIZADOS de una agencia (Cierre diario)' })
  @ApiResponse({ status: 200, description: 'Conteo de servicios aprobados' })
  async aprobarTodos(
    @Body() dto: AprobarTodosDto,
    @CurrentUser() user: any,
  ) {
    return this.operacionesService.aprobarTodosServicios(
      user,
      dto.agenciaId || dto.sucursalId,
      dto.fecha,
      dto.requiereFotoSalida !== false,
    );
  }

  // ──────────────────────────────────────────────────────────────────
  //  RECETAS DE INSUMOS POR CATÁLOGO DE SERVICIO
  // ──────────────────────────────────────────────────────────────────

  @Permiso('recetas.gestionar')
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
  async asignarReceta(@Body() dto: AsignarRecetaDto, @CurrentUser('id') userId: string) {
    return this.operacionesService.asignarReceta(dto, userId);
  }

  @Permiso('recetas.ver')
  @Post('catalogos/recetas/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ver la receta de insumos completa de un servicio del catálogo' })
  @ApiResponse({ status: 200, description: 'Receta del catálogo de servicio' })
  async listReceta(@Body() dto: ListRecetaDto) {
    return this.operacionesService.listReceta(dto);
  }

  @Permiso('recetas.gestionar')
  @Post('catalogos/recetas/eliminar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Quitar un insumo de la receta de un servicio (COORD_BODEGA / ADMIN)' })
  @ApiResponse({ status: 404, description: 'Receta no encontrada' })
  async eliminarRecetaItem(@Body() dto: EliminarRecetaItemDto, @CurrentUser('id') userId: string) {
    return this.operacionesService.eliminarRecetaItem(dto, userId);
  }

  @Permiso('recetas.historial')
  @Post('catalogos/recetas/historial')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Historial de cambios de la receta de un servicio del catálogo (SUPER_ADMIN, ADMIN, COORD_BODEGA, ASISTENTE_BODEGA)',
    description: 'Cada cambio de receta (agregar, modificar cantidad, quitar un insumo) queda registrado con fecha, quién lo hizo, y el producto/cantidad exactos involucrados.',
  })
  @ApiResponse({ status: 200, description: 'Historial de cambios de receta, más reciente primero' })
  async listRecetaHistorial(@Body() dto: ListRecetaDto) {
    return this.operacionesService.listRecetaHistorial(dto);
  }

  @Permiso('consumos.ver')
  @Post('consumos/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Consumo de insumos por servicio realizado (SUPER_ADMIN, ADMIN, COORD_BODEGA, ASISTENTE_BODEGA)',
    description: 'Lista, por cada OT de lavado general y de servicios especiales, qué producto y qué cantidad se descontó, con filtros por tipo, agencia, fechas y búsqueda.',
  })
  async listConsumosPorServicio(@Body() dto: ListConsumosServicioDto) {
    return this.operacionesService.listConsumosPorServicio(dto);
  }

  @Permiso('servicios.crear')
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
