import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class QueryRolesDto {
  @ApiProperty({ example: 'ADMIN', description: 'Filtro por nombre de rol', required: false })
  @IsOptional()
  @IsString()
  namerol?: string;

  @ApiProperty({ example: 1, description: 'Filtro por estado: 1 = Activo, 0 = Inactivo', required: false })
  @IsOptional()
  @IsIn([0, 1], { message: 'El estado debe ser 1 o 0' })
  estado?: number;

  @ApiProperty({ example: 'SUPER', description: 'Búsqueda por texto libre', required: false })
  @IsOptional()
  @IsString()
  search?: string;
}

export class DetailRoleDto {
  @ApiProperty({ example: '1b6b0bba-9ee1-4f99-a194-89e728542969', description: 'ID o namerol del rol' })
  @IsString({ message: 'El id o namerol es requerido' })
  id: string;
}
