import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Permiso } from '../../common/permisos/permisos.decorators.js';
import { TimbradasService } from './timbradas.service.js';
import { TareasService } from './tareas.service.js';
import { UbicacionesService } from './ubicaciones.service.js';
import {
  CancelarTareaDto,
  CompletarTareaDto,
  ConsultarTimbradasDto,
  CrearTareaDto,
  EstadoTimbradaDto,
  GuardarUbicacionDto,
  ListarTareasDto,
  QuitarUbicacionDto,
  ReasignarTareaDto,
  RegistrarTimbradaDto,
  RevisarTareaDto,
  TareaIdDto,
} from './dto/rrhh.dto.js';

/** La ubicación se configura desde Agencias (casilla de la agencia) o desde Inventario > Bodegas (casilla de la bodega); ambas otorgan el permiso base. */
const PERMISOS_UBICACION = ['rrhh.ubicaciones.gestionar', 'agencias.agencias.ubicacion', 'inventario.bodegas.ubicacion'];

@ApiTags('RRHH')
@ApiBearerAuth()
@Controller('rrhh')
export class RrhhController {
  constructor(
    private readonly timbradas: TimbradasService,
    private readonly tareas: TareasService,
    private readonly ubicaciones: UbicacionesService,
  ) {}

  // ───────────────────────── Ubicaciones ─────────────────────────

  @Permiso(...PERMISOS_UBICACION)
  @Post('ubicaciones/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Agencias y bodegas con su ubicación y radio de timbrada' })
  listarUbicaciones(@CurrentUser() user: any) {
    return this.ubicaciones.listar(user);
  }

  @Permiso(...PERMISOS_UBICACION)
  @Post('ubicaciones/guardar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Guardar la ubicación y el radio de una agencia o bodega' })
  guardarUbicacion(@Body() dto: GuardarUbicacionDto, @CurrentUser() user: any) {
    return this.ubicaciones.guardar(dto, user);
  }

  @Permiso(...PERMISOS_UBICACION)
  @Post('ubicaciones/quitar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Quitar la ubicación de una agencia o bodega' })
  quitarUbicacion(@Body() dto: QuitarUbicacionDto, @CurrentUser() user: any) {
    return this.ubicaciones.quitar(dto, user);
  }

  // ───────────────────────── Timbradas ─────────────────────────

  @Permiso('rrhh.timbrar')
  @Post('timbradas/estado')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hora del servidor, marcas de hoy y si la timbrada exige ubicación' })
  estadoTimbrada(@CurrentUser() user: any, @Body() dto?: EstadoTimbradaDto) {
    return this.timbradas.estado(user, dto?.origen);
  }

  @Permiso('rrhh.timbrar')
  @Post('timbradas/registrar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Registrar una entrada o salida con foto de cámara y ubicación' })
  registrarTimbrada(@Body() dto: RegistrarTimbradaDto, @CurrentUser() user: any) {
    return this.timbradas.registrar(dto, user);
  }

  @Permiso('rrhh.timbrar')
  @Post('timbradas/mias')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mis timbradas' })
  misTimbradas(@Body() dto: ConsultarTimbradasDto, @CurrentUser() user: any) {
    return this.timbradas.mias(dto, user);
  }

  @Permiso('rrhh.timbradas.ver')
  @Post('timbradas/equipo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Timbradas de las personas de mi alcance' })
  timbradasEquipo(@Body() dto: ConsultarTimbradasDto, @CurrentUser() user: any) {
    return this.timbradas.equipo(dto, user);
  }

  // ───────────────────────── Tareas ─────────────────────────

  @Permiso('rrhh.tareas.propias')
  @Post('tareas/mias')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Tareas que me asignaron' })
  misTareas(@Body() dto: ListarTareasDto, @CurrentUser() user: any) {
    return this.tareas.mias(dto, user);
  }

  @Permiso('rrhh.tareas.propias')
  @Post('tareas/completar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Completar una tarea mía con respuesta y evidencia' })
  completarTarea(@Body() dto: CompletarTareaDto, @CurrentUser() user: any) {
    return this.tareas.completar(dto, user);
  }

  @Permiso('rrhh.tareas.asignar')
  @Post('tareas/asignadas')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Tareas que asigné y las de las personas de mi alcance' })
  tareasAsignadas(@Body() dto: ListarTareasDto, @CurrentUser() user: any) {
    return this.tareas.asignadas(dto, user);
  }

  @Permiso('rrhh.tareas.asignar')
  @Post('tareas/asignables')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Personas a las que puedo asignar una tarea' })
  asignables(@CurrentUser() user: any) {
    return this.tareas.asignables(user);
  }

  @Permiso('rrhh.tareas.asignar')
  @Post('tareas/sin-responsable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Tareas Pendientes cuyo responsable ya no está activo' })
  sinResponsable(@CurrentUser() user: any) {
    return this.tareas.sinResponsableActivo(user);
  }

  @Permiso('rrhh.tareas.asignar')
  @Post('tareas/crear')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Asignar una tarea' })
  crearTarea(@Body() dto: CrearTareaDto, @CurrentUser() user: any) {
    return this.tareas.crear(dto, user);
  }

  @Permiso('rrhh.tareas.asignar')
  @Post('tareas/revisar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Aprobar o devolver una tarea completada' })
  revisarTarea(@Body() dto: RevisarTareaDto, @CurrentUser() user: any) {
    return this.tareas.revisar(dto, user);
  }

  @Permiso('rrhh.tareas.asignar')
  @Post('tareas/cancelar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancelar una tarea Pendiente' })
  cancelarTarea(@Body() dto: CancelarTareaDto, @CurrentUser() user: any) {
    return this.tareas.cancelar(dto, user);
  }

  @Permiso('rrhh.tareas.asignar')
  @Post('tareas/reasignar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reasignar una tarea Pendiente a otra persona' })
  reasignarTarea(@Body() dto: ReasignarTareaDto, @CurrentUser() user: any) {
    return this.tareas.reasignar(dto, user);
  }

  /** El responsable, quien asignó, un administrador o quien asigna en su alcance: el servicio decide por tarea. */
  @Permiso('rrhh.tareas.propias', 'rrhh.tareas.asignar')
  @Post('tareas/detalle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Detalle de una tarea' })
  detalleTarea(@Body() dto: TareaIdDto, @CurrentUser() user: any) {
    return this.tareas.detalle(dto.id, user);
  }
}
