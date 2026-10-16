import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { InventarioController } from './inventario.controller.js';

/** Aceptar y rechazar un envío son dos casillas sobre el mismo endpoint: el servidor mira cuál se pidió. */
describe('Envíos: confirmar y rechazar son permisos distintos', () => {
  const con = (...capacidades: string[]) => ({ id: 'u', role: { namerol: 'ROL_DE_PRUEBA', capacidades, ambito: 'GLOBAL' } });
  const armar = () => {
    const confirmarRecepcion = vi.fn().mockResolvedValue({ ok: true });
    return { controller: new InventarioController({ confirmarRecepcion } as never), confirmarRecepcion };
  };
  const dto = (accion?: string) => ({ movimientoId: 'm1', accion }) as any;

  it('con solo «Confirmar recepción» no puede rechazar por ninguno de los dos endpoints', async () => {
    const { controller, confirmarRecepcion } = armar();
    const u = con('envios.confirmar');

    await expect(controller.confirmarRecepcion(dto('RECHAZADO'), u)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.confirmarRecepcionDirecto(dto('RECHAZADO'), u)).rejects.toBeInstanceOf(ForbiddenException);
    expect(confirmarRecepcion).not.toHaveBeenCalled();
  });

  it('con solo «Rechazar recepción» no puede confirmar', async () => {
    const { controller, confirmarRecepcion } = armar();
    const u = con('envios.rechazar');

    await expect(controller.confirmarRecepcion(dto('RECIBIDO'), u)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.confirmarRecepcionDirecto(dto(), u)).rejects.toBeInstanceOf(ForbiddenException);
    expect(confirmarRecepcion).not.toHaveBeenCalled();
  });

  it('cada casilla permite solo su acción', async () => {
    const { controller, confirmarRecepcion } = armar();

    await controller.confirmarRecepcion(dto('RECIBIDO'), con('envios.confirmar'));
    await controller.confirmarRecepcion(dto('RECHAZADO'), con('envios.rechazar'));

    expect(confirmarRecepcion).toHaveBeenCalledTimes(2);
  });
});
