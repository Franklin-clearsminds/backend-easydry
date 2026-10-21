import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCatalogoServicioDto, UpdateCatalogoServicioDto } from './servicios.dto.js';

describe('categoria de catálogo de servicio — @IsIn', () => {
  const base = { codigo: 'SER-001', nombre: 'Lavado Express', tiempoEstimadoMin: 30 };

  it('CreateCatalogoServicioDto acepta GENERAL o ESPECIAL y rechaza cualquier otro valor', async () => {
    const generalValido = plainToInstance(CreateCatalogoServicioDto, { ...base, categoria: 'GENERAL' });
    expect(await validate(generalValido)).toHaveLength(0);

    const especialValido = plainToInstance(CreateCatalogoServicioDto, { ...base, categoria: 'ESPECIAL' });
    expect(await validate(especialValido)).toHaveLength(0);

    const invalido = plainToInstance(CreateCatalogoServicioDto, { ...base, categoria: 'QUIMICOS_LAVADO' });
    const errores = await validate(invalido);
    expect(errores.some((e) => e.property === 'categoria')).toBe(true);
  });

  it('UpdateCatalogoServicioDto rechaza una categoría fuera del catálogo', async () => {
    const invalido = plainToInstance(UpdateCatalogoServicioDto, { id: 1, categoria: 'QUIMICOS_LAVADO' });
    const errores = await validate(invalido);
    expect(errores.some((e) => e.property === 'categoria')).toBe(true);
  });
});
