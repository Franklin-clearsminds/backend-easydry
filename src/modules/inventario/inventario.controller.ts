import { OcultarPreciosInterceptor } from '../../common/interceptors/ocultar-precios.interceptor.js';
import { tienePermiso } from '../../common/permisos/capacidades.js';
import { Controller, Post, Body, HttpCode, HttpStatus, BadRequestException, ForbiddenException, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { InventarioService } from './inventario.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';

// DTOs
import { CreateEnvaseDto, UpdateEnvaseDto, ListEnvasesDto, DetailEnvaseDto } from './dto/envases.dto.js';
import { ListUnidadesDto, CreateUnidadDto, UpdateUnidadDto } from './dto/unidades.dto.js';
import { CreateInsumoDto, UpdateInsumoDto, ListInsumosDto, DetailInsumoDto, InsumosOpcionesDto } from './dto/insumos.dto.js';
import { ListStockDto, AjusteStockDto, ReajusteStockDto } from './dto/stock.dto.js';
import { RegistrarCompraDto, CrearDespachoDto, ConfirmarRecepcionDto, RechazarDespachoDto, ListMovimientosDto, ListDespachosDto } from './dto/movimientos.dto.js';
import { ListKardexDto } from './dto/kardex.dto.js';
import { StockResumenAgenciasDto, StockResumenPulidoresDto, StockResumenBodegasDto, InsumosServiciosDto } from './dto/stock-resumen.dto.js';
import { CrearAlertaDto, ListAlertasDto, AtenderAlertaDto, SincronizarAlertasDto } from './dto/alertas.dto.js';
import { CreateTipoProductoDto, UpdateTipoProductoDto, ListTiposProductoDto } from './dto/tipo-producto.dto.js';
import { CreatePresentacionDto, UpdatePresentacionDto, ListPresentacionesDto } from './dto/presentaciones.dto.js';
import { ListTiposMovimientoDto, ListMotivosDto, CreateMotivoDto, UpdateMotivoDto } from './dto/movimiento-catalogo.dto.js';
import { RegistrarMovimientoOperativoDto, ListMovimientosGlobalesDto, ListStockBajoDto } from './dto/movimiento-operacion.dto.js';
import { CreateBodegaDto, UpdateBodegaDto, ToggleActivaBodegaDto, DeleteBodegaDto } from './dto/bodegas.dto.js';

import { Permiso } from '../../common/permisos/permisos.decorators.js';
@ApiTags('Inventario & Bodega (100% POST)')
@UseInterceptors(OcultarPreciosInterceptor)
@Controller('inventario')
@ApiBearerAuth()
export class InventarioController {
  constructor(private readonly inventarioService: InventarioService) {}

  /** Aceptar y rechazar un envío son dos casillas sobre el mismo endpoint: se mira cuál se pidió. */
  private exigirCasillaRecepcion(accion: string | undefined, user: any) {
    const rechaza = accion === 'RECHAZADO';
    if (!tienePermiso(user, rechaza ? 'envios.rechazar' : 'envios.confirmar')) {
      throw new ForbiddenException(rechaza ? 'Tu rol no puede rechazar envíos.' : 'Tu rol no puede confirmar la recepción de envíos.');
    }
  }

  // ==============================================================
  // TIPOS DE ENVASE
  // ==============================================================

  @Permiso('inventario.ver')
  @Post('envases/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar catálogo de tipos de envase' })
  @ApiResponse({ status: 200, description: 'Lista de envases' })
  async listEnvases(@Body() dto: ListEnvasesDto) {
    return this.inventarioService.listEnvases(dto);
  }

  @Permiso('inventario.config.unidades')
  @Post('envases/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear nuevo tipo de envase (COORD_BODEGA / ADMIN / SUPER_ADMIN)' })
  @ApiResponse({ status: 201, description: 'Envase creado exitosamente' })
  @ApiResponse({ status: 409, description: 'Ya existe un envase con ese código' })
  async createEnvase(@Body() dto: CreateEnvaseDto) {
    return this.inventarioService.createEnvase(dto);
  }

  @Permiso('inventario.config.unidades')
  @Post('envases/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar tipo de envase' })
  async updateEnvase(@Body() dto: UpdateEnvaseDto) {
    return this.inventarioService.updateEnvase(dto);
  }

  // ==============================================================
  // UNIDADES DE MEDIDA
  // ==============================================================

  @Permiso('inventario.ver')
  @Post('unidades/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar catálogo de unidades de medida' })
  async listUnidades(@Body() dto: ListUnidadesDto) {
    return this.inventarioService.listUnidades(dto);
  }

  @Permiso('inventario.config.unidades')
  @Post('unidades/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear nueva unidad de medida (COORD_BODEGA / ADMIN)' })
  async createUnidad(@Body() dto: CreateUnidadDto) {
    return this.inventarioService.createUnidad(dto);
  }

  @Permiso('inventario.config.unidades')
  @Post('unidades/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar unidad de medida' })
  async updateUnidad(@Body() dto: UpdateUnidadDto) {
    return this.inventarioService.updateUnidad(dto);
  }

  // ==============================================================
  // INSUMOS (Catálogo Maestro)
  // ==============================================================

  // El formulario de Envíos necesita estos listados para armar el despacho: se abren también con sus permisos,
  // sin regalar el módulo de Inventario (mismo criterio que maquinaria/list con las pestañas del taller).
  @Permiso('inventario.ver', 'despachos.ver', 'envios.crear')
  @Post('insumos/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar catálogo maestro de insumos con filtros (auto-filtrado por servicios/agencia)' })
  async listInsumos(@Body() dto: ListInsumosDto, @CurrentUser() user: any) {
    return this.inventarioService.listInsumos(dto, user);
  }

  @Permiso('inventario.ver')
  @Post('insumos/detail')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ficha técnica completa de un insumo con stock por ubicación' })
  @ApiResponse({ status: 404, description: 'Insumo no encontrado' })
  async detailInsumo(@Body() dto: DetailInsumoDto) {
    return this.inventarioService.detailInsumo(dto.id);
  }

  @Permiso('inventario.productos.gestionar')
  @Post('insumos/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registrar nuevo insumo en catálogo (COORD_BODEGA / ADMIN)' })
  @ApiResponse({ status: 409, description: 'Ya existe un insumo con ese SKU' })
  async createInsumo(@Body() dto: CreateInsumoDto) {
    return this.inventarioService.createInsumo(dto);
  }

  @Permiso('inventario.productos.gestionar')
  @Post('insumos/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar datos, umbrales o estado de un insumo' })
  async updateInsumo(@Body() dto: UpdateInsumoDto) {
    return this.inventarioService.updateInsumo(dto);
  }

  // ==============================================================
  // STOCK — Existencias multi-ubicación
  // ==============================================================

  @Permiso('inventario.ver')
  @Post('insumos/opciones')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Insumos para un desplegable con buscador (mismo alcance por sede que insumos/list): { value, label, sublabel } paginado' })
  async opcionesInsumos(@Body() dto: InsumosOpcionesDto, @CurrentUser() user: any) {
    return this.inventarioService.listInsumosOpciones(dto, user);
  }

  @Permiso('inventario.ver')
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

  @Permiso('inventario.reajustar')
  @Post('stock/ajuste')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ajuste manual de stock por conteo físico, merma o daño (deja trazabilidad)' })
  @ApiResponse({ status: 404, description: 'Registro de stock no encontrado' })
  async ajusteStock(@Body() dto: AjusteStockDto, @CurrentUser() user: any) {
    return this.inventarioService.ajusteStock(dto, user.id);
  }

  @Permiso('inventario.reajustar')
  @Post('stock/reajuste')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reajuste de stock con auditoría (quién, cuándo, por qué) y foto de evidencia',
    description: 'Solo SUPER_ADMIN, ADMIN, COORD_BODEGA y ASISTENTE_BODEGA. El asistente solo en su bodega y en las agencias y pulidores de su región.',
  })
  @ApiResponse({ status: 403, description: 'Rol o bodega no autorizados' })
  @ApiResponse({ status: 400, description: 'Datos incompletos o cantidad inválida' })
  async reajustarStock(@Body() dto: ReajusteStockDto, @CurrentUser() user: any) {
    return this.inventarioService.reajustarStock(dto, user);
  }

  @Permiso('inventario.reajustar')
  @Post('stock/resumen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dashboard rápido: totales de stock, bajo mínimo y alertas pendientes' })
  async resumenStock(@Body() body: { agenciaId?: string; sucursalId?: string; pulidorId?: string }, @CurrentUser() user: any) {
    const agenciaId = await this.inventarioService.agenciaEnAlcance(user, body.agenciaId || body.sucursalId);
    const pulidorId = body.pulidorId ? await this.inventarioService.pulidorEnAlcance(user, body.pulidorId) : undefined;
    return this.inventarioService.resumenStock(agenciaId, pulidorId);
  }

  @Permiso('inventario.ver')
  @Post('stock/agencias-resumen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resumen consolidado de insumos por agencia' })
  async stockAgenciasResumen(@Body() dto: StockResumenAgenciasDto, @CurrentUser() user: any) {
    return this.inventarioService.obtenerStockAgenciasResumen(dto, user?.id);
  }

  @Permiso('inventario.ver', 'despachos.ver', 'envios.crear')
  @Post('bodegas/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar bodegas del sistema (Central y Regionales)' })
  async listBodegas(@CurrentUser() user: any) {
    return this.inventarioService.listBodegas(user?.id);
  }

  @Permiso('inventario.bodegas.gestionar')
  @Post('bodegas/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear nueva bodega regional vinculada estrictamente a una región (SUPER_ADMIN / ADMIN / COORD_BODEGA)' })
  async crearBodega(@Body() dto: CreateBodegaDto) {
    return this.inventarioService.crearBodega(dto);
  }

  @Permiso('inventario.bodegas.gestionar')
  @Post('bodegas/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar bodega (nombre, código, región, ciudad, etc.)' })
  async actualizarBodega(@Body() dto: UpdateBodegaDto) {
    return this.inventarioService.actualizarBodega(dto);
  }

  @Permiso('inventario.bodegas.estado')
  @Post('bodegas/toggle-activa')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activar o desactivar bodega regional' })
  async toggleActivaBodega(@Body() dto: ToggleActivaBodegaDto) {
    return this.inventarioService.toggleActivaBodega(dto);
  }

  @Permiso('inventario.bodegas.eliminar')
  @Post('bodegas/delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Eliminar bodega regional del sistema' })
  async eliminarBodega(@Body() dto: DeleteBodegaDto) {
    return this.inventarioService.eliminarBodega(dto);
  }

  @Permiso('inventario.ver')
  @Post('stock/bodegas-resumen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resumen de inventario en bodegas' })
  async stockBodegasResumen(@Body() dto: StockResumenBodegasDto, @CurrentUser() user: any) {
    return this.inventarioService.obtenerStockBodegasResumen(dto, user?.id);
  }

  @Permiso('inventario.kits.ver')
  @Post('stock/pulidores-resumen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resumen consolidado de insumos en kits de pulidores' })
  async stockPulidoresResumen(@Body() dto: StockResumenPulidoresDto, @CurrentUser() user: any) {
    return this.inventarioService.obtenerStockPulidoresResumen(dto, user?.id);
  }

  // ==============================================================
  // MOVIMIENTOS — Compras, Despachos y Recepción
  // ==============================================================

  @Permiso('inventario.productos.compra')
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

  @Permiso('inventario.despachar', 'envios.crear')
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

  @Permiso('inventario.despachar', 'envios.crear')
  @Post('despachos/crear')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Generar despacho químico a agencia o pulidor (Ruta canónica frontend)' })
  async crearDespachoDirecto(@Body() dto: CrearDespachoDto, @CurrentUser() user: any) {
    return this.inventarioService.crearDespacho(dto, user.id);
  }

  @Permiso('envios.confirmar', 'envios.rechazar')
  @Post('movimientos/despachos/confirmar-recepcion')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirmar o rechazar recepción física de un despacho (LIDER_AGENCIA / PULIDOR_FIJO / PULIDOR_MOVIL)',
    description:
      'Si accion=RECIBIDO: incrementa stock en destino. Si accion=RECHAZADO: devuelve las unidades a Bodega Central.',
  })
  async confirmarRecepcion(@Body() dto: ConfirmarRecepcionDto, @CurrentUser() user: any) {
    this.exigirCasillaRecepcion(dto.accion, user);
    return this.inventarioService.confirmarRecepcion(dto, user.id);
  }

  @Permiso('envios.confirmar', 'envios.rechazar')
  @Post('despachos/confirmar-recepcion')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirmar recepción física de químicos en agencia (Ruta canónica frontend)' })
  async confirmarRecepcionDirecto(@Body() dto: ConfirmarRecepcionDto, @CurrentUser() user: any) {
    const accion = dto.accion || 'RECIBIDO';
    this.exigirCasillaRecepcion(accion, user);
    return this.inventarioService.confirmarRecepcion({ ...dto, accion }, user.id);
  }

  @Permiso('envios.rechazar')
  @Post('despachos/rechazar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rechazar despacho químico recibido en agencia (devuelve stock a Bodega)' })
  async rechazarDespachoDirecto(@Body() dto: RechazarDespachoDto, @CurrentUser() user: any) {
    return this.inventarioService.rechazarDespacho(dto, user.id);
  }

  @Permiso('envios.faltantes')
  @Post('despachos/faltantes/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Faltantes de envíos recibidos de forma parcial, por resolver por la bodega de origen' })
  async listFaltantes(@Body() dto: { estado?: string }, @CurrentUser() user: any) {
    return this.inventarioService.listFaltantesDespacho(dto, user);
  }

  @Permiso('envios.faltantes')
  @Post('despachos/faltantes/resolver')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Devolver al stock o dar de baja lo que no llegó en un envío' })
  async resolverFaltante(@Body() dto: { id: string; resolucion: 'ENTREGADO' | 'DEVOLVER' | 'BAJA'; observacion?: string; evidencias?: string[] }, @CurrentUser() user: any) {
    return this.inventarioService.resolverFaltanteDespacho(dto, user);
  }

  @Permiso('despachos.ver')
  @Post('despachos/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar despachos de químicos con estado (EN_TRANSITO, RECIBIDO, RECHAZADO)' })
  async listDespachosDirecto(@Body() dto: ListDespachosDto, @CurrentUser() user: any) {
    return this.inventarioService.listDespachos(dto, user?.id);
  }

  @Permiso('despachos.ver')
  @Post('despachos/agencia/pendientes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Consultar despachos pendientes de confirmación para una agencia (LIDER_OPERADOR / LIDER_AGENCIA)' })
  async obtenerDespachosPendientesAgencia(
    @Body() dto: { agenciaId?: string; sucursalId?: string },
    @CurrentUser() user: any,
  ) {
    const targetAgencia = (await this.inventarioService.agenciaEnAlcance(user, dto.agenciaId || dto.sucursalId)) || user?.agenciaId || '';
    return this.inventarioService.obtenerDespachosPendientesAgencia(targetAgencia);
  }

  @Permiso('despachos.ver')
  @Post('despachos/pendientes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Consultar despachos en tránsito pendientes de confirmación según el usuario actual' })
  async obtenerDespachosPendientes(@CurrentUser() user: any) {
    return this.inventarioService.obtenerDespachosPendientes(user?.id);
  }

  @Permiso('inventario.ver')
  @Post('movimientos/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Historial de movimientos con filtros por tipo, estado, fecha y responsable' })
  async listMovimientos(@Body() dto: ListMovimientosDto, @CurrentUser() user: any) {
    return this.inventarioService.listMovimientos(dto, user);
  }

  // ==============================================================
  // ALERTAS DE STOCK
  // ==============================================================

  @Permiso('inventario.alertas.crear')
  @Post('alertas/crear')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Emitir alerta de bajo stock desde una agencia o kit pulidor (LIDER_AGENCIA / PULIDOR)',
  })
  async crearAlerta(@Body() dto: CrearAlertaDto, @CurrentUser() user: any) {
    // La agencia (o el kit) de la alerta sale del alcance del usuario: ver InventarioService.crearAlerta.
    return this.inventarioService.crearAlerta(dto, user);
  }

  @Permiso('alertas.ver')
  @Post('alertas/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bandeja de alertas para Bodega Central con filtros (ASISTENTE_BODEGA / COORD_BODEGA)' })
  async listAlertas(@Body() dto: ListAlertasDto, @CurrentUser() user: any) {
    return this.inventarioService.listAlertas(dto, user?.id);
  }

  @Permiso('inventario.alertas.atender')
  @Post('alertas/sincronizar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Genera las alertas de insumos requeridos por servicios asignados y sin stock (escribe en la base; el listado paginado ya no lo hace)',
  })
  async sincronizarAlertas(@Body() dto: SincronizarAlertasDto, @CurrentUser() user: any) {
    return this.inventarioService.sincronizarAlertas(user?.id, !!dto?.forzar);
  }

  @Permiso('inventario.alertas.atender')
  @Post('alertas/atender')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cambiar estado de alerta: EN_PROCESO | DESPACHADO | RESUELTO' })
  @ApiResponse({ status: 404, description: 'Alerta no encontrada' })
  async atenderAlerta(@Body() dto: AtenderAlertaDto, @CurrentUser() user: any) {
    return this.inventarioService.atenderAlerta(dto, user);
  }

  // ==============================================================
  // KARDEX (100% POST & DATAGRID)
  // ==============================================================

  @Permiso('inventario.ver')
  @Post('kardex/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Consultar Kardex contable y trazabilidad transaccional de insumos con DataGrid' })
  @ApiResponse({ status: 200, description: 'Listado paginado DataGrid del Kardex de inventario' })
  async listKardex(@Body() dto: ListKardexDto, @CurrentUser() user: any) {
    return this.inventarioService.listKardex(dto, user?.id);
  }

  // ==============================================================
  // TIPOS DE PRODUCTO (Catálogo Dinámico 100% POST)
  // ==============================================================

  @Permiso('inventario.ver')
  @Post('tipos/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar catálogo dinámico de tipos de producto' })
  async listTiposProducto(@Body() dto: ListTiposProductoDto) {
    return this.inventarioService.listTiposProducto(dto);
  }

  @Permiso('inventario.config.tipos')
  @Post('tipos/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear nuevo tipo de producto (Líquido, Polvo, Gel, etc.)' })
  async createTipoProducto(@Body() dto: CreateTipoProductoDto) {
    return this.inventarioService.createTipoProducto(dto);
  }

  @Permiso('inventario.config.tipos')
  @Post('tipos/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar tipo de producto o desactivarlo lógicamente' })
  async updateTipoProducto(@Body() dto: UpdateTipoProductoDto) {
    return this.inventarioService.updateTipoProducto(dto);
  }

  // ==============================================================
  // PRESENTACIONES DEL PRODUCTO (100% POST)
  // ==============================================================

  @Permiso('inventario.ver')
  @Post('presentaciones/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar presentaciones asociadas a un insumo/producto' })
  async listPresentaciones(@Body() dto: ListPresentacionesDto) {
    return this.inventarioService.listPresentaciones(dto);
  }

  @Permiso('inventario.config.unidades')
  @Post('presentaciones/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear nueva presentación con factor de equivalencia a unidad base' })
  async createPresentacion(@Body() dto: CreatePresentacionDto) {
    return this.inventarioService.createPresentacion(dto);
  }

  @Permiso('inventario.config.unidades')
  @Post('presentaciones/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar o desactivar presentación' })
  async updatePresentacion(@Body() dto: UpdatePresentacionDto) {
    return this.inventarioService.updatePresentacion(dto);
  }

  // ==============================================================
  // TIPOS Y MOTIVOS DE MOVIMIENTO (100% POST)
  // ==============================================================

  @Permiso('inventario.ver')
  @Post('movimiento-tipos/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar catálogo de tipos de movimiento (ENTRY, CONSUMPTION, etc.)' })
  async listTiposMovimiento(@Body() dto: ListTiposMovimientoDto) {
    return this.inventarioService.listTiposMovimiento(dto);
  }

  @Permiso('inventario.ver')
  @Post('motivos/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar motivos de movimiento configurables' })
  async listMotivos(@Body() dto: ListMotivosDto) {
    return this.inventarioService.listMotivos(dto);
  }

  @Permiso('inventario.config.tipos')
  @Post('motivos/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear nuevo motivo de movimiento' })
  async createMotivo(@Body() dto: CreateMotivoDto) {
    return this.inventarioService.createMotivo(dto);
  }

  @Permiso('inventario.config.tipos')
  @Post('motivos/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar motivo de movimiento' })
  async updateMotivo(@Body() dto: UpdateMotivoDto) {
    return this.inventarioService.updateMotivo(dto);
  }

  // ==============================================================
  // MOVIMIENTOS GLOBALES & REGISTRO CENTRALIZADO (Kardex Atómico)
  // ==============================================================

  @Permiso('inventario.reajustar')
  @Post('movimientos/registrar')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Registrar movimiento operativo (Entrada, Consumo, Merma) con cálculo automático en unidad base y prevención de saldo negativo',
  })
  async registrarMovimiento(@Body() dto: RegistrarMovimientoOperativoDto, @CurrentUser() user: any) {
    return this.inventarioService.registrarMovimientoGlobal(dto, user?.id || user?.sub);
  }

  @Permiso('inventario.ver')
  @Post('movimientos/historial')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Historial de Kardex filtrado por rol: Admin/SuperAdmin=todo, Coord=Bodega Central, Asistente=su bodega regional',
  })
  async listMovimientosHistorial(@Body() dto: ListMovimientosGlobalesDto, @CurrentUser() user: any) {
    return this.inventarioService.listMovimientosGlobales(dto, user?.id || user?.sub);
  }

  // ==============================================================
  // DASHBOARD & ALERTAS DE STOCK BAJO (Datos Reales de BD)
  // ==============================================================

  @Permiso('inventario.ver')
  @Post('dashboard/resumen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resumen en tiempo real para el Dashboard de Inventario (últimos movimientos según rol)' })
  async getDashboardResumen(@CurrentUser() user: any) {
    return this.inventarioService.obtenerResumenDashboard(user?.id || user?.sub);
  }

  @Permiso('pagina.inventario.stock-bajo')
  @Post('stock-bajo/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listado de productos cuyo stock actual es menor o igual al stock mínimo' })
  async listStockBajo(@Body() dto: ListStockBajoDto) {
    return this.inventarioService.listStockBajo(dto);
  }

  // ==============================================================
  // INSUMOS POR SERVICIOS DE AGENCIA (LÍDER OPERADOR) & CONSUMO OT
  // ==============================================================

  @Permiso('inventario.ver')
  @Post('agencia/insumos-servicios')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Obtener insumos requeridos por los servicios de una agencia con stock real y alertas (Líder Operador / Agencia)',
  })
  async insumosServiciosAgencia(
    @Body() body: InsumosServiciosDto,
    @CurrentUser() user: any,
  ) {
    const agenciaId = (await this.inventarioService.agenciaEnAlcance(user, body?.agenciaId || body?.sucursalId)) || user?.agenciaId;
    return this.inventarioService.obtenerInsumosServiciosAgencia(agenciaId, body?.servicioIds, body);
  }

  @Permiso('inventario.ver')
  @Post('pulidor/insumos-servicios')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Insumos requeridos por los servicios asignados al pulidor (kit personal)',
  })
  async insumosServiciosPulidor(
    @Body() body: InsumosServiciosDto,
    @CurrentUser() user: any,
  ) {
    const pulidorId = (await this.inventarioService.pulidorEnAlcance(user, body?.pulidorId)) || user?.id;
    return this.inventarioService.obtenerInsumosServiciosPulidor(pulidorId, body?.servicioIds, body);
  }
}
