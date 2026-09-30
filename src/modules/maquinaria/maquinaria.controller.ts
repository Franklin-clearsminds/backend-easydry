import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MaquinariaService } from './maquinaria.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { actorFromUser } from './maquinaria.permisos.js';
import { ChecklistMantenimientoDto, GuardarPlantillaChecklistDto, MarcarPasoChecklistDto } from './dto/checklist.dto.js';
import {
  CreateMaquinariaDto,
  UpdateMaquinariaDto,
  ListMaquinariaDto,
  ReportarIncidenteDto,
  ResolverIncidenteDto,
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
  EditarMantenimientoDto,
  HistorialMaquinariaDto,
  SetActivaMaquinariaDto,
} from './dto/trazabilidad.dto.js';

import { Permiso } from '../../common/permisos/permisos.decorators.js';
@ApiTags('Taller & Maquinaria (100% POST)')
@Controller('maquinaria')
@ApiBearerAuth()
export class MaquinariaController {
  constructor(private readonly maquinariaService: MaquinariaService) {}

  // ==============================================================
  // MAQUINARIA
  // ==============================================================

  @Permiso('maquinaria.ver')
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

  @Permiso('maquinaria.editar')
  @Post('update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Editar datos de la máquina, con historial de qué cambió (admin, super admin)' })
  async update(@Body() dto: UpdateMaquinariaDto, @CurrentUser() user: any) {
    return this.maquinariaService.update(dto, actorFromUser(user));
  }

  @Permiso('maquinaria.editar')
  @Post('activar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activar o desactivar (dar de baja) una máquina, registrando quién y por qué' })
  async setActiva(@Body() dto: SetActivaMaquinariaDto, @CurrentUser() user: any) {
    return this.maquinariaService.setActiva(dto, actorFromUser(user));
  }

  @Permiso('maquinaria.gestionar')
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

  @Permiso('maquinaria.trazabilidad')
  @Post('historial')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Línea de tiempo de la máquina (paginada y filtrable por tipo, fechas y persona)' })
  async historial(@Body() dto: HistorialMaquinariaDto, @CurrentUser() user: any) {
    return this.maquinariaService.historial(dto, actorFromUser(user));
  }

  // ==============================================================
  // INCIDENTES TÉCNICOS
  // ==============================================================

  @Permiso('incidentes.reportar')
  @Post('incidentes/reportar')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Reportar incidencia de una máquina asignada (pulidor / líder operador). Requiere conexión.' })
  async reportarIncidente(@Body() dto: ReportarIncidenteDto, @CurrentUser() user: any) {
    return this.maquinariaService.reportarIncidente(dto, actorFromUser(user));
  }

  @Permiso('maquinaria.gestionar')
  @Post('incidentes/asignar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Asignar la incidencia a un técnico de la región o al propio coordinador' })
  async asignarIncidente(@Body() dto: AsignarIncidenteDto, @CurrentUser() user: any) {
    return this.maquinariaService.asignarIncidente(dto, actorFromUser(user));
  }

  @Permiso('incidentes.resolver')
  @Post('incidentes/resolver')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cerrar la incidencia con evidencia (técnico asignado o coordinador que la repara)' })
  async resolverIncidente(@Body() dto: ResolverIncidenteDto, @CurrentUser() user: any) {
    return this.maquinariaService.resolverIncidente(dto, actorFromUser(user));
  }

  @Permiso('incidentes.resolver')
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

  @Permiso('maquinaria.gestionar')
  @Post('mantenimientos/registrar')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Programar un mantenimiento (coordinador de mantenimiento, admin)' })
  async registrarMantenimiento(@Body() dto: RegistrarMantenimientoDto, @CurrentUser() user: any) {
    return this.maquinariaService.registrarMantenimiento(dto, actorFromUser(user));
  }

  @Permiso('maquinaria.gestionar')
  @Post('mantenimientos/asignar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Asignar el mantenimiento a un técnico de la región o al propio coordinador' })
  async asignarMantenimiento(@Body() dto: AsignarMantenimientoDto, @CurrentUser() user: any) {
    return this.maquinariaService.asignarMantenimiento(dto, actorFromUser(user));
  }

  @Permiso('mantenimientos.ejecutar')
  @Post('mantenimientos/ejecutar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ejecutar el mantenimiento con evidencia. Solo dentro de la ventana de adelanto de la máquina.' })
  async ejecutarMantenimiento(@Body() dto: EjecutarMantenimientoDto, @CurrentUser() user: any) {
    return this.maquinariaService.ejecutarMantenimiento(dto, actorFromUser(user));
  }

  @Permiso('mantenimientos.ejecutar')
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

  // ==============================================================
  // CHECKLIST DE MANTENIMIENTO
  // ==============================================================

  @Permiso('mantenimientos.ver')
  @Post('checklist/plantillas/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Plantillas de checklist activas (una por tipo de mantenimiento) con sus pasos' })
  async listarPlantillasChecklist() {
    return this.maquinariaService.listarPlantillasChecklist();
  }

  @Permiso('checklist.gestionar')
  @Post('checklist/plantillas/guardar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Guardar los pasos de un tipo como una versión nueva de la plantilla (la anterior queda inactiva)' })
  async guardarPlantillaChecklist(@Body() dto: GuardarPlantillaChecklistDto, @CurrentUser() user: any) {
    return this.maquinariaService.guardarPlantillaChecklist(dto, user);
  }

  @Permiso('mantenimientos.ver')
  @Post('mantenimientos/checklist')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Checklist de una orden de mantenimiento (los pasos se copian de la plantilla activa al consultarlo)' })
  async checklistMantenimiento(@Body() dto: ChecklistMantenimientoDto, @CurrentUser() user: any) {
    return this.maquinariaService.obtenerChecklist(dto.mantenimientoId, actorFromUser(user));
  }

  @Permiso('mantenimientos.ejecutar')
  @Post('mantenimientos/checklist/marcar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Marcar o desmarcar un paso del checklist (deja quién y cuándo)' })
  async marcarPasoChecklist(@Body() dto: MarcarPasoChecklistDto, @CurrentUser() user: any) {
    return this.maquinariaService.marcarChecklist(dto, actorFromUser(user), user);
  }

  @Permiso('maquinaria.evidencias')
  @Post('evidencias/agregar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Agregar o reemplazar evidencia de una incidencia o mantenimiento (nunca se borra)' })
  async agregarEvidencia(@Body() dto: AgregarEvidenciaDto, @CurrentUser() user: any) {
    return this.maquinariaService.agregarEvidencia(dto, actorFromUser(user));
  }

  // ==============================================================
  // MOVIMIENTOS
  // ==============================================================

  @Permiso('maquinaria.gestionar')
  @Post('transferir')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mover la máquina a otra agencia, bahía o taller (registra quién y de dónde a dónde)' })
  async transferir(@Body() dto: TransferirMaquinariaDto, @CurrentUser() user: any) {
    return this.maquinariaService.transferirMaquinaria(dto, actorFromUser(user));
  }

  @Permiso('maquinaria.trazabilidad')
  @Post('movimientos/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Historial de movimientos entre agencias, bahías y talleres' })
  async listMovimientos(@Body() dto: ListMovimientosMaquinariaDto, @CurrentUser() user: any) {
    return this.maquinariaService.listMovimientos(dto, actorFromUser(user));
  }

  @Permiso('maquinaria.ver')
  @Post('talleres/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar talleres nacional y regionales' })
  async listTalleres() {
    return this.maquinariaService.listTalleres();
  }
}
