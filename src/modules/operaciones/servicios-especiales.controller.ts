import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ServiciosEspecialesService } from './servicios-especiales.service.js';
import {
  QueryServicioEspecialDto,
  CreateServicioEspecialDto,
  IniciarServicioEspecialDto,
  CompletarServicioEspecialDto,
} from './dto/servicios-especiales.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';

@ApiTags('Servicios Especiales y Detailing (100% POST)')
@Controller('operaciones/servicios-especiales')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ServiciosEspecialesController {
  constructor(private readonly service: ServiciosEspecialesService) {}

  @Post('list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar servicios especiales (Pulido, Cerámico, Lavado de Motor)' })
  @ApiResponse({ status: 200, description: 'Lista paginada de servicios especiales' })
  async list(@Body() queryDto: QueryServicioEspecialDto) {
    return this.service.findAll(queryDto);
  }

  @Post('detail')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Detalle de un servicio especial por ID o clientUuid' })
  @ApiResponse({ status: 200, description: 'Detalle completo' })
  async detail(@Body() body: { id: string }) {
    return this.service.findOne(body.id);
  }

  @Post('crear')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear nuevo servicio especial de detailing' })
  @ApiResponse({ status: 201, description: 'Servicio especial registrado exitosamente' })
  async crear(
    @Body() dto: CreateServicioEspecialDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.create(dto, userId);
  }

  @Post('iniciar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Marcar inicio de trabajo en servicio especial (EN_PROCESO)' })
  @ApiResponse({ status: 200, description: 'Servicio especial iniciado' })
  async iniciar(
    @Body() dto: IniciarServicioEspecialDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.iniciar({
      id: dto.id,
      operadorId: dto.operadorId || userId,
    });
  }

  @Post('completar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Finalizar servicio especial con calificación de calidad y evidencias' })
  @ApiResponse({ status: 200, description: 'Servicio especial completado' })
  async completar(@Body() dto: CompletarServicioEspecialDto) {
    return this.service.completar(dto);
  }

  @Post('delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Anular o cancelar servicio especial (soft delete)' })
  @ApiResponse({ status: 200, description: 'Servicio especial cancelado' })
  async delete(@Body() body: { id: string; motivo?: string }) {
    return this.service.softDelete(body.id, body.motivo);
  }
}
