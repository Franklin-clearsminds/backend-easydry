import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Permiso } from '../../common/permisos/permisos.decorators.js';
import {
  CompararDto,
  GuardarAuditoria5sDto,
  IdAuditoria5sDto,
  ListAccionesDto,
  ListAuditorias5sDto,
  ResumenAuditorias5sDto,
  SeguimientoAccionDto,
  VerificarAccionDto,
} from './dto/auditoria5s.dto.js';
import { Auditoria5sService } from './auditoria5s.service.js';

@ApiTags('Auditorías — Auditoría 5S (100% POST)')
@ApiBearerAuth()
@Controller('auditorias-5s')
export class Auditoria5sController {
  constructor(private readonly auditorias: Auditoria5sService) {}

  @Permiso('inspecciones.ver')
  @Post('catalogo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Catálogo único: áreas, los tres formatos (con sus preguntas y escala) y reglas del semáforo' })
  catalogo() {
    return this.auditorias.catalogo();
  }

  @Permiso('inspecciones.ver')
  @Post('list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar auditorías 5S del alcance del usuario' })
  list(@Body() dto: ListAuditorias5sDto, @CurrentUser() user: any) {
    return this.auditorias.list(dto, user);
  }

  @Permiso('inspecciones.ver')
  @Post('resumen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Indicadores y gráficos del dashboard 5S' })
  resumen(@Body() dto: ResumenAuditorias5sDto, @CurrentUser() user: any) {
    return this.auditorias.resumen(dto, user);
  }

  @Permiso('inspecciones.ver')
  @Post('opciones')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Agencias del alcance y auditores, para filtros y formularios' })
  opciones(@CurrentUser() user: any) {
    return this.auditorias.opciones(user);
  }

  @Permiso('inspecciones.ver')
  @Post('detail')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Detalle de una auditoría: los 20 criterios, resultado, acciones, historial y lo que el usuario puede hacer' })
  detail(@Body() dto: IdAuditoria5sDto, @CurrentUser() user: any) {
    return this.auditorias.detail(dto.id, user);
  }

  @Permiso('inspecciones.crear')
  @Post('create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear la auditoría de la visita: una por cada formato elegido, con los mismos datos y guardadas por separado' })
  create(@Body() dto: GuardarAuditoria5sDto, @CurrentUser() user: any) {
    return this.auditorias.create(dto, user);
  }

  @Permiso('inspecciones.crear')
  @Post('update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Guardar el avance de una auditoría sin finalizar' })
  update(@Body() dto: GuardarAuditoria5sDto, @CurrentUser() user: any) {
    return this.auditorias.update(dto, user);
  }

  @Permiso('inspecciones.crear')
  @Post('guardar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Guardar de forma definitiva: exige los 20 criterios, fija el resultado y el semáforo y abre las acciones correctivas' })
  guardar(@Body() dto: IdAuditoria5sDto, @CurrentUser() user: any) {
    return this.auditorias.guardar(dto.id, user);
  }

  @Permiso('inspecciones.eliminar')
  @Post('delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Eliminar una auditoría sin guardar (queda registro)' })
  eliminar(@Body() dto: IdAuditoria5sDto, @CurrentUser() user: any) {
    return this.auditorias.eliminar(dto.id, user);
  }

  @Permiso('inspecciones.ver')
  @Post('acciones/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Acciones correctivas del alcance (pendientes, vencidas…)' })
  acciones(@Body() dto: ListAccionesDto, @CurrentUser() user: any) {
    return this.auditorias.listAcciones(dto, user);
  }

  @Permiso('inspecciones.acciones')
  @Post('acciones/seguimiento')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar el seguimiento de una acción correctiva (no cambia el puntaje)' })
  seguimiento(@Body() dto: SeguimientoAccionDto, @CurrentUser() user: any) {
    return this.auditorias.seguimientoAccion(dto, user);
  }

  @Permiso('inspecciones.verificar')
  @Post('acciones/verificar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verificar la corrección: cerrar la acción o devolverla a proceso' })
  verificar(@Body() dto: VerificarAccionDto, @CurrentUser() user: any) {
    return this.auditorias.verificarAccion(dto, user);
  }

  @Permiso('inspecciones.ver')
  @Post('comparar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Historial comparativo de una agencia y área (solo auditorías finalizadas)' })
  comparar(@Body() dto: CompararDto, @CurrentUser() user: any) {
    return this.auditorias.comparar(dto, user);
  }
}
