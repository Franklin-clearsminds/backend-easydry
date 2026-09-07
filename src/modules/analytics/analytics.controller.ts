import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { DashboardAnalyticsDto, ConsumoQuimicosAnalyticsDto } from './dto/analytics.dto.js';

@ApiTags('Analítica & Dashboards (100% POST)')
@Controller('analytics')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

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
}
