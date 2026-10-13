import { OcultarPreciosInterceptor } from '../../common/interceptors/ocultar-precios.interceptor.js';
import { Controller, Post, Body, HttpCode, HttpStatus, UseInterceptors } from '@nestjs/common';
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
import { AnularServicioEspecialDto } from './dto/aprobaciones.dto.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';

import { Permiso } from '../../common/permisos/permisos.decorators.js';
@ApiTags('Servicios Especiales y Detailing (100% POST)')
@UseInterceptors(OcultarPreciosInterceptor)
@Controller('operaciones/servicios-especiales')
@ApiBearerAuth()
export class ServiciosEspecialesController {
  constructor(private readonly service: ServiciosEspecialesService) {}

  @Permiso('especiales.ver')
  @Post('list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar servicios especiales (Pulido, Cerámico, Lavado de Motor)' })
  @ApiResponse({ status: 200, description: 'Lista paginada de servicios especiales' })
  async list(@Body() queryDto: QueryServicioEspecialDto, @CurrentUser() user: any) {
    return this.service.findAll(queryDto, user);
  }

  @Permiso('especiales.ver')
  @Post('detail')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Detalle de un servicio especial por ID o clientUuid' })
  @ApiResponse({ status: 200, description: 'Detalle completo' })
  async detail(@Body() body: { id: string }, @CurrentUser() user: any) {
    return this.service.findOne(body.id, user);
  }

  @Permiso('especiales.ver')
  @Post('historial')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Registro de decisiones de un servicio especial: quién lo anuló y por qué' })
  async historial(@Body() body: { id: string }, @CurrentUser() user: any) {
    return this.service.historialDecisiones(body.id, user);
  }

  @Permiso('servicios.especiales.crear')
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

  @Permiso('servicios.especiales.operar')
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

  @Permiso('servicios.especiales.operar')
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

  @Permiso('servicios.especiales.operar')
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

  @Permiso('servicios.especiales.operar')
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

  @Permiso('servicios.especiales.reasignar')
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

  @Permiso('servicios.especiales.anular')
  @Post('delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Anular o cancelar servicio especial (soft delete)' })
  @ApiResponse({ status: 200, description: 'Servicio especial cancelado' })
  async delete(@Body() body: AnularServicioEspecialDto, @CurrentUser() user: any) {
    return this.service.softDelete(body.id, body.motivo, user);
  }

  // `despachos.crear`: quien despacha (líder, Backup) necesita elegir al pulidor destinatario aunque no vea servicios especiales.
  @Permiso('especiales.ver', 'despachos.crear')
  @Post('pulidores')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar pulidores activos por región o sucursal' })
  @ApiResponse({ status: 200, description: 'Lista de pulidores zonales o de sucursal' })
  async pulidores(
    @Body() body: { regionId?: string; agenciaId?: string },
    @CurrentUser() user: any,
  ) {
    const limpio = (v?: string) => (v && String(v).trim() && !['null', 'undefined'].includes(String(v).trim()) ? String(v).trim() : undefined);
    // El servicio (`listarPulidoresPorRegion`) ya acota lo pedido al alcance real del usuario: fuerza
    // la región de un actor REGION y la agencia de un actor AGENCIA, pase lo que pase aquí. No hay
    // que adelantarle nada: si antes se rellenaba `regionId` con la región del propio usuario cuando
    // el cliente no mandaba ninguna, a un coordinador de alcance nacional (GLOBAL, sin región fija)
    // eso lo limitaba a los pulidores de su propia región aunque quisiera crear la OT en una agencia
    // de otra región — el pulidor fijo de esa agencia simplemente no aparecía en la lista.
    const regionId = limpio(body?.regionId);
    const agenciaId = limpio(body?.agenciaId);
    return this.service.listarPulidoresPorRegion(regionId, agenciaId, user);
  }

  @Permiso('especiales.ver')
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
    return this.service.obtenerStockPulidor(pulidorId, user);
  }
}
