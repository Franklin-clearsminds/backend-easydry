import { describe, expect, it } from 'vitest';
import { detectKind, parseMoovDurationSeconds, readBoxHeader, videoDurationError } from './media-inspect.js';

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => Array.from(text).map((c) => c.charCodeAt(0));

/** Construye una caja ISO-BMFF con el tipo y el payload dados. */
function box(type: string, payload: number[]): number[] {
  const size = 8 + payload.length;
  return [(size >>> 24) & 255, (size >>> 16) & 255, (size >>> 8) & 255, size & 255, ...ascii(type), ...payload];
}

/** mvhd versión 0 con timescale y duración dados. */
function mvhdV0(timescale: number, duration: number): number[] {
  const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  return box('mvhd', [0, 0, 0, 0, ...u32(0), ...u32(0), ...u32(timescale), ...u32(duration), ...Array.from({ length: 80 }, () => 0)]);
}

describe('detectKind', () => {
  it('reconoce imágenes, PDF y videos por su contenido y no por la extensión', () => {
    expect(detectKind(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0))).toEqual({ kind: 'IMAGEN', mime: 'image/jpeg' });
    expect(detectKind(bytes(0x89, ...ascii('PNG'), 0x0d, 0x0a, 0x1a, 0x0a))).toEqual({ kind: 'IMAGEN', mime: 'image/png' });
    expect(detectKind(bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')))).toEqual({ kind: 'IMAGEN', mime: 'image/webp' });
    expect(detectKind(bytes(...ascii('%PDF-1.7')))).toEqual({ kind: 'DOCUMENTO', mime: 'application/pdf' });
    expect(detectKind(bytes(0, 0, 0, 24, ...ascii('ftypmp42')))).toEqual({ kind: 'VIDEO', mime: 'video/mp4' });
    expect(detectKind(bytes(0, 0, 0, 20, ...ascii('ftypqt  ')))).toEqual({ kind: 'VIDEO', mime: 'video/quicktime' });
  });

  it('rechaza formatos no permitidos (ejecutables, HEIC, texto)', () => {
    expect(detectKind(bytes(0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0))).toBeNull();
    expect(detectKind(bytes(0, 0, 0, 24, ...ascii('ftypheic')))).toBeNull();
    expect(detectKind(bytes(...ascii('hola mundo, esto no es un archivo')))).toBeNull();
    expect(detectKind(bytes())).toBeNull();
  });
});

describe('duración de video', () => {
  it('lee la duración desde mvhd dentro de moov', () => {
    const moov = new Uint8Array(box('moov', mvhdV0(1000, 22_500)));
    expect(parseMoovDurationSeconds(moov)).toBeCloseTo(22.5, 3);
  });

  it('devuelve null si no es moov o no trae mvhd', () => {
    expect(parseMoovDurationSeconds(new Uint8Array(box('free', [0, 0])))).toBeNull();
    expect(parseMoovDurationSeconds(new Uint8Array(box('moov', box('trak', [0, 0, 0, 0]))))).toBeNull();
  });

  it('lee cabeceras de caja, incluida la de tamaño extendido', () => {
    const normal = readBoxHeader(new Uint8Array(box('ftyp', [1, 2, 3, 4])), 0, 100);
    expect(normal).toMatchObject({ type: 'ftyp', start: 100, size: 12, headerSize: 8 });
    const extendida = new Uint8Array([0, 0, 0, 1, ...ascii('mdat'), 0, 0, 0, 0, 0, 0, 0, 24]);
    expect(readBoxHeader(extendida, 0)).toMatchObject({ type: 'mdat', size: 24, headerSize: 16 });
  });

  it('acepta de 13 a 30 segundos (con tolerancia) y rechaza el resto', () => {
    expect(videoDurationError(13)).toBeNull();
    expect(videoDurationError(22)).toBeNull();
    expect(videoDurationError(30)).toBeNull();
    expect(videoDurationError(12.8)).toBeNull();
    expect(videoDurationError(12)).toMatch(/entre 13 y 30/);
    expect(videoDurationError(31)).toMatch(/entre 13 y 30/);
    expect(videoDurationError(null)).toMatch(/No se pudo leer/);
  });
});
