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
  DeleteCatalogoServicioDto,
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
    });
  }

  @Permiso('catalogo.ver')
  @Post('servicios/siguiente-codigo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Siguiente código libre para un servicio nuevo (SER-### o ESP-###)' })
  async siguienteCodigo(@Body() dto: SiguienteCodigoServicioDto) {
    return this.catalogosService.siguienteCodigo(dto?.categoria);
  }

  @Permiso('catalogo.gestionar')
  @Post('servicios/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear nuevo servicio en el catálogo maestro' })
  @ApiResponse({ status: 201, description: 'Servicio creado exitosamente' })
  async createServicio(@Body() dto: CreateCatalogoServicioDto) {
    return this.catalogosService.createServicio(dto);
  }

  @Permiso('catalogo.gestionar')
  @Post('servicios/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar servicio en el catálogo maestro' })
  @ApiResponse({ status: 200, description: 'Servicio actualizado exitosamente' })
  async updateServicio(@Body() dto: UpdateCatalogoServicioDto) {
    return this.catalogosService.updateServicio(dto);
  }

  @Permiso('catalogo.gestionar')
  @Post('servicios/delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Eliminar servicio del catálogo (si no tiene servicios asociados)' })
  @ApiResponse({ status: 200, description: 'Servicio eliminado exitosamente' })
  async deleteServicio(@Body() dto: DeleteCatalogoServicioDto) {
    return this.catalogosService.deleteServicio(dto.id);
  }
}
