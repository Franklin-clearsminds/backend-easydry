import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { HorariosService } from './horarios.service.js';
import { HORARIO_POR_DEFECTO } from './rrhh.horarios.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real: horarios por persona y ajuste general. El reloj se simula solo en `Date` y en un año lejano para no cruzarse
 * con datos reales. Lo que crea la prueba en `ajustes_horario` (que no cuelga de ningún usuario) se borra por su marca.
 */
const HOY = new Date('2032-06-15T13:30:00Z'); // 08:30 en Ecuador
const MANANA = '2032-06-16';
const semana = (entrada: string, salida: string, extra: Record<number, Partial<{ trabaja: boolean; entrada: string; salida: string }>> = {}) =>
  HORARIO_POR_DEFECTO.map((d, i) => ({ ...d, entrada, salida, ...(extra[i] ?? {}) }));

describe('HorariosService (base real)', () => {
  let env: Entorno;
  let service: HorariosService;
  const ids: Record<string, string> = {};
  const actores: Record<string, any> = {};
  const motivo = (t: string) => `${env.marca} ${t}`;

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new HorariosService(env.prisma as never, env.notificaciones());
    const region = await env.region('HOR');
    const otraRegion = await env.region('HOR2');
    const agencia = await env.agencia('hor-a', { regionId: region.id });
    const lejana = await env.agencia('hor-b', { regionId: otraRegion.id });
    const crear = async (clave: string, rol: string, opts: Record<string, unknown> = {}) => { ids[clave] = (await env.usuario(clave, rol, opts)).id; };
    await crear('lavador', 'LAVADOR', { agenciaId: agencia.id, regionId: region.id });
    await crear('lavador2', 'LAVADOR', { agenciaId: agencia.id, regionId: region.id });
    await crear('lavadorLejano', 'LAVADOR', { agenciaId: lejana.id, regionId: otraRegion.id });
    await crear('supervisor', 'SUPERVISOR', { regionId: region.id });
    await crear('admin', 'ADMIN');
    for (const clave of Object.keys(ids)) actores[clave] = await env.actor(ids[clave]);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(HOY);
  });

  afterAll(async () => {
    vi.useRealTimers();
    await env.prisma.ajusteHorario.deleteMany({ where: { motivo: { startsWith: env.marca } } });
    await env.cerrar();
  });

  afterEach(() => vi.setSystemTime(HOY));

  it('sin cambios rige el horario por defecto: 08:00 a 15:00 los siete días', async () => {
    const c = await service.contextoDe(ids.lavador, '2032-06-15');
    expect(c.dia).toEqual({ trabaja: true, entrada: '08:00', salida: '15:00' });
    expect(c.ajuste).toEqual({ toleranciaMin: 10, ventanaMin: 120 });
    expect((await service.mio(actores.lavador)).porDefecto).toBe(true);
  });

  it('un cambio rige desde mañana, nunca desde hoy, y exige un motivo', async () => {
    const r = await service.editar({ userId: ids.lavador, dias: semana('09:00', '16:00'), motivo: motivo('turno acordado') }, actores.admin);
    expect(r.mensaje).toContain(MANANA);
    expect((await service.contextoDe(ids.lavador, '2032-06-15')).dia.entrada).toBe('08:00'); // hoy sigue igual
    expect((await service.contextoDe(ids.lavador, MANANA)).dia).toMatchObject({ entrada: '09:00', salida: '16:00' });
    expect((await service.contextoDe(ids.lavador, '2032-06-14')).dia.entrada).toBe('08:00'); // el pasado no cambia
    await expect(service.editar({ userId: ids.lavador, dias: semana('09:00', '16:00'), motivo: '  ab ' }, actores.admin)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('el historial guarda quién, cuándo, desde cuándo, el horario anterior y el nuevo; cada cambio deja intacto el anterior', async () => {
    await service.editar({ userId: ids.lavador, dias: semana('10:00', '17:00', { 6: { trabaja: false } }), motivo: motivo('segundo cambio') }, actores.admin);
    const h = await service.historial(ids.lavador, actores.admin);
    expect(h).toHaveLength(2);
    expect(h[0]).toMatchObject({ vigenteDesde: MANANA, motivo: motivo('segundo cambio'), actor: expect.stringContaining('Prueba') });
    expect(h[0].dias[0].entrada).toBe('10:00');
    expect(h[0].dias[6].trabaja).toBe(false);
    expect(h[0].anterior[0].entrada).toBe('09:00'); // el horario anterior es el del primer cambio
    expect(h[1].dias[0].entrada).toBe('09:00'); // y ese primer cambio sigue como se guardó
    expect(h[1].anterior).toEqual(HORARIO_POR_DEFECTO);
    expect(h[0].creadoEn).toBeInstanceOf(Date);
    // a igual fecha de inicio rige el último guardado
    expect((await service.contextoDe(ids.lavador, MANANA)).dia.entrada).toBe('10:00');
  });

  it('el equipo muestra el horario vigente y el cambio programado', async () => {
    const e = await service.equipo(actores.admin);
    const p = e.personas.find((x) => x.id === ids.lavador)!;
    expect(p.semana[0].entrada).toBe('08:00');
    expect(p.proximoCambio).toMatchObject({ vigenteDesde: MANANA });
    expect(p.proximoCambio!.semana[0].entrada).toBe('10:00');
    expect(e.personas.find((x) => x.id === ids.admin)).toBeUndefined(); // los administradores no tienen horario
    expect(e.personas.find((x) => x.id === ids.lavador2)!.porDefecto).toBe(true);
  });

  it('se rechaza un horario inválido, a un administrador y a una persona fuera de alcance', async () => {
    await expect(service.editar({ userId: ids.lavador2, dias: semana('15:00', '08:00'), motivo: motivo('mal') }, actores.admin)).rejects.toThrow(/posterior/);
    await expect(service.editar({ userId: ids.lavador2, dias: semana('08:00', '15:00').slice(0, 5), motivo: motivo('corto') } as never, actores.admin)).rejects.toThrow(/7 días/);
    await expect(service.editar({ userId: ids.admin, dias: semana('08:00', '15:00'), motivo: motivo('admin') }, actores.admin)).rejects.toThrow(/no timbra/);
    await expect(service.editar({ userId: ids.lavadorLejano, dias: semana('08:00', '15:00'), motivo: motivo('lejos') }, actores.supervisor)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.historial(ids.lavadorLejano, actores.supervisor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await env.prisma.horarioPersona.count({ where: { userId: ids.lavador2 } })).toBe(0);
  });

  it('el ajuste general: rige desde mañana, respeta los límites y guarda historial', async () => {
    await expect(service.editarAjuste({ toleranciaMin: 4, ventanaMin: 60, motivo: motivo('x') }, actores.admin)).rejects.toThrow(/tolerancia/);
    await expect(service.editarAjuste({ toleranciaMin: 21, ventanaMin: 60, motivo: motivo('x') }, actores.admin)).rejects.toThrow(/tolerancia/);
    await expect(service.editarAjuste({ toleranciaMin: 10, ventanaMin: 121, motivo: motivo('x') }, actores.admin)).rejects.toThrow(/ventana/);
    await expect(service.editarAjuste({ toleranciaMin: 15, ventanaMin: 10, motivo: motivo('x') }, actores.admin)).rejects.toThrow(/menor que la tolerancia/);
    await expect(service.editarAjuste({ toleranciaMin: 15, ventanaMin: 90, motivo: '' }, actores.admin)).rejects.toThrow(/motivo/);

    const r = await service.editarAjuste({ toleranciaMin: 15, ventanaMin: 90, motivo: motivo('más margen') }, actores.admin);
    expect(r).toMatchObject({ toleranciaMin: 10, ventanaMin: 120, proximoCambio: { vigenteDesde: MANANA, toleranciaMin: 15, ventanaMin: 90 } });
    expect((await service.contextoDe(ids.lavador, '2032-06-15')).ajuste).toEqual({ toleranciaMin: 10, ventanaMin: 120 });
    expect((await service.contextoDe(ids.lavador, MANANA)).ajuste).toEqual({ toleranciaMin: 15, ventanaMin: 90 });

    const h = await service.historialAjustes();
    expect(h[0]).toMatchObject({ vigenteDesde: MANANA, toleranciaMin: 15, ventanaMin: 90, anterior: { toleranciaMin: 10, ventanaMin: 120 }, motivo: motivo('más margen') });
    expect(h[h.length - 1]).toMatchObject({ motivo: 'Valores iniciales', actor: 'Sistema', anterior: null });
  });

  it('la revisión avisa una sola vez de quien no marcó su entrada o su salida, a la persona y a los administradores', async () => {
    const de = (userId: string, clave: string) => ({ tipo: 'HORARIO_INCIDENCIA' as const, entidadId: ids.lavador2, userId, data: { path: ['clave'], equals: clave } });
    const soloPrueba = [ids.lavador2];

    // 10:30 del 15 de junio: ya pasó la ventana de la entrada (06:00 a 10:00) y no hay marcas
    expect(await service.revisarIncidencias(new Date('2032-06-15T15:30:00Z'), soloPrueba)).toBe(1);
    expect((await env.prisma.notification.findFirst({ where: de(ids.lavador2, '2032-06-15:SIN_MARCA') }))?.titulo).toBe('Día sin marcas');
    await env.esperar(() => env.prisma.notification.findFirst({ where: de(ids.admin, '2032-06-15:SIN_MARCA') }));
    expect(await service.revisarIncidencias(new Date('2032-06-15T15:35:00Z'), soloPrueba)).toBe(0); // no repite

    // con entrada y sin salida, ya pasada la ventana de la salida (17:00)
    await env.prisma.timbrada.create({
      data: { userId: ids.lavador2, tipo: 'ENTRADA', fechaDia: new Date('2032-06-16T00:00:00Z'), marcadaEn: new Date('2032-06-16T13:10:00Z'), origen: 'APP', fotoKey: `${env.marca}-f`, verificacion: 'SIN_VERIFICAR' },
    });
    expect(await service.revisarIncidencias(new Date('2032-06-16T22:30:00Z'), soloPrueba)).toBe(1);
    expect((await env.prisma.notification.findFirst({ where: de(ids.lavador2, '2032-06-16:ENTRADA_SIN_SALIDA') }))?.titulo).toBe('Entrada sin salida');
  });

  it('el día de la activación no genera alertas', async () => {
    const primero = await env.prisma.ajusteHorario.findFirstOrThrow({ orderBy: { vigenteDesde: 'asc' } });
    const dia = primero.vigenteDesde.toISOString().slice(0, 10);
    expect(await service.revisarIncidencias(new Date(`${dia}T23:00:00Z`), [ids.lavador])).toBe(0);
  });

  it('los días libres no generan alertas', async () => {
    const dias = semana('08:00', '15:00').map((d) => ({ ...d, trabaja: false }));
    await env.prisma.horarioPersona.create({ data: { userId: ids.lavador, vigenteDesde: new Date('2032-07-01T00:00:00Z'), dias, motivo: motivo('libre'), actorId: ids.admin } });
    expect(await service.revisarIncidencias(new Date('2032-07-05T16:00:00Z'), [ids.lavador])).toBe(0);
  });
});
