import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Permiso } from '../../common/permisos/permisos.decorators.js';
import {
  GuardarInformeDto,
  IdInformeDto,
  ListInformesDto,
  ListPlanesDto,
  RevisarInformeDto,
  SeguimientoPlanDto,
} from './dto/informes.dto.js';
import { InformesInspeccionService } from './informes.service.js';

@ApiTags('Auditorías — Informes de inspección (100% POST)')
@ApiBearerAuth()
@Controller('informes-inspeccion')
export class InformesInspeccionController {
  constructor(private readonly informes: InformesInspeccionService) {}

  @Permiso('informes.ver')
  @Post('list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar informes de inspección del alcance del usuario' })
  list(@Body() dto: ListInformesDto, @CurrentUser() user: any) {
    return this.informes.list(dto, user);
  }

  @Permiso('informes.ver', 'auditorias.ver')
  @Post('resumen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Indicadores de los informes (tarjetas y dashboard de auditorías)' })
  resumen(@CurrentUser() user: any) {
    return this.informes.resumen(user);
  }

  @Permiso('informes.ver')
  @Post('planes/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Planes de acción de los informes (pendientes, vencidos…)' })
  planes(@Body() dto: ListPlanesDto, @CurrentUser() user: any) {
    return this.informes.listPlanes(dto, user);
  }

  @Permiso('informes.ver')
  @Post('opciones')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Agencias del alcance y responsables, para filtros y formularios' })
  opciones(@CurrentUser() user: any) {
    return this.informes.opciones(user);
  }

  @Permiso('informes.crear')
  @Post('destinatarios')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Personal del alcance al que se puede dirigir un informe (PARA)' })
  destinatarios(@CurrentUser() user: any) {
    return this.informes.destinatarios(user);
  }

  @Permiso('informes.ver')
  @Post('detail')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Detalle completo de un informe, con historial y lo que el usuario puede hacer con él' })
  detail(@Body() dto: IdInformeDto, @CurrentUser() user: any) {
    return this.informes.detail(dto.id, user);
  }

  @Permiso('informes.crear')
  @Post('create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear un informe de inspección (queda en borrador)' })
  create(@Body() dto: GuardarInformeDto, @CurrentUser() user: any) {
    return this.informes.create(dto, user);
  }

  @Permiso('informes.crear')
  @Post('update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Guardar los cambios de un borrador' })
  update(@Body() dto: GuardarInformeDto, @CurrentUser() user: any) {
    return this.informes.update(dto, user);
  }

  @Permiso('informes.crear')
  @Post('enviar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enviar un borrador a revisión' })
  enviar(@Body() dto: IdInformeDto, @CurrentUser() user: any) {
    return this.informes.enviar(dto.id, user);
  }

  @Permiso('informes.crear')
  @Post('reabrir')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reabrir un informe rechazado para corregirlo' })
  reabrir(@Body() dto: IdInformeDto, @CurrentUser() user: any) {
    return this.informes.reabrir(dto.id, user);
  }

  @Permiso('informes.revisar')
  @Post('revisar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Aprobar el informe (queda aprobado) o rechazarlo con motivo' })
  revisar(@Body() dto: RevisarInformeDto, @CurrentUser() user: any) {
    return this.informes.revisar(dto, user);
  }

  @Permiso('informes.revisar')
  @Post('cerrar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cerrar un informe aprobado' })
  cerrar(@Body() dto: IdInformeDto, @CurrentUser() user: any) {
    return this.informes.cerrar(dto.id, user);
  }

  @Permiso('informes.eliminar')
  @Post('delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Eliminar un borrador (queda registro, no se borra de verdad)' })
  eliminar(@Body() dto: IdInformeDto, @CurrentUser() user: any) {
    return this.informes.eliminar(dto.id, user);
  }

  @Permiso('informes.seguimiento')
  @Post('planes/seguimiento')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar el estado y la evidencia de cumplimiento de un plan de acción' })
  seguimiento(@Body() dto: SeguimientoPlanDto, @CurrentUser() user: any) {
    return this.informes.seguimientoPlan(dto, user);
  }
}
