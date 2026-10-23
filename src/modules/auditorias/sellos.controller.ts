import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Permiso } from '../../common/permisos/permisos.decorators.js';
import { CrearSelloDto, EditarSelloDto } from './dto/sellos.dto.js';
import { SellosService } from './sellos.service.js';

@ApiTags('Auditorías — Sellos de jefes de taller (100% POST)')
@ApiBearerAuth()
@Controller('sellos-jefe-taller')
export class SellosController {
  constructor(private readonly sellos: SellosService) {}

  @Permiso('sellos.gestionar')
  @Post('list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sellos de jefes de taller con su logo (solo Admin y Super Admin)' })
  list() {
    return this.sellos.list();
  }

  @Permiso('sellos.gestionar')
  @Post('create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear el sello de un jefe de taller (nombre, apellido, logo y contraseña)' })
  crear(@Body() dto: CrearSelloDto, @CurrentUser() user: any) {
    return this.sellos.crear(dto, user);
  }

  @Permiso('sellos.gestionar')
  @Post('update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Editar un sello: datos, logo, contraseña o activarlo y desactivarlo' })
  editar(@Body() dto: EditarSelloDto) {
    return this.sellos.editar(dto);
  }
}
