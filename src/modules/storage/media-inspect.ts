/**
 * Utilidades puras para validar evidencia multimedia en el servidor.
 * No dependen de S3: reciben los bytes y devuelven lo que el archivo realmente es.
 */

export type EvidenceKind = 'IMAGEN' | 'VIDEO' | 'DOCUMENTO';

/** Reglas de evidencia de maquinaria (incidencias y mantenimientos). */
export const EVIDENCE_RULES = {
  IMAGEN: { maxBytes: 10 * 1024 * 1024 },
  VIDEO: { maxBytes: 100 * 1024 * 1024, minSeconds: 13, maxSeconds: 30 },
  DOCUMENTO: { maxBytes: 10 * 1024 * 1024 },
  /** Tolerancia por redondeo del contenedor (p. ej. 12.98 s grabados como "13 s"). */
  durationToleranceSeconds: 0.5,
} as const;

/** Detecta el tipo real del archivo por sus primeros bytes (magic bytes). */
export function detectKind(head: Uint8Array): { kind: EvidenceKind; mime: string } | null {
  const b = head;
  const ascii = (from: number, to: number) => String.fromCharCode(...Array.from(b.slice(from, to)));

  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { kind: 'IMAGEN', mime: 'image/jpeg' };
  }
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 4) === 'PNG') {
    return { kind: 'IMAGEN', mime: 'image/png' };
  }
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    return { kind: 'IMAGEN', mime: 'image/webp' };
  }
  if (b.length >= 5 && ascii(0, 5) === '%PDF-') {
    return { kind: 'DOCUMENTO', mime: 'application/pdf' };
  }
  if (b.length >= 12 && ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (brand === 'qt  ') return { kind: 'VIDEO', mime: 'video/quicktime' };
    if (brand === 'M4V ' || brand === 'M4VH' || brand === 'M4VP') return { kind: 'VIDEO', mime: 'video/x-m4v' };
    if (/^(heic|heix|hevc|hevx|mif1|msf1|avif)/.test(brand)) return null; // imagen HEIC/AVIF: no se acepta
    return { kind: 'VIDEO', mime: 'video/mp4' };
  }
  return null;
}

export interface Mp4Box {
  type: string;
  /** Posición del inicio de la caja (cabecera incluida). */
  start: number;
  /** Tamaño total de la caja; hasta el final del archivo si `toEnd`. */
  size: number;
  headerSize: number;
  toEnd: boolean;
}

/** Lee la cabecera de una caja ISO-BMFF que empieza en `offset` dentro de `buf`. */
export function readBoxHeader(buf: Uint8Array, offset: number, baseOffset = 0): Mp4Box | null {
  if (offset + 8 > buf.length) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let size = view.getUint32(offset);
  const type = String.fromCharCode(buf[offset + 4], buf[offset + 5], buf[offset + 6], buf[offset + 7]);
  let headerSize = 8;
  let toEnd = false;
  if (size === 1) {
    if (offset + 16 > buf.length) return null;
    size = Number(view.getBigUint64(offset + 8));
    headerSize = 16;
  } else if (size === 0) {
    toEnd = true;
  }
  if (!toEnd && size < headerSize) return null;
  return { type, start: baseOffset + offset, size, headerSize, toEnd };
}

/**
 * Recibe el contenido completo de la caja `moov` (cabecera incluida) y devuelve la duración
 * en segundos según `mvhd`, o null si no se puede leer.
 */
export function parseMoovDurationSeconds(moov: Uint8Array): number | null {
  const outer = readBoxHeader(moov, 0);
  if (!outer || outer.type !== 'moov') return null;
  const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);

  let pos = outer.headerSize;
  while (pos + 8 <= moov.length) {
    const box = readBoxHeader(moov, pos);
    if (!box) return null;
    const size = box.toEnd ? moov.length - pos : box.size;
    if (box.type === 'mvhd') {
      const p = pos + box.headerSize; // payload
      const version = moov[p];
      let timescale: number;
      let duration: number;
      if (version === 1) {
        if (p + 32 > moov.length) return null;
        timescale = view.getUint32(p + 20);
        duration = Number(view.getBigUint64(p + 24));
      } else {
        if (p + 20 > moov.length) return null;
        timescale = view.getUint32(p + 12);
        duration = view.getUint32(p + 16);
      }
      if (!timescale) return null;
      return duration / timescale;
    }
    if (size < 8) return null;
    pos += size;
  }
  return null;
}

/** Valida el rango de duración de un video de evidencia (13–30 s con tolerancia). */
export function videoDurationError(seconds: number | null | undefined): string | null {
  const { minSeconds, maxSeconds } = EVIDENCE_RULES.VIDEO;
  const tol = EVIDENCE_RULES.durationToleranceSeconds;
  if (seconds == null || !Number.isFinite(seconds)) {
    return 'No se pudo leer la duración del video.';
  }
  if (seconds < minSeconds - tol || seconds > maxSeconds + tol) {
    return `El video debe durar entre ${minSeconds} y ${maxSeconds} segundos (dura ${seconds.toFixed(1)} s).`;
  }
  return null;
}
