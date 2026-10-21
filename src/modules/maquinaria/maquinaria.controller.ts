import { ForbiddenException, Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MaquinariaService } from './maquinaria.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { actorFromUser } from './maquinaria.permisos.js';
import {
  CreateMaquinariaDto,
  UpdateMaquinariaDto,
  ListMaquinariaDto,
  ReportarIncidenteDto,
  ResolverIncidenteDto,
  CancelarIncidenteDto,
  ListIncidentesDto,
  RegistrarMantenimientoDto,
  EjecutarMantenimientoDto,
  ListMantenimientosDto,
  AsignarIncidenteDto,
  AsignarMantenimientoDto,
  TransferirMaquinariaDto,
  ListMovimientosMaquinariaDto,
} from './dto/maquinaria.dto.js';
import {
  AgregarEvidenciaDto,
  AsignarOperadorDto,
  ConfigurarVentanaDto,
  DetalleMaquinariaDto,
  EditarIncidenteDto,
  EditarLimpiezaDto,
  EditarMantenimientoDto,
  EliminarLimpiezaDto,
  ExportarLimpiezasDto,
  HistorialMaquinariaDto,
  ListLimpiezasDto,
  RegistrarLimpiezaDto,
  SetActivaMaquinariaDto,
} from './dto/trazabilidad.dto.js';

import { Permiso } from '../../common/permisos/permisos.decorators.js';
import { tienePermiso } from '../../common/permisos/capacidades.js';
@ApiTags('Taller & Maquinaria (100% POST)')
@Controller('maquinaria')
@ApiBearerAuth()
export class MaquinariaController {
  constructor(private readonly maquinariaService: MaquinariaService) {}

  // ==============================================================
  // MAQUINARIA
  // ==============================================================

  // El listado alimenta también Taller (incidentes, mantenimientos, limpiezas) y el Mapa: esas pantallas lo piden sin
  // necesitar el módulo de Maquinaria completo, así que sus permisos también lo abren.
  @Permiso('maquinaria.ver', 'incidentes.ver', 'mantenimientos.ver', 'limpiezas.ver', 'mapa.maquinaria.ver')
  @Post('list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar maquinaria. Cada rol ve solo lo suyo: región, asignadas o admin (todas).' })
  async list(@Body() dto: ListMaquinariaDto, @CurrentUser() user: any) {
    return this.maquinariaService.list(dto, actorFromUser(user));
  }

  @Permiso('maquinaria.ver')
  @Post('detalle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ficha de una máquina con pendientes y totales (base del modal por máquina)' })
  async detalle(@Body() dto: DetalleMaquinariaDto, @CurrentUser() user: any) {
    return this.maquinariaService.detalle(dto, actorFromUser(user));
  }

  @Permiso('maquinaria.crear')
  @Post('create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registrar nueva maquinaria (admin, super admin, coordinador de bodega)' })
  async create(@Body() dto: CreateMaquinariaDto, @CurrentUser() user: any) {
    return this.maquinariaService.create(dto, actorFromUser(user));
  }

  @Permiso('maquinaria.editar', 'maquinaria.archivos')
  @Post('update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Editar datos de la máquina, con historial de qué cambió (admin, super admin)' })
  async update(@Body() dto: UpdateMaquinariaDto, @CurrentUser() user: any) {
    return this.maquinariaService.update(dto, actorFromUser(user), {
      editar: tienePermiso(user, 'maquinaria.editar'),
      archivos: tienePermiso(user, 'maquinaria.archivos'),
    });
  }

  @Permiso('maquinaria.editar')
  @Post('activar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activar o desactivar (dar de baja) una máquina, registrando quién y por qué' })
  async setActiva(@Body() dto: SetActivaMaquinariaDto, @CurrentUser() user: any) {
    return this.maquinariaService.setActiva(dto, actorFromUser(user));
  }

  @Permiso('maquinaria.responsable')
  @Post('asignar-operador')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Asignar la máquina a un pulidor o líder operador (coordinador de mantenimiento, admin)' })
  async asignarOperador(@Body() dto: AsignarOperadorDto, @CurrentUser() user: any) {
    return this.maquinariaService.asignarOperador(dto, actorFromUser(user));
  }

  @Permiso('maquinaria.gestionar')
  @Post('ventana-adelanto')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Configurar cuántos días/semanas antes se puede ejecutar un mantenimiento de esta máquina' })
  async configurarVentana(@Body() dto: ConfigurarVentanaDto, @CurrentUser() user: any) {
    return this.maquinariaService.configurarVentana(dto, actorFromUser(user));
  }

  @Permiso('maquinaria.trazabilidad.ver')
  @Post('historial')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Línea de tiempo de la máquina (paginada y filtrable por tipo, fechas y persona)' })
  async historial(@Body() dto: HistorialMaquinariaDto, @CurrentUser() user: any) {
    return this.maquinariaService.historial(dto, actorFromUser(user));
  }

  // ==============================================================
  // INCIDENTES TÉCNICOS
  // ==============================================================

  @Permiso('taller.incidentes.reportar')
  @Post('incidentes/reportar')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Reportar una incidencia dentro del alcance; las evidencias se exigen solo si el rol tiene el permiso de subida.' })
  async reportarIncidente(@Body() dto: ReportarIncidenteDto, @CurrentUser() user: any) {
    return this.maquinariaService.reportarIncidente(dto, actorFromUser(user), tienePermiso(user, 'maquinaria.evidencias'));
  }

  @Permiso('taller.incidentes.asignar')
  @Post('incidentes/asignar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Asignar la incidencia a un técnico de la región o al propio coordinador' })
  async asignarIncidente(@Body() dto: AsignarIncidenteDto, @CurrentUser() user: any) {
    return this.maquinariaService.asignarIncidente(dto, actorFromUser(user));
  }

  @Permiso('taller.incidentes.resolver', 'taller.incidentes.cancelar')
  @Post('incidentes/resolver')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cerrar la incidencia; las evidencias se exigen solo si el rol tiene el permiso de subida.' })
  async resolverIncidente(@Body() dto: ResolverIncidenteDto, @CurrentUser() user: any) {
    const cancela = dto.estado === 'CANCELADO';
    if (!tienePermiso(user, cancela ? 'taller.incidentes.cancelar' : 'taller.incidentes.resolver')) {
      throw new ForbiddenException(cancela ? 'Tu rol no puede cancelar incidentes.' : 'Tu rol no puede resolver incidentes.');
    }
    return this.maquinariaService.resolverIncidente(dto, actorFromUser(user), tienePermiso(user, 'maquinaria.evidencias'));
  }

  @Permiso('taller.incidentes.cancelar')
  @Post('incidentes/cancelar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancelar una incidencia con su motivo; queda quién la canceló y cuándo.' })
  async cancelarIncidente(@Body() dto: CancelarIncidenteDto, @CurrentUser() user: any) {
    return this.maquinariaService.cancelarIncidente(dto, actorFromUser(user));
  }

  @Permiso('taller.incidentes.resolver')
  @Post('incidentes/editar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Editar una incidencia; queda registrado quién editó y qué cambió' })
  async editarIncidente(@Body() dto: EditarIncidenteDto, @CurrentUser() user: any) {
    return this.maquinariaService.editarIncidente(dto, actorFromUser(user));
  }

  @Permiso('incidentes.ver')
  @Post('incidentes/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar incidencias: primero las no atendidas (sin asignar), luego en proceso y cerradas' })
  async listIncidentes(@Body() dto: ListIncidentesDto, @CurrentUser() user: any) {
    return this.maquinariaService.listIncidentes(dto, actorFromUser(user));
  }

  // ==============================================================
  // MANTENIMIENTOS
  // ==============================================================

  @Permiso('taller.mantenimientos.programar')
  @Post('mantenimientos/registrar')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Programar un mantenimiento (coordinador de mantenimiento, admin)' })
  async registrarMantenimiento(@Body() dto: RegistrarMantenimientoDto, @CurrentUser() user: any) {
    return this.maquinariaService.registrarMantenimiento(dto, actorFromUser(user));
  }

  @Permiso('taller.mantenimientos.programar')
  @Post('mantenimientos/asignar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Asignar el mantenimiento a un técnico de la región o al propio coordinador' })
  async asignarMantenimiento(@Body() dto: AsignarMantenimientoDto, @CurrentUser() user: any) {
    return this.maquinariaService.asignarMantenimiento(dto, actorFromUser(user));
  }

  @Permiso('taller.mantenimientos.ejecutar')
  @Post('mantenimientos/ejecutar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ejecutar el mantenimiento; las evidencias se exigen solo si el rol tiene el permiso de subida.' })
  async ejecutarMantenimiento(@Body() dto: EjecutarMantenimientoDto, @CurrentUser() user: any) {
    return this.maquinariaService.ejecutarMantenimiento(dto, actorFromUser(user), tienePermiso(user, 'maquinaria.evidencias'));
  }

  @Permiso('taller.mantenimientos.editar')
  @Post('mantenimientos/editar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Editar un mantenimiento; queda registrado quién editó y qué cambió' })
  async editarMantenimiento(@Body() dto: EditarMantenimientoDto, @CurrentUser() user: any) {
    return this.maquinariaService.editarMantenimiento(dto, actorFromUser(user));
  }

  @Permiso('mantenimientos.ver')
  @Post('mantenimientos/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar mantenimientos: primero los vencidos sin ejecutar, luego próximos y finalizados' })
  async listMantenimientos(@Body() dto: ListMantenimientosDto, @CurrentUser() user: any) {
    return this.maquinariaService.listMantenimientos(dto, actorFromUser(user));
  }

  @Permiso('maquinaria.evidencias')
  @Post('evidencias/agregar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Agregar o reemplazar evidencia de una incidencia o mantenimiento (nunca se borra)' })
  async agregarEvidencia(@Body() dto: AgregarEvidenciaDto, @CurrentUser() user: any) {
    return this.maquinariaService.agregarEvidencia(dto, actorFromUser(user));
  }

  // ==============================================================
  // LIMPIEZA (2x/semana para la maquinaria de agencia, diaria para la asignada a un pulidor)
  // ==============================================================

  @Permiso('taller.limpiezas.registrar')
  @Post('limpiezas/registrar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Registrar la limpieza de una máquina (una o varias fotos); el líder la de su agencia, el pulidor la suya' })
  async registrarLimpieza(@Body() dto: RegistrarLimpiezaDto, @CurrentUser() user: any) {
    return this.maquinariaService.registrarLimpieza(dto, actorFromUser(user));
  }

  @Permiso('limpiezas.ver')
  @Post('limpiezas/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Historial de limpiezas (de una máquina o de todas dentro del alcance del actor), más reciente primero. Admin/super admin: todo el país; supervisor y coordinador de mantenimiento: su región; coordinador de servicios especiales: sus pulidores.' })
  async listLimpiezas(@Body() dto: ListLimpiezasDto, @CurrentUser() user: any) {
    return this.maquinariaService.listLimpiezas(dto, actorFromUser(user));
  }

  @Permiso('limpiezas.ver')
  @Post('limpiezas/resumen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cuántas máquinas dentro del alcance del actor están atrasadas de limpieza (para el badge de alerta)' })
  async resumenLimpiezas(@CurrentUser() user: any) {
    return this.maquinariaService.resumenLimpiezas(actorFromUser(user));
  }

  @Permiso('reportes.maquinaria.limpiezas')
  @Post('limpiezas/exportar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Historial completo de limpiezas (hasta 5000 filas) dentro del alcance del actor, para exportar a CSV' })
  async exportarLimpiezas(@Body() dto: ExportarLimpiezasDto, @CurrentUser() user: any) {
    return this.maquinariaService.exportarLimpiezas(dto, actorFromUser(user));
  }

  @Permiso('taller.limpiezas.editar')
  @Post('limpiezas/editar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Corregir las observaciones de un registro de limpieza (admin, supervisor y coordinador de mantenimiento de su región)' })
  async editarLimpieza(@Body() dto: EditarLimpiezaDto, @CurrentUser() user: any) {
    return this.maquinariaService.editarLimpieza(dto, actorFromUser(user));
  }

  @Permiso('taller.limpiezas.editar')
  @Post('limpiezas/eliminar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Eliminar un registro de limpieza (queda el evento en la línea de tiempo de la máquina)' })
  async eliminarLimpieza(@Body() dto: EliminarLimpiezaDto, @CurrentUser() user: any) {
    return this.maquinariaService.eliminarLimpieza(dto, actorFromUser(user));
  }

  // ==============================================================
  // MOVIMIENTOS
  // ==============================================================

  @Permiso('maquinaria.trasladar')
  @Post('transferir')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mover la máquina a otra agencia, bahía o taller (registra quién y de dónde a dónde)' })
  async transferir(@Body() dto: TransferirMaquinariaDto, @CurrentUser() user: any) {
    return this.maquinariaService.transferirMaquinaria(dto, actorFromUser(user));
  }

  @Permiso('maquinaria.trazabilidad.ver')
  @Post('movimientos/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Historial de movimientos entre agencias, bahías y talleres' })
  async listMovimientos(@Body() dto: ListMovimientosMaquinariaDto, @CurrentUser() user: any) {
    return this.maquinariaService.listMovimientos(dto, actorFromUser(user));
  }

  @Permiso('maquinaria.ver')
  @Post('talleres/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar talleres nacional y regionales (admin: todos; coordinador/técnico: los de su región)' })
  async listTalleres(@CurrentUser() user: any) {
    return this.maquinariaService.listTalleres(actorFromUser(user));
  }
}
