import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CreateRetoDto, DeleteRetoDto, ListRetosDto } from './dto/retos.dto.js';
import { RetosService } from './retos.service.js';

@ApiTags('Retos de productividad')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('retos')
export class RetosController {
  constructor(private readonly retosService: RetosService) {}

  @Post('list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar retos almacenados en PostgreSQL' })
  list(@Body() dto: ListRetosDto, @CurrentUser() user: any) {
    return this.retosService.list(dto, user);
  }

  @Post('create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear un reto de productividad' })
  create(@Body() dto: CreateRetoDto, @CurrentUser() user: any) {
    return this.retosService.create(dto, user);
  }

  @Post('delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Eliminar un reto' })
  delete(@Body() dto: DeleteRetoDto, @CurrentUser() user: any) {
    return this.retosService.delete(dto.id, user);
  }
}
