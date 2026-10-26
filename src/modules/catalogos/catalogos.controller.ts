import { OcultarPreciosInterceptor } from '../../common/interceptors/ocultar-precios.interceptor.js';
import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Request, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CatalogosService } from './catalogos.service.js';
import {
  CreateCatalogoServicioDto,
  UpdateCatalogoServicioDto,
  ListCatalogoServiciosDto,
  ServiciosOpcionesDto,
  EstadoCatalogoServicioDto,
  SiguienteCodigoServicioDto,
} from './dto/servicios.dto.js';

import { Permiso } from '../../common/permisos/permisos.decorators.js';
@ApiTags('Catálogo de Servicios (100% POST)')
@UseInterceptors(OcultarPreciosInterceptor)
@Controller('catalogos')
@ApiBearerAuth()
export class CatalogosController {
  constructor(private readonly catalogosService: CatalogosService) {}

  @Permiso('catalogo.ver')
  @Post('servicios/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar catálogo de servicios — auto-filtrado por agencia para roles LIDER/APROBADOR' })
  @ApiResponse({ status: 200, description: 'Lista de servicios (plain array para admins, objeto {servicios, agencia} para roles acotados)' })
  async listServicios(@Request() req: any, @Body() dto?: ListCatalogoServiciosDto) {
    const user = req.user;
    const userCtx = {
      agenciaId: user?.agenciaId || user?.agencia?.id || undefined,
      namerol: user?.roleDetails?.namerol || user?.role || undefined,
      capacidades: user?.roleDetails?.capacidades,
    };
    return this.catalogosService.listServicios(dto, userCtx);
  }

  @Permiso('catalogo.ver')
  @Post('servicios/opciones')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Servicios del catálogo para un desplegable con buscador (mismo alcance que servicios/list)' })
  async opcionesServicios(@Request() req: any, @Body() dto: ServiciosOpcionesDto) {
    const user = req.user;
    return this.catalogosService.listServiciosOpciones(dto, {
      agenciaId: user?.agenciaId || user?.agencia?.id || undefined,
      namerol: user?.roleDetails?.namerol || user?.role || undefined,
      capacidades: user?.roleDetails?.capacidades,
    });
  }

  @Permiso('catalogo.ver')
  @Post('servicios/siguiente-codigo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Siguiente código libre para un servicio nuevo (SER-### o ESP-###)' })
  async siguienteCodigo(@Body() dto: SiguienteCodigoServicioDto) {
    return this.catalogosService.siguienteCodigo(dto?.categoria);
  }

  @Permiso('catalogo.generales.crear', 'catalogo.especiales.crear')
  @Post('servicios/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear nuevo servicio en el catálogo maestro (general o especial según su casilla)' })
  @ApiResponse({ status: 201, description: 'Servicio creado exitosamente' })
  async createServicio(@Body() dto: CreateCatalogoServicioDto, @Request() req: any) {
    return this.catalogosService.createServicio(dto, req.user);
  }

  @Permiso('catalogo.generales.editar', 'catalogo.especiales.editar')
  @Post('servicios/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar datos de un servicio del catálogo (el precio no se cambia aquí)' })
  @ApiResponse({ status: 200, description: 'Servicio actualizado exitosamente' })
  async updateServicio(@Body() dto: UpdateCatalogoServicioDto, @Request() req: any) {
    return this.catalogosService.updateServicio(dto, req.user);
  }

  @Permiso('catalogo.generales.estado', 'catalogo.especiales.estado')
  @Post('servicios/estado')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activar o desactivar un servicio del catálogo (nunca se elimina)' })
  @ApiResponse({ status: 200, description: 'Estado actualizado' })
  async estadoServicio(@Body() dto: EstadoCatalogoServicioDto, @Request() req: any) {
    return this.catalogosService.cambiarEstadoServicio(dto.id, req.user);
  }
}
