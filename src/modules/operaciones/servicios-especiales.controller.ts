import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ServiciosEspecialesService } from './servicios-especiales.service.js';
import {
  QueryServicioEspecialDto,
  CreateServicioEspecialDto,
  IniciarServicioEspecialDto,
  CompletarServicioEspecialDto,
} from './dto/servicios-especiales.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';

@ApiTags('Servicios Especiales y Detailing (100% POST)')
@Controller('operaciones/servicios-especiales')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ServiciosEspecialesController {
  constructor(private readonly service: ServiciosEspecialesService) {}

  @Post('list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar servicios especiales (Pulido, Cerámico, Lavado de Motor)' })
  @ApiResponse({ status: 200, description: 'Lista paginada de servicios especiales' })
  async list(@Body() queryDto: QueryServicioEspecialDto, @CurrentUser() user: any) {
    return this.service.findAll(queryDto, user);
  }

  @Post('detail')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Detalle de un servicio especial por ID o clientUuid' })
  @ApiResponse({ status: 200, description: 'Detalle completo' })
  async detail(@Body() body: { id: string }) {
    return this.service.findOne(body.id);
  }

  @Post('crear')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear nuevo servicio especial de detailing' })
  @ApiResponse({ status: 201, description: 'Servicio especial registrado exitosamente' })
  async crear(
    @Body() dto: CreateServicioEspecialDto,
    @CurrentUser() user: any,
  ) {
    return this.service.create(dto, user?.id, user);
  }

  @Post('iniciar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Marcar inicio de trabajo en servicio especial con video inicial' })
  @ApiResponse({ status: 200, description: 'Servicio especial iniciado' })
  async iniciar(
    @Body() dto: IniciarServicioEspecialDto,
    @CurrentUser() user: any,
  ) {
    return this.service.iniciar({
      id: dto.id,
      operadorId: dto.operadorId || user?.id,
      videoInicialUrl: dto.videoInicialUrl,
    });
  }

  @Post('completar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Finalizar servicio especial con video final y calificación' })
  @ApiResponse({ status: 200, description: 'Servicio especial completado' })
  async completar(@Body() dto: CompletarServicioEspecialDto) {
    return this.service.completar(dto);
  }

  @Post('delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Anular o cancelar servicio especial (soft delete)' })
  @ApiResponse({ status: 200, description: 'Servicio especial cancelado' })
  async delete(@Body() body: { id: string; motivo?: string }) {
    return this.service.softDelete(body.id, body.motivo);
  }

  @Post('pulidores')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar pulidores activos por región' })
  @ApiResponse({ status: 200, description: 'Lista de pulidores zonales' })
  async pulidores(@Body() body: { regionId?: string }, @CurrentUser() user: any) {
    const regionId = body?.regionId || user?.regionId || '';
    return this.service.listarPulidoresPorRegion(regionId);
  }

  @Post('stock-pulidor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Consultar existencias de químicos en custodia del pulidor' })
  @ApiResponse({ status: 200, description: 'Inventario personal del pulidor' })
  async stockPulidor(@Body() body: { pulidorId?: string }, @CurrentUser() user: any) {
    const pulidorId = body?.pulidorId || user?.id || '';
    return this.service.obtenerStockPulidor(pulidorId);
  }
}
