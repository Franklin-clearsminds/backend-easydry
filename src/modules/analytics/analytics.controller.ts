import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import {
  DashboardAnalyticsDto,
  DashboardDedicadoDto,
  EstrellasAgenciaDto,
  ConsumoQuimicosAnalyticsDto,
  RankingLavadoresDto,
} from './dto/analytics.dto.js';

import { Permiso } from '../../common/permisos/permisos.decorators.js';
@ApiTags('Analítica & Dashboards (100% POST)')
@Controller('analytics')
@ApiBearerAuth()
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Permiso('dashboard.ver')
  @Post('dashboard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Métricas agregadas en tiempo real para el Dashboard Web (KPIs, tiempos, bahías)' })
  @ApiResponse({ status: 200, description: 'KPIs agregados calculados en el servidor' })
  async getDashboard(
    @Body() dto: DashboardAnalyticsDto,
    @CurrentUser() user: any,
  ) {
    return this.analyticsService.getDashboardMetrics(dto, user);
  }

  @Permiso('alertas.ver', 'incidentes.ver', 'mantenimientos.ver')
  @Post('pendientes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pendientes operativos del usuario (stock, incidentes, preventivos vencidos) para la bandeja de Notificaciones' })
  @ApiResponse({ status: 200, description: 'Lista ordenada por severidad, ya acotada al alcance del rol' })
  async getPendientes(@CurrentUser() user: any) {
    return this.analyticsService.getPendientes(user);
  }

  @Permiso('dashboard.ver')
  @Post('consumo-quimicos')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Consumo agregado de químicos e insumos por rango de fechas (Gráficas)' })
  @ApiResponse({ status: 200, description: 'Totales consumidos agrupados por insumo' })
  async getConsumoQuimicos(
    @Body() dto: ConsumoQuimicosAnalyticsDto,
    @CurrentUser() user: any,
  ) {
    return this.analyticsService.getConsumoQuimicos(dto, user);
  }

  @Permiso('usuarios.ver')
  @Post('ranking-lavadores')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ranking de lavadores: cantidad de servicios y tiempo promedio por servicio' })
  @ApiResponse({ status: 200, description: 'Top 10 operadores ordenados por cantidad de servicios' })
  async getRankingLavadores(
    @Body() dto: RankingLavadoresDto,
    @CurrentUser() user: any,
  ) {
    return this.analyticsService.getRankingLavadores(dto, user);
  }

  @Permiso('productividad.ver')
  @Post('ranking-pulidores')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ranking de pulidores fijos y móviles: cantidad de servicios y dinero' })
  async getRankingPulidores(
    @Body() dto: RankingLavadoresDto,
    @CurrentUser() user: any,
  ) {
    return this.analyticsService.getRankingPulidores(dto, user);
  }

  @Permiso('maquinaria.ver')
  @Post('dashboard-taller')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dashboard para Coordinador de Mantenimiento y Técnico: estado del parque, incidentes, tiempos y costos de reparación' })
  @ApiResponse({ status: 200, description: 'KPIs reales del taller técnico' })
  async getDashboardTaller(@Body() dto: DashboardDedicadoDto, @CurrentUser() user: any) {
    return this.analyticsService.getDashboardTaller(dto, user);
  }

  @Permiso('inventario.ver', 'maquinaria.ver', 'catalogo.ver')
  @Post('dashboard-bodega')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dashboard para Coordinador y Asistente de Bodega: alertas de stock, despachos en tránsito y consumo por categoría' })
  @ApiResponse({ status: 200, description: 'KPIs reales de bodega e inventario' })
  async getDashboardBodega(@Body() dto: DashboardDedicadoDto, @CurrentUser() user: any) {
    return this.analyticsService.getDashboardBodega(dto, user);
  }

  @Permiso('informes.ver', 'inspecciones.ver')
  @Post('dashboard-auditorias')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dashboard de auditorías: informes de inspección y auditorías 5S puntuados en estrellas' })
  @ApiResponse({ status: 200, description: 'Estrellas, distribución, evolución mensual y ranking de agencias' })
  async getDashboardAuditorias(@Body() dto: DashboardDedicadoDto, @CurrentUser() user: any) {
    return this.analyticsService.getDashboardAuditorias(dto, user);
  }

  @Permiso('informes.ver', 'inspecciones.ver')
  @Post('estrellas-agencia')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Estrellas de una agencia: última auditoría 5S y último informe de inspección' })
  @ApiResponse({ status: 200, description: 'Estrellas de la agencia del usuario (o de la pedida)' })
  async getEstrellasAgencia(@Body() dto: EstrellasAgenciaDto, @CurrentUser() user: any) {
    return this.analyticsService.getEstrellasAgencia(dto, user);
  }

  @Permiso('especiales.ver')
  @Post('dashboard-especiales')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dashboard para Coordinador y Pulidor de Servicios Especiales: estado de OTs, tiempos efectivos, calificación de calidad y cola activa' })
  @ApiResponse({ status: 200, description: 'KPIs reales de servicios especiales' })
  async getDashboardEspeciales(@Body() dto: DashboardDedicadoDto, @CurrentUser() user: any) {
    return this.analyticsService.getDashboardEspeciales(dto, user);
  }
}
