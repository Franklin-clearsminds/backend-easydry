import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Permiso } from '../../common/permisos/permisos.decorators.js';
import {
  AdjuntarUsuariosDto,
  BuscarAdjuntablesDto,
  QuitarAdjuntoDto,
  GuardarInformeDto,
  IdInformeDto,
  ListInformesDto,
  ListPlanesDto,
  SeguimientoPlanDto,
} from './dto/informes.dto.js';
import { AprobarInformeDto, FirmarInformeDto, ValidarSelloDto } from './dto/sellos.dto.js';
import { InformesInspeccionService } from './informes.service.js';

@ApiTags('Auditorías — Informes de inspección (100% POST)')
@ApiBearerAuth()
@Controller('informes-inspeccion')
export class InformesInspeccionController {
  constructor(
    private readonly informes: InformesInspeccionService,
  ) {}

  @Permiso('informes.ver')
  @Post('list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar informes de inspección del alcance del usuario' })
  list(@Body() dto: ListInformesDto, @CurrentUser() user: any) {
    return this.informes.list(dto, user);
  }

  @Permiso('informes.ver')
  @Post('resumen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Indicadores de los informes (tarjetas de la pantalla de informes)' })
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
  @Post('adjuntos/opciones')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Regiones, clientes, agencias y roles para filtrar a quién adjuntar un informe' })
  opcionesAdjuntos() {
    return this.informes.opcionesAdjuntos();
  }

  @Permiso('informes.crear')
  @Post('adjuntos/buscar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Buscar usuarios activos (cualquier rol) a quienes adjuntar un informe' })
  buscarAdjuntables(@Body() dto: BuscarAdjuntablesDto) {
    return this.informes.buscarAdjuntables(dto);
  }

  @Permiso('informes.crear')
  @Post('adjuntos/agregar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Adjuntar usuarios a un informe: reciben una notificación cuando se aprueba' })
  adjuntar(@Body() dto: AdjuntarUsuariosDto, @CurrentUser() user: any) {
    return this.informes.adjuntar(dto, user);
  }

  @Permiso('informes.crear')
  @Post('adjuntos/quitar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Quitar un adjunto de un informe que aún no está aprobado' })
  quitarAdjunto(@Body() dto: QuitarAdjuntoDto, @CurrentUser() user: any) {
    return this.informes.quitarAdjunto(dto, user);
  }

  @Permiso('informes.firmar')
  @Post('sello/validar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validar con su contraseña el sello de la agencia del informe (habilita la sección de firmas)' })
  validarSello(@Body() dto: ValidarSelloDto, @CurrentUser() user: any) {
    return this.informes.validarSello(dto, user);
  }

  @Permiso('informes.crear')
  @Post('firmar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Registrar una de las cuatro firmas capturadas en pantalla' })
  firmar(@Body() dto: FirmarInformeDto, @CurrentUser() user: any) {
    return this.informes.firmar(dto, user);
  }

  @Permiso('informes.aprobar')
  @Post('aprobar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Aprobar un informe guardado firmando la recepción (solo Admin y Super Admin)' })
  aprobar(@Body() dto: AprobarInformeDto, @CurrentUser() user: any) {
    return this.informes.aprobar(dto, user);
  }

  @Permiso('informes.crear')
  @Post('guardar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Guardar el informe de forma definitiva (ya no se puede modificar)' })
  guardar(@Body() dto: IdInformeDto, @CurrentUser() user: any) {
    return this.informes.guardar(dto.id, user);
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
