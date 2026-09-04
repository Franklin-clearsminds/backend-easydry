import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { InventarioService } from './inventario.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';

// DTOs
import { CreateEnvaseDto, UpdateEnvaseDto, ListEnvasesDto, DetailEnvaseDto } from './dto/envases.dto.js';
import { ListUnidadesDto, CreateUnidadDto, UpdateUnidadDto } from './dto/unidades.dto.js';
import { CreateInsumoDto, UpdateInsumoDto, ListInsumosDto, DetailInsumoDto } from './dto/insumos.dto.js';
import { ListStockDto, AjusteStockDto } from './dto/stock.dto.js';
import { RegistrarCompraDto, CrearDespachoDto, ConfirmarRecepcionDto, ListMovimientosDto } from './dto/movimientos.dto.js';
import { CrearAlertaDto, ListAlertasDto, AtenderAlertaDto } from './dto/alertas.dto.js';

@ApiTags('Inventario & Bodega (100% POST)')
@Controller('inventario')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class InventarioController {
  constructor(private readonly inventarioService: InventarioService) {}

  // ==============================================================
  // TIPOS DE ENVASE
  // ==============================================================

  @Post('envases/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar catálogo de tipos de envase' })
  @ApiResponse({ status: 200, description: 'Lista de envases' })
  async listEnvases(@Body() dto: ListEnvasesDto) {
    return this.inventarioService.listEnvases(dto);
  }

  @Post('envases/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear nuevo tipo de envase (COORD_BODEGA / ADMIN / SUPER_ADMIN)' })
  @ApiResponse({ status: 201, description: 'Envase creado exitosamente' })
  @ApiResponse({ status: 409, description: 'Ya existe un envase con ese código' })
  async createEnvase(@Body() dto: CreateEnvaseDto) {
    return this.inventarioService.createEnvase(dto);
  }

  @Post('envases/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar tipo de envase' })
  async updateEnvase(@Body() dto: UpdateEnvaseDto) {
    return this.inventarioService.updateEnvase(dto);
  }

  // ==============================================================
  // UNIDADES DE MEDIDA
  // ==============================================================

  @Post('unidades/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar catálogo de unidades de medida' })
  async listUnidades(@Body() dto: ListUnidadesDto) {
    return this.inventarioService.listUnidades(dto);
  }

  @Post('unidades/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear nueva unidad de medida (COORD_BODEGA / ADMIN)' })
  async createUnidad(@Body() dto: CreateUnidadDto) {
    return this.inventarioService.createUnidad(dto);
  }

  @Post('unidades/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar unidad de medida' })
  async updateUnidad(@Body() dto: UpdateUnidadDto) {
    return this.inventarioService.updateUnidad(dto);
  }

  // ==============================================================
  // INSUMOS (Catálogo Maestro)
  // ==============================================================

  @Post('insumos/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar catálogo maestro de insumos con filtros' })
  async listInsumos(@Body() dto: ListInsumosDto) {
    return this.inventarioService.listInsumos(dto);
  }

  @Post('insumos/detail')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ficha técnica completa de un insumo con stock por ubicación' })
  @ApiResponse({ status: 404, description: 'Insumo no encontrado' })
  async detailInsumo(@Body() dto: DetailInsumoDto) {
    return this.inventarioService.detailInsumo(dto.id);
  }

  @Post('insumos/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registrar nuevo insumo en catálogo (COORD_BODEGA / ADMIN)' })
  @ApiResponse({ status: 409, description: 'Ya existe un insumo con ese SKU' })
  async createInsumo(@Body() dto: CreateInsumoDto) {
    return this.inventarioService.createInsumo(dto);
  }

  @Post('insumos/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar datos, umbrales o estado de un insumo' })
  async updateInsumo(@Body() dto: UpdateInsumoDto) {
    return this.inventarioService.updateInsumo(dto);
  }

  // ==============================================================
  // STOCK — Existencias multi-ubicación
  // ==============================================================

  @Post('stock/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Consulta de stock con visibilidad basada en rol (nacional / regional / agencia / kit pulidor)',
  })
  async listStock(@Body() dto: ListStockDto, @CurrentUser() user: any) {
    return this.inventarioService.listStock(
      dto,
      user.id,
      user.roleDetails?.namerol ?? user.role?.namerol ?? '',
      user.agenciaId || user.sucursalId,
    );
  }

  @Post('stock/ajuste')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ajuste manual de stock por conteo físico, merma o daño (deja trazabilidad)' })
  @ApiResponse({ status: 404, description: 'Registro de stock no encontrado' })
  async ajusteStock(@Body() dto: AjusteStockDto, @CurrentUser() user: any) {
    return this.inventarioService.ajusteStock(dto, user.id);
  }

  @Post('stock/resumen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dashboard rápido: totales de stock, bajo mínimo y alertas pendientes' })
  async resumenStock(@Body() body: { agenciaId?: string; sucursalId?: string; pulidorId?: string }) {
    return this.inventarioService.resumenStock(body.agenciaId || body.sucursalId, body.pulidorId);
  }

  // ==============================================================
  // MOVIMIENTOS — Compras, Despachos y Recepción
  // ==============================================================

  @Post('movimientos/compras/registrar')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Registrar compra a proveedor e ingreso a Bodega Central (COORD_BODEGA)',
    description: 'Incrementa automáticamente el stock en BODEGA_CENTRAL por cada insumo en los detalles.',
  })
  @ApiResponse({ status: 409, description: 'Número de guía duplicado' })
  async registrarCompra(@Body() dto: RegistrarCompraDto, @CurrentUser() user: any) {
    return this.inventarioService.registrarCompra(dto, user.id);
  }

  @Post('movimientos/despachos/crear')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Generar despacho hacia una agencia o pulidor (ASISTENTE_BODEGA / COORD_BODEGA)',
    description: 'Descuenta de BODEGA_CENTRAL. El destino confirma la recepción en un paso posterior.',
  })
  @ApiResponse({ status: 400, description: 'Stock insuficiente en bodega' })
  async crearDespacho(@Body() dto: CrearDespachoDto, @CurrentUser() user: any) {
    return this.inventarioService.crearDespacho(dto, user.id);
  }

  @Post('movimientos/despachos/confirmar-recepcion')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirmar o rechazar recepción física de un despacho (LIDER_AGENCIA / PULIDOR_FIJO / PULIDOR_MOVIL)',
    description:
      'Si accion=RECIBIDO: incrementa stock en destino. Si accion=RECHAZADO: devuelve las unidades a Bodega Central.',
  })
  async confirmarRecepcion(@Body() dto: ConfirmarRecepcionDto, @CurrentUser() user: any) {
    return this.inventarioService.confirmarRecepcion(dto, user.id);
  }

  @Post('movimientos/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Historial de movimientos con filtros por tipo, estado, fecha y responsable' })
  async listMovimientos(@Body() dto: ListMovimientosDto) {
    return this.inventarioService.listMovimientos(dto);
  }

  // ==============================================================
  // ALERTAS DE STOCK
  // ==============================================================

  @Post('alertas/crear')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Emitir alerta de bajo stock desde una agencia o kit pulidor (LIDER_AGENCIA / PULIDOR)',
  })
  async crearAlerta(@Body() dto: CrearAlertaDto, @CurrentUser() user: any) {
    return this.inventarioService.crearAlerta(dto, user.id);
  }

  @Post('alertas/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bandeja de alertas para Bodega Central con filtros (ASISTENTE_BODEGA / COORD_BODEGA)' })
  async listAlertas(@Body() dto: ListAlertasDto) {
    return this.inventarioService.listAlertas(dto);
  }

  @Post('alertas/atender')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cambiar estado de alerta: EN_PROCESO | DESPACHADO | RESUELTO' })
  @ApiResponse({ status: 404, description: 'Alerta no encontrada' })
  async atenderAlerta(@Body() dto: AtenderAlertaDto) {
    return this.inventarioService.atenderAlerta(dto);
  }
}
