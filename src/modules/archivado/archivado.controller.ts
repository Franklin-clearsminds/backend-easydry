import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permiso } from '../../common/permisos/permisos.decorators.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { EstadoArchivadoService } from './archivado.estado.js';

@ApiTags('Archivo histórico')
@Controller('archivado')
@ApiBearerAuth()
export class ArchivadoController {
  constructor(private readonly estadoService: EstadoArchivadoService) {}

  @Permiso('roles.ver')
  @Post('estado')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Estado del archivado de datos viejos: si está encendido, últimas corridas, lo archivado por tabla y lo que requiere atención (solo ADMIN y SUPER_ADMIN)' })
  estado(@CurrentUser() user: any) {
    return this.estadoService.estado(user);
  }
}
