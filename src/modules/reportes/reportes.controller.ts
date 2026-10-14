import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permiso } from '../../common/permisos/permisos.decorators.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { GenerarReporteDto, RegistrarExportacionDto } from './dto/reportes.dto.js';
import { ReportesService } from './reportes.service.js';

@ApiTags('Reportes operativos')
@Controller('reportes')
@ApiBearerAuth()
export class ReportesController {
  constructor(private readonly service: ReportesService) {}

  @Permiso('reportes.ver')
  @Post('catalogo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reportes que el usuario puede sacar según los módulos activos de su rol' })
  catalogo(@CurrentUser() user: any) {
    return this.service.catalogo(user);
  }

  @Permiso('reportes.ver')
  @Post('opciones')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Regiones, clientes, agencias, productos y lavadores dentro del alcance del usuario' })
  opciones(@CurrentUser() user: any) {
    return this.service.opciones(user);
  }

  @Permiso('reportes.ver')
  @Post('generar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Genera un reporte (agrupado por agencia y periodo) con los filtros elegidos' })
  generar(@Body() dto: GenerarReporteDto, @CurrentUser() user: any) {
    return this.service.generar(dto, user);
  }

  @Permiso('reportes.excel', 'reportes.pdf')
  @Post('exportaciones')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Registra en la bitácora una exportación a Excel o PDF' })
  registrarExportacion(@Body() dto: RegistrarExportacionDto, @CurrentUser() user: any) {
    return this.service.registrarExportacion(dto, user);
  }

  @Permiso('roles.ver')
  @Post('bitacora')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Últimas exportaciones (solo ADMIN y SUPER_ADMIN)' })
  bitacora(@CurrentUser() user: any) {
    return this.service.bitacora(user);
  }
}
