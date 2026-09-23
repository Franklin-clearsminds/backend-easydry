import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ServiciosEspecialesService } from './servicios-especiales.service.js';
import {
  QueryServicioEspecialDto,
  CreateServicioEspecialDto,
  IniciarServicioEspecialDto,
  CompletarServicioEspecialDto,
  PausarServicioEspecialDto,
  ReanudarServicioEspecialDto,
  ReasignarServicioEspecialDto,
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
    }, user);
  }

  @Post('pausar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pausar servicio especial con motivo y video de pausa' })
  @ApiResponse({ status: 200, description: 'Servicio especial pausado exitosamente' })
  async pausar(
    @Body() dto: PausarServicioEspecialDto,
    @CurrentUser() user: any,
  ) {
    return this.service.pausar(dto, user);
  }

  @Post('reanudar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reanudar servicio especial con video de reanudación' })
  @ApiResponse({ status: 200, description: 'Servicio especial reanudado exitosamente' })
  async reanudar(
    @Body() dto: ReanudarServicioEspecialDto,
    @CurrentUser() user: any,
  ) {
    return this.service.reanudar(dto, user);
  }

  @Post('completar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Finalizar servicio especial con video final y calificación' })
  @ApiResponse({ status: 200, description: 'Servicio especial completado' })
  async completar(
    @Body() dto: CompletarServicioEspecialDto,
    @CurrentUser() user: any,
  ) {
    return this.service.completar(dto, user);
  }

  @Post('reasignar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reasignar servicio especial a otro pulidor' })
  @ApiResponse({ status: 200, description: 'Servicio especial reasignado' })
  async reasignar(
    @Body() dto: ReasignarServicioEspecialDto,
    @CurrentUser() user: any,
  ) {
    return this.service.reasignar(dto, user);
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
  @ApiOperation({ summary: 'Listar pulidores activos por región o sucursal' })
  @ApiResponse({ status: 200, description: 'Lista de pulidores zonales o de sucursal' })
  async pulidores(
    @Body() body: { regionId?: string; agenciaId?: string },
    @CurrentUser() user: any,
  ) {
    let regionId: string | undefined = undefined;
    if (body?.regionId && String(body.regionId).trim() && String(body.regionId).trim() !== 'null' && String(body.regionId).trim() !== 'undefined') {
      regionId = String(body.regionId).trim();
    } else if (user?.regionId && String(user.regionId).trim() && String(user.regionId).trim() !== 'null' && String(user.regionId).trim() !== 'undefined') {
      regionId = String(user.regionId).trim();
    }
    const agenciaId = body?.agenciaId && String(body.agenciaId).trim() && String(body.agenciaId).trim() !== 'null' ? String(body.agenciaId).trim() : undefined;
    return this.service.listarPulidoresPorRegion(regionId, agenciaId);
  }

  @Post('stock-pulidor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Consultar existencias de químicos en custodia del pulidor' })
  @ApiResponse({ status: 200, description: 'Inventario personal del pulidor' })
  async stockPulidor(@Body() body: { pulidorId?: string }, @CurrentUser() user: any) {
    let pulidorId = body?.pulidorId ? String(body.pulidorId).trim() : '';
    if (!pulidorId && user?.id) {
      const rol = (user?.role?.namerol || user?.roleDetails?.namerol || user?.role || '').toUpperCase();
      const isPulidor = rol.includes('PULIDOR');
      if (isPulidor) {
        pulidorId = String(user.id);
      }
    }
    if (!pulidorId) {
      return [];
    }
    return this.service.obtenerStockPulidor(pulidorId);
  }
}
