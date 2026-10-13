import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RetosService } from './retos.service.js';
import { ListRetosDto } from './dto/retos.dto.js';
import { hoyEcuador } from './retos.reglas.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks). Datos de partida, creados por esta prueba:
 *  - vigente:           ACTIVO, termina dentro de 20 días
 *  - activoVencido:     ACTIVO, terminó hace 3 días (todavía no lo cerró el cron)
 *  - finalizadoVencido: FINALIZADO, terminó hace 3 días
 *  - finalizadoVigente: FINALIZADO, termina dentro de 20 días
 * Todo se busca con `search: marca`. `cerrarVencidos` actúa sobre TODOS los retos de la base, por eso sus pruebas van
 * al final de este mismo archivo: ningún otro archivo de prueba lo ejecuta, así que no le cierra retos a nadie en paralelo.
 */
const DIA = 24 * 60 * 60 * 1000;
const fecha = (dias: number) => new Date(hoyEcuador().getTime() + dias * DIA);

describe('RetosService.list — vigencia (base real)', () => {
  let env: Entorno;
  let service: RetosService;
  let admin: any;
  let lavador: any;
  let costa: any;
  let sierra: any;
  const retos: Record<string, any> = {};

  const nuevo = async (clave: string, extra: Record<string, unknown>) => {
    const r = await env.prisma.reto.create({
      data: { titulo: `${env.marca} ${clave}`, fechaInicio: fecha(-30), fechaFin: fecha(20), ...extra } as never,
    });
    env.rastrear('Reto', r.id);
    retos[clave] = r;
    return r;
  };
  const lista = async (dto: Record<string, unknown>, actor: any) => {
    const r: any = await service.list({ page: 1, pageSize: 50, search: env.marca, ...dto } as any, actor);
    return (r.items as any[]).map((i) => i.titulo.replace(`${env.marca} `, '')).sort();
  };

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new RetosService(env.prisma as never);

    costa = await env.region('COSTA');
    sierra = await env.region('SIERRA');
    const agencia = await env.agencia('A1', { regionId: costa.id });
    admin = await env.actor((await env.usuario('admin', 'SUPER_ADMIN')).id);
    const l = await env.usuario('lavador', 'LAVADOR', { agenciaId: agencia.id, regionId: costa.id });
    lavador = await env.actor(l.id);

    await nuevo('vigente', {});
    await nuevo('activoVencido', { fechaFin: fecha(-3) });
    await nuevo('finalizadoVencido', { fechaFin: fecha(-3), estado: 'FINALIZADO' });
    await nuevo('finalizadoVigente', { estado: 'FINALIZADO' });
  });

  afterAll(async () => {
    await env.cerrar();
  });

  describe('vigencia', () => {
    it('ACTIVOS: solo estado ACTIVO (el valor por defecto de la pantalla)', async () => {
      expect(await lista({ vigencia: 'ACTIVOS' }, admin)).toEqual(['activoVencido', 'vigente']);
    });

    it('VENCIDOS: los que ya pasaron su fecha de fin (hoy en Ecuador), sea cual sea su estado', async () => {
      expect(await lista({ vigencia: 'VENCIDOS' }, admin)).toEqual(['activoVencido', 'finalizadoVencido']);
    });

    it('TODOS: sin filtro de estado ni de fecha', async () => {
      expect(await lista({ vigencia: 'TODOS' }, admin)).toEqual(['activoVencido', 'finalizadoVencido', 'finalizadoVigente', 'vigente']);
    });

    it('sin vigencia se conservan los indicadores antiguos (soloActivos / incluirTodos)', async () => {
      expect(await lista({}, admin)).toEqual(['activoVencido', 'vigente']);
      expect(await lista({ incluirTodos: true, soloActivos: false }, admin)).toEqual(['activoVencido', 'finalizadoVencido', 'finalizadoVigente', 'vigente']);
    });

    it('un rol que no es administrador sigue viendo solo lo visible para su región y sucursal, con cualquier vigencia', async () => {
      await nuevo('verano costa', { regiones: [costa.nombre] });
      await nuevo('verano sierra', { regiones: [sierra.nombre] });
      expect(await lista({ vigencia: 'TODOS', search: `${env.marca} verano` }, lavador)).toEqual(['verano costa']);
      // El administrador ve los dos.
      expect(await lista({ vigencia: 'TODOS', search: `${env.marca} verano` }, admin)).toEqual(['verano costa', 'verano sierra']);
    });
  });

  describe('el DTO', () => {
    it('acepta solo las tres vigencias', async () => {
      expect(await validate(plainToInstance(ListRetosDto, { vigencia: 'VENCIDOS', page: 1 }))).toHaveLength(0);
      expect((await validate(plainToInstance(ListRetosDto, { vigencia: 'otra' }))).length).toBeGreaterThan(0);
    });
  });

  // Van al final: cerrarVencidos cambia el estado de TODOS los retos ACTIVO ya vencidos (incluido `activoVencido`).
  describe('cerrarVencidos', () => {
    it('cierra solo los activos cuya fecha fin ya pasó (hora de Ecuador), sin usuario que cierre', async () => {
      const a = await nuevo('cv-a', { fechaFin: fecha(-2) });
      const b = await nuevo('cv-b', { fechaFin: fecha(-1) });
      const vigente = await nuevo('cv-vigente', { fechaFin: fecha(5) });
      const yaCerrado = await nuevo('cv-cerrado', { fechaFin: fecha(-2), estado: 'FINALIZADO' });

      const cerrados = await service.cerrarVencidos();
      expect(cerrados).toBeGreaterThanOrEqual(2);

      for (const r of [a, b]) {
        const fila = await env.prisma.reto.findUniqueOrThrow({ where: { id: r.id } });
        expect(fila).toMatchObject({ estado: 'FINALIZADO', cerradoPorId: null, resultado: 'Cerrado automáticamente al vencer.' });
        expect(fila.cerradoEn).not.toBeNull();
      }
      expect((await env.prisma.reto.findUniqueOrThrow({ where: { id: vigente.id } })).estado).toBe('ACTIVO');
      expect((await env.prisma.reto.findUniqueOrThrow({ where: { id: yaCerrado.id } })).cerradoEn).toBeNull(); // no se vuelve a cerrar
    });

    it('si un reto falla, sigue con los demás', async () => {
      // Con la base real no hay forma natural de que un reto falle al cerrarse (el servicio tolera datos raros), así que
      // se provoca el error de UN reto concreto con una subclase mínima. Todo lo demás (base, ranking, cierre) es real.
      const roto = await nuevo('cv-roto', { fechaFin: fecha(-2) });
      const sano = await nuevo('cv-sano', { fechaFin: fecha(-2) });
      class ServicioConUnFallo extends RetosService {
        protected async finalizar(reto: any, cerradoPorId: string | null, resultado: string | null) {
          if (reto.id === roto.id) throw new Error('fallo provocado por la prueba');
          return (RetosService.prototype as any).finalizar.call(this, reto, cerradoPorId, resultado);
        }
      }
      const conFallo = new ServicioConUnFallo(env.prisma as never);

      await conFallo.cerrarVencidos();

      expect((await env.prisma.reto.findUniqueOrThrow({ where: { id: sano.id } })).estado).toBe('FINALIZADO');
      expect((await env.prisma.reto.findUniqueOrThrow({ where: { id: roto.id } })).estado).toBe('ACTIVO'); // falló y quedó pendiente
    });
  });
});
