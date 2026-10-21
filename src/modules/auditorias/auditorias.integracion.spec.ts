import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InformesInspeccionService } from './informes.service.js';
import { Auditoria5sService } from './auditoria5s.service.js';
import { FORMATOS } from './auditoria5s.reglas.js';
import { tienePermiso } from '../../common/permisos/capacidades.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks): informes de inspección y auditorías 5S.
 *
 * Mundo: región R1 con las agencias A y B, y región R2 con la agencia C. Usuarios con los roles oficiales ya sembrados:
 *  - APROBADOR (agencia A) y TECNICO (región R1): auditan.
 *  - SUPERVISOR (región R1) y ADMIN: auditan y además revisan, verifican y eliminan borradores.
 *  - LIDER y LAVADOR (agencia A) y PULIDOR (agencia B): no auditan, solo ven resultados.
 */
describe('auditorías (informes de inspección y 5S) — base real', () => {
  let env: Entorno;
  let informes: InformesInspeccionService;
  let a5s: Auditoria5sService;
  const ag: Record<string, { id: string; nombre: string }> = {};
  const u: Record<string, any> = {};

  const hoy = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    env = await abrirEntorno();
    informes = new InformesInspeccionService(env.prisma as never);
    a5s = new Auditoria5sService(env.prisma as never);
    const r1 = await env.region('r1');
    const r2 = await env.region('r2');
    ag.A = await env.agencia('a', { regionId: r1.id });
    ag.B = await env.agencia('b', { regionId: r1.id });
    ag.C = await env.agencia('c', { regionId: r2.id });
    const crear = async (clave: string, rol: string, opts: { agenciaId?: string; regionId?: string } = {}) => {
      const x = await env.usuario(clave, rol, opts);
      u[clave] = await env.actor(x.id);
    };
    await crear('aprobador', 'APROBADOR', { agenciaId: ag.A.id });
    await crear('tecnico', 'TECNICO', { regionId: r1.id });
    await crear('supervisor', 'SUPERVISOR', { regionId: r1.id });
    await crear('admin', 'ADMIN');
    await crear('lider', 'LIDER', { agenciaId: ag.A.id });
    await crear('lavador', 'LAVADOR', { agenciaId: ag.A.id });
    await crear('pulidor', 'PULIDOR', { agenciaId: ag.B.id });
  });

  afterAll(async () => {
    await env.cerrar();
  });

  const rastrearInforme = (id: string) => env.rastrear('InformeInspeccion', id);
  const rastrearAuditoria = (id: string) => env.rastrear('Auditoria5s', id);

  describe('quién puede auditar (permisos reales de la base)', () => {
    it('líder, lavador y pulidor no auditan: solo ven resultados', () => {
      for (const clave of ['lider', 'lavador', 'pulidor']) {
        expect(tienePermiso(u[clave], 'informes.ver'), clave).toBe(true);
        expect(tienePermiso(u[clave], 'inspecciones.ver'), clave).toBe(true);
        for (const c of ['informes.crear', 'informes.firmar', 'informes.revisar', 'inspecciones.crear', 'inspecciones.acciones', 'inspecciones.verificar']) {
          expect(tienePermiso(u[clave], c), `${clave} ${c}`).toBe(false);
        }
      }
    });

    it('el resto de roles auditan; supervisor y administrador además revisan', () => {
      for (const clave of ['aprobador', 'tecnico', 'supervisor', 'admin']) {
        expect(tienePermiso(u[clave], 'informes.crear'), clave).toBe(true);
        expect(tienePermiso(u[clave], 'inspecciones.crear'), clave).toBe(true);
      }
      expect(tienePermiso(u.aprobador, 'informes.revisar')).toBe(false);
      expect(tienePermiso(u.tecnico, 'inspecciones.verificar')).toBe(false);
      expect(tienePermiso(u.supervisor, 'informes.revisar')).toBe(true);
      expect(tienePermiso(u.supervisor, 'inspecciones.verificar')).toBe(true);
    });
  });

  describe('informes de inspección', () => {
    let id: string;
    const base = () => ({
      agenciaId: ag.A.id,
      destinatarioNombre: 'Jefe de taller de prueba',
      asunto: 'Visita mensual',
      antecedentes: 'Sin antecedentes',
      desarrollo: 'Todo en orden',
      novedades: [{ titulo: 'Manguera rota', categoria: 'MAQUINARIA', prioridad: 'ALTA', fotos: [] }],
      actividades: [{ nombre: 'Revisión de bahías' }],
      planes: [{ problema: 'Cambiar manguera', areaResponsable: 'Mantenimiento', fechaCompromiso: '2020-01-01' }],
    });

    it('solo se puede crear en una agencia del alcance', async () => {
      await expect(informes.create({ ...base(), agenciaId: ag.C.id }, u.aprobador)).rejects.toThrow(/fuera de tu alcance/);
      await expect(informes.create({ ...base(), agenciaId: ag.B.id }, u.aprobador)).rejects.toThrow(/fuera de tu alcance/);
      const d = await informes.create(base(), u.aprobador);
      id = d.id;
      rastrearInforme(id);
      expect(d.estado).toBe('BORRADOR');
      expect(d.numero).toMatch(/^INF-\d{4}-\d{4}$/);
      expect(d.numeroMensual).toBe(1);
      expect(d.historial.map((h: any) => h.accion)).toContain('CREADO');
    });

    it('el número mensual sigue por agencia y mes, y el identificador no se repite', async () => {
      const otro = await informes.create(base(), u.aprobador);
      rastrearInforme(otro.id);
      expect(otro.numeroMensual).toBe(2);
      const detalle = await informes.detail(id, u.aprobador);
      expect(otro.numero).not.toBe(detalle.numero);
    });

    it('no se envía a revisión sin calificación; un borrador ajeno no se edita', async () => {
      await expect(informes.enviar(id, u.aprobador)).rejects.toThrow(/calificación/);
      await expect(informes.update({ ...base(), id, calificacion: 'BUENO' }, u.tecnico)).rejects.toThrow(/Solo quien elaboró/);
    });

    it('se guarda con novedades, calificación y observaciones; sin los permisos de calificar no se cambian', async () => {
      const d = await informes.update({ ...base(), id, calificacion: 'BUENO', observacionesJefeTaller: 'Buen trabajo' }, u.aprobador);
      expect(d.calificacion).toBe('BUENO');
      expect(d.calificadoPorNombre).toBeTruthy();
      expect(d.novedades).toHaveLength(1);
      expect(d.planes[0].estadoEfectivo).toBe('VENCIDO');
    });

    it('antes de aprobarse, el líder y el lavador no lo ven; quien audita sí, dentro de su alcance', async () => {
      await expect(informes.detail(id, u.lider)).rejects.toThrow(/fuera de tu alcance|No existe/);
      expect((await informes.list({ pageSize: 50 } as never, u.lider)).items.map((i: any) => i.id)).not.toContain(id);
      expect((await informes.list({ pageSize: 50 } as never, u.tecnico)).items.map((i: any) => i.id)).toContain(id);
      expect((await informes.list({ pageSize: 50 } as never, u.pulidor)).items.map((i: any) => i.id)).not.toContain(id);
    });

    it('el flujo: enviar → el autor no se revisa a sí mismo → el supervisor aprueba → aprobado (las firmas se hacen a mano en el papel)', async () => {
      const enviado = await informes.enviar(id, u.aprobador);
      expect(enviado.estado).toBe('EN_REVISION');
      await expect(informes.update({ ...base(), id }, u.aprobador)).rejects.toThrow(/ya no es un borrador/);
      await expect(informes.revisar({ id, decision: 'APROBAR' }, u.aprobador)).rejects.toThrow(/revisar/);

      const aprobado = await informes.revisar({ id, decision: 'APROBAR' }, u.supervisor);
      expect(aprobado.estado).toBe('APROBADO');
      expect(aprobado.historial.map((h: any) => h.accion)).toEqual(expect.arrayContaining(['ENVIADO_REVISION', 'APROBADO']));
      expect((aprobado as any).firmas).toBeUndefined();
    });

    it('un informe rechazado exige motivo y se reabre para corregirlo', async () => {
      const x = await informes.create(base(), u.aprobador);
      rastrearInforme(x.id);
      await informes.update({ ...base(), id: x.id, calificacion: 'REGULAR' }, u.aprobador);
      await informes.enviar(x.id, u.aprobador);
      await expect(informes.revisar({ id: x.id, decision: 'RECHAZAR' }, u.supervisor)).rejects.toThrow(/motivo/);
      const r = await informes.revisar({ id: x.id, decision: 'RECHAZAR', motivo: 'Faltan fotos' }, u.supervisor);
      expect(r.estado).toBe('RECHAZADO');
      expect(r.motivoRechazo).toBe('Faltan fotos');
      expect((await informes.reabrir(x.id, u.aprobador)).estado).toBe('BORRADOR');
    });

    it('ya aprobado, el líder y el lavador de su agencia lo ven (solo lectura); el pulidor de otra agencia no', async () => {
      for (const clave of ['lider', 'lavador']) {
        const d = await informes.detail(id, u[clave]);
        expect(d.estado).toBe('APROBADO');
        expect(Object.values(d.permisos).some(Boolean), clave).toBe(false);
      }
      await expect(informes.detail(id, u.pulidor)).rejects.toThrow();
      const ids = (await informes.list({ pageSize: 50 } as never, u.lavador)).items.map((i: any) => i.id);
      expect(ids).toEqual(expect.arrayContaining([id]));
      expect(ids).toHaveLength(1);
    });

    it('el seguimiento de un plan cambia su estado sin tocar el contenido aprobado', async () => {
      const antes = await informes.detail(id, u.aprobador);
      const plan = antes.planes[0];
      const d = await informes.seguimientoPlan({ planId: plan.id, estado: 'COMPLETADO', observaciones: 'Se cambió la manguera' }, u.aprobador);
      expect(d.planes[0].estado).toBe('COMPLETADO');
      expect(d.planes[0].estadoEfectivo).toBe('COMPLETADO');
      expect(d.planes[0].completadoEn).toBeTruthy();
      expect(d.asunto).toBe(antes.asunto);
      await expect(informes.seguimientoPlan({ planId: plan.id, estado: 'PENDIENTE' }, u.lider)).rejects.toThrow();
    });

    it('cerrar es de quien revisa; solo un borrador se elimina', async () => {
      await expect(informes.cerrar(id, u.aprobador)).rejects.toThrow(/quien revisa/);
      expect((await informes.cerrar(id, u.supervisor)).estado).toBe('CERRADO');
      await expect(informes.eliminar(id, u.admin)).rejects.toThrow(/borrador/);
      const borrador = await informes.create(base(), u.aprobador);
      rastrearInforme(borrador.id);
      await expect(informes.eliminar(borrador.id, u.aprobador)).rejects.toThrow(); // el inspector no tiene permiso de eliminar
      expect((await informes.eliminar(borrador.id, u.supervisor)).success).toBe(true);
      await expect(informes.detail(borrador.id, u.admin)).rejects.toThrow();
    });

    it('el resumen cuenta solo lo que el usuario ve', async () => {
      const r = await informes.resumen(u.lavador);
      expect(r.total).toBe(1);
      expect(r.aprobados).toBe(1);
      const sup = await informes.resumen(u.supervisor);
      expect(sup.total).toBeGreaterThanOrEqual(3);
    });
  });

  describe('auditoría 5S (tres formatos)', () => {
    const LISTA = FORMATOS.LISTA_20;
    const PUNTOS = FORMATOS.PUNTOS_25;
    const SINO = FORMATOS.SI_NO_50;
    let id: string;
    const resp20 = (puntaje: (n: number) => number | null) =>
      LISTA.criterios.map((c) => {
        const p = puntaje(c.numero);
        return p !== null && p < 5
          ? { criterio: c.numero, puntaje: p, hallazgo: `Hallazgo ${c.numero}`, accionCorrectiva: 'Corregir', responsable: 'Líder', fechaCompromiso: '2020-01-01', fotos: [] }
          : { criterio: c.numero, puntaje: p };
      });

    it('el catálogo trae los tres formatos con sus preguntas, escala y reglas del semáforo', () => {
      const c = a5s.catalogo();
      expect(c.formatos.map((f) => f.id)).toEqual(['LISTA_20', 'PUNTOS_25', 'SI_NO_50']);
      expect(c.formatos.map((f) => f.categorias.flatMap((k) => k.criterios).length)).toEqual([20, 25, 50]);
      expect(c.formatos.map((f) => f.puntajeMaximo)).toEqual([100, 100, 50]);
      expect(c.areas.map((x) => x.id)).toEqual(['LAVADO', 'ASPIRADO', 'SECADO', 'ALMACENAMIENTO', 'ADMINISTRACION']);
    });

    it('se crea en una agencia del alcance; un borrador sin puntajes no tiene semáforo', async () => {
      await expect(a5s.create({ agenciaId: ag.C.id, area: 'LAVADO' }, u.aprobador)).rejects.toThrow(/fuera de tu alcance/);
      const sinArea = await a5s.create({ agenciaId: ag.A.id }, u.aprobador);
      rastrearAuditoria(sinArea.id);
      expect(sinArea.area).toBe('GENERAL');
      // Guardar de nuevo una auditoría sin área (el formulario devuelve «GENERAL») no debe fallar.
      expect((await a5s.update({ id: sinArea.id, agenciaId: ag.A.id, area: 'GENERAL' }, u.aprobador)).area).toBe('GENERAL');
      const d = await a5s.create({ agenciaId: ag.A.id, area: 'LAVADO', responsableAgencia: 'Responsable de prueba' }, u.aprobador);
      id = d.id;
      rastrearAuditoria(id);
      expect(d.estado).toBe('BORRADOR');
      expect(d.formato).toBe('LISTA_20');
      expect(d.codigo).toMatch(/^A5S-\d{4}-\d{4}$/);
      expect(d.criterios).toHaveLength(20);
      expect(d.resultado.evaluados).toBe(0);
    });

    it('guarda el avance sin contar lo pendiente como cero, y no deja finalizar con criterios sin evaluar', async () => {
      const d = await a5s.update({ id, agenciaId: ag.A.id, area: 'LAVADO', respuestas: resp20((n) => (n <= 12 ? 5 : null)) }, u.aprobador);
      expect(d.estado).toBe('EN_PROCESO');
      expect(d.resultado.evaluados).toBe(12);
      expect(d.resultado.puntaje).toBe(60);
      await expect(a5s.finalizar(id, u.aprobador)).rejects.toThrow(/faltan por evaluar 8/);
    });

    it('antes de finalizar, el líder y el lavador no la ven', async () => {
      await expect(a5s.detail(id, u.lider)).rejects.toThrow();
      expect((await a5s.list({ pageSize: 50 } as never, u.lavador)).items.map((i: any) => i.id)).not.toContain(id);
    });

    it('rechaza respuestas que no existen en el formato', async () => {
      await expect(a5s.update({ id, agenciaId: ag.A.id, area: 'LAVADO', respuestas: [{ criterio: 25, puntaje: 3 }] }, u.aprobador)).rejects.toThrow(/no existe en este formato/);
    });

    it('finaliza con todos los criterios: fija el puntaje y el semáforo en el servidor y abre las acciones correctivas', async () => {
      // 16 criterios en 5 y 4 en 3 (Seiketsu): 92 puntos → verde
      await a5s.update({ id, agenciaId: ag.A.id, area: 'LAVADO', respuestas: resp20((n) => (n >= 13 && n <= 16 ? 3 : 5)) }, u.aprobador);
      const d = await a5s.finalizar(id, u.aprobador);
      expect(d.estado).toBe('FINALIZADA');
      expect(d.resultado.puntaje).toBe(92);
      expect(d.resultado.semaforo).toBe('VERDE');
      expect(d.resultado.porCategoria.map((c: any) => c.puntaje)).toEqual([20, 20, 20, 12, 20]);
      expect(d.acciones).toHaveLength(4);
      expect(d.acciones[0]).toMatchObject({ criterio: 13, prioridad: 'MEDIA', estado: 'PENDIENTE', estadoEfectivo: 'VENCIDA' });
      expect(d.acciones[0].codigo).toBe(`${d.codigo}-C13`);
    });

    it('lo finalizado no se modifica ni se vuelve a finalizar', async () => {
      await expect(a5s.update({ id, agenciaId: ag.A.id, area: 'LAVADO', respuestas: resp20(() => 0) }, u.aprobador)).rejects.toThrow(/ya está finalizada/);
      await expect(a5s.finalizar(id, u.aprobador)).rejects.toThrow();
      expect((await a5s.detail(id, u.aprobador)).resultado.puntaje).toBe(92);
    });

    it('líder y lavador de la agencia ven el resultado (solo lectura); el pulidor de otra agencia no', async () => {
      for (const clave of ['lider', 'lavador']) {
        const d = await a5s.detail(id, u[clave]);
        expect(d.resultado.semaforo).toBe('VERDE');
        expect(Object.values(d.permisos).some(Boolean), clave).toBe(false);
      }
      await expect(a5s.detail(id, u.pulidor)).rejects.toThrow();
    });

    it('la acción solo se cierra después de verificarla, sin alterar el puntaje histórico', async () => {
      const antes = await a5s.detail(id, u.aprobador);
      const accion = antes.acciones[0];
      await expect(a5s.seguimientoAccion({ id: accion.id, estado: 'EN_VERIFICACION' }, u.aprobador)).rejects.toThrow(/evidencia|describe/);
      const enVerif = await a5s.seguimientoAccion({ id: accion.id, estado: 'EN_VERIFICACION', observaciones: 'Se colocó el instructivo' }, u.aprobador);
      expect(enVerif.acciones[0].estado).toBe('EN_VERIFICACION');
      await expect(a5s.verificarAccion({ id: accion.id, decision: 'CERRAR' }, u.aprobador)).rejects.toThrow(/no puede verificar/);
      await expect(a5s.verificarAccion({ id: accion.id, decision: 'DEVOLVER' }, u.supervisor)).rejects.toThrow(/por qué/);
      const cerrada = await a5s.verificarAccion({ id: accion.id, decision: 'CERRAR' }, u.supervisor);
      expect(cerrada.acciones[0]).toMatchObject({ estado: 'CERRADA', verificadaPorNombre: expect.any(String) });
      expect(cerrada.resultado.puntaje).toBe(92);
      await expect(a5s.seguimientoAccion({ id: accion.id, estado: 'EN_PROCESO' }, u.aprobador)).rejects.toThrow(/ya está cerrada/);
    });

    it('la auditoría solo se cierra cuando no quedan acciones abiertas', async () => {
      await expect(a5s.cerrar(id, u.supervisor)).rejects.toThrow(/sin cerrar/);
      const d = await a5s.detail(id, u.supervisor);
      for (const accion of d.acciones.filter((x: any) => x.estado !== 'CERRADA')) {
        await a5s.seguimientoAccion({ id: accion.id, estado: 'EN_VERIFICACION', observaciones: 'Hecho' }, u.aprobador);
        await a5s.verificarAccion({ id: accion.id, decision: 'CERRAR' }, u.supervisor);
      }
      await expect(a5s.cerrar(id, u.aprobador)).rejects.toThrow(/quien verifica/);
      expect((await a5s.cerrar(id, u.supervisor)).estado).toBe('CERRADA');
    });

    it('compara las auditorías finalizadas de la misma agencia, área y formato, con la variación y la anterior', async () => {
      const segunda = await a5s.create({ agenciaId: ag.A.id, area: 'LAVADO', fecha: hoy, respuestas: resp20((n) => (n % 2 === 0 ? 5 : 4)) }, u.aprobador);
      rastrearAuditoria(segunda.id);
      const fin = await a5s.finalizar(segunda.id, u.aprobador);
      expect(fin.anterior).toMatchObject({ codigo: expect.any(String), puntaje: 92 });
      expect(fin.anterior!.diferencia).toBe(fin.resultado.puntaje - 92);
      const historia = await a5s.comparar({ agenciaId: ag.A.id, area: 'LAVADO', formato: 'LISTA_20' }, u.supervisor);
      expect(historia.length).toBeGreaterThanOrEqual(2);
      expect(historia[0].variacion).toBeNull();
      const ultima = historia[historia.length - 1];
      expect(ultima.variacion).toBe(ultima.puntaje - historia[historia.length - 2].puntaje);
      expect(ultima.porCategoria).toHaveLength(5);
      // Otro formato de la misma agencia y área no se mezcla en la comparación.
      expect(await a5s.comparar({ agenciaId: ag.A.id, area: 'LAVADO', formato: 'SI_NO_50' }, u.supervisor)).toEqual([]);
    });

    describe('varios formatos en una misma visita', () => {
      let g: any;
      let idPuntos: string;
      let idSiNo: string;

      it('elegir los tres crea tres auditorías con los mismos datos, cada una con su código y formato', async () => {
        g = await a5s.create({ agenciaId: ag.A.id, area: 'SECADO', fecha: '2026-10-10', responsableAgencia: 'Ana', equipoPersona: 'Secadora 2', formatos: ['LISTA_20', 'PUNTOS_25', 'SI_NO_50'] }, u.aprobador);
        expect(g.hermanas).toHaveLength(3);
        expect(g.hermanas.map((h: any) => h.formato).sort()).toEqual(['LISTA_20', 'PUNTOS_25', 'SI_NO_50']);
        expect(new Set(g.hermanas.map((h: any) => h.codigo)).size).toBe(3);
        for (const h of g.hermanas) rastrearAuditoria(h.id);
        idPuntos = g.hermanas.find((h: any) => h.formato === 'PUNTOS_25').id;
        idSiNo = g.hermanas.find((h: any) => h.formato === 'SI_NO_50').id;
        const p = await a5s.detail(idPuntos, u.aprobador);
        expect(p).toMatchObject({ formato: 'PUNTOS_25', responsableAgencia: 'Ana', equipoPersona: 'Secadora 2', area: 'SECADO', fecha: '2026-10-10' });
        expect(p.criterios).toHaveLength(25);
        const s = await a5s.detail(idSiNo, u.aprobador);
        expect(s.criterios).toHaveLength(50);
        expect(s.criterios[0].favorable).toBe('NO');
      });

      it('se puntúan, guardan y finalizan por separado; cambiar los datos de la visita los comparte', async () => {
        // 25 criterios: 3 en 2 y 22 en 4 → 94 puntos
        const respP = PUNTOS.criterios.map((c) => ({ criterio: c.numero, puntaje: c.numero <= 3 ? 2 : 4 }));
        const p = await a5s.update({ id: idPuntos, agenciaId: ag.A.id, area: 'SECADO', responsableAgencia: 'Beatriz', comentariosCategoria: { SEIRI: 'Retirar cajas', INVALIDA: 'no' }, respuestas: respP }, u.aprobador);
        expect(p.comentariosCategoria).toEqual({ SEIRI: 'Retirar cajas' });
        expect(p.resultado.puntaje).toBe(94);
        expect(p.resultado.puntajeMaximo).toBe(100);
        expect(p.resultado.semaforo).toBe('VERDE');
        // La otra auditoría de la visita no se tocó, pero sí heredó el dato de la visita.
        const lista = await a5s.detail(g.id, u.aprobador);
        expect(lista.formato).toBe('LISTA_20');
        expect(lista.resultado.evaluados).toBe(0);
        expect(lista.responsableAgencia).toBe('Beatriz');
        // SI/NO: la respuesta favorable depende de la pregunta. Solo la 1 incumple (responde SI a «¿Hay cosas inútiles?»).
        const respS = SINO.criterios.map((c) => ({
          criterio: c.numero,
          puntaje: c.numero === 1 ? (c.favorable === 'NO' ? 1 : 0) : c.favorable === 'SI' ? 1 : 0,
          ...(c.numero === 1 ? { hallazgo: 'Hay cajas viejas', accionCorrectiva: 'Retirarlas' } : {}),
        }));
        const s = await a5s.update({ id: idSiNo, agenciaId: ag.A.id, area: 'SECADO', respuestas: respS }, u.aprobador);
        expect(s.resultado).toMatchObject({ puntaje: 49, puntajeMaximo: 50, porcentaje: 98, semaforo: 'VERDE', total: 50 });
        expect(s.resultado.porCategoria[0]).toMatchObject({ puntaje: 9, noConformes: 1 });
        await expect(a5s.update({ id: idSiNo, agenciaId: ag.A.id, area: 'SECADO', respuestas: [{ criterio: 2, puntaje: 3 }] }, u.aprobador)).rejects.toThrow(/SI o NO/);
        const fin = await a5s.finalizar(idSiNo, u.aprobador);
        expect(fin.estado).toBe('FINALIZADA');
        expect(fin.acciones).toHaveLength(1);
        expect(fin.acciones[0]).toMatchObject({ criterio: 1, prioridad: 'ALTA' });
        // Finalizar una no finaliza las demás.
        expect((await a5s.detail(idPuntos, u.aprobador)).estado).toBe('EN_PROCESO');
        expect((await a5s.detail(g.id, u.aprobador)).estado).toBe('BORRADOR');
      });

      it('la lista y el resumen se pueden filtrar por formato', async () => {
        const solo = await a5s.list({ pageSize: 50, formato: 'SI_NO_50' } as never, u.supervisor);
        expect(solo.items.every((i: any) => i.formato === 'SI_NO_50')).toBe(true);
        expect(solo.items.map((i: any) => i.id)).toContain(idSiNo);
        const r = await a5s.resumen({ formato: 'SI_NO_50' } as never, u.supervisor);
        expect(r.porS).toHaveLength(5);
        expect(r.porS[0].porcentaje).toBeGreaterThan(0);
      });
    });

    it('un borrador se elimina solo con permiso; el resumen cuenta lo que cada usuario ve', async () => {
      const b = await a5s.create({ agenciaId: ag.A.id, area: 'ASPIRADO' }, u.aprobador);
      rastrearAuditoria(b.id);
      await expect(a5s.eliminar(b.id, u.aprobador)).rejects.toThrow();
      expect((await a5s.eliminar(b.id, u.supervisor)).success).toBe(true);
      const r = await a5s.resumen({} as never, u.lavador);
      expect(r.realizadas).toBeGreaterThanOrEqual(3);
      expect(r.agenciasVerde + r.agenciasAmarillo + r.agenciasRojo).toBe(1);
      expect(r.porS).toHaveLength(5);
    });
  });
});
