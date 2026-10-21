import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectsCommand,
  GetBucketLocationCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  detectKind,
  EVIDENCE_RULES,
  parseMoovDurationSeconds,
  readBoxHeader,
  videoDurationError,
  type EvidenceKind,
} from './media-inspect.js';

import { resolverAlcance } from '../../common/permisos/alcance.js';
import { rolDeUsuario } from '../../common/permisos/alias-roles.js';
/** Resultado de verificar un archivo ya subido a S3. */
export interface InspectedEvidence {
  key: string;
  kind: EvidenceKind;
  mimeType: string;
  sizeBytes: number;
  /** Solo videos. */
  durationSeconds?: number;
}

export type StorageCategory =
  | 'SERVICIOS_GENERALES'
  | 'SERVICIOS_ESPECIALES'
  | 'MAQUINARIA_IMAGEN'
  | 'MAQUINARIA_FICHA'
  | 'MAQUINARIA_INCIDENTE'
  | 'MAQUINARIA_MANTENIMIENTO'
  | 'MAQUINARIA_LIMPIEZA'
  | 'DOCUMENTO'
  | 'CATALOGO_INSUMOS'
  | 'INVENTARIO_ENVIOS'
  | 'AUDITORIAS'
  | 'PERFIL_USUARIO';

export type MediaEvidenceType =
  | 'FOTO_INGRESO'
  | 'FOTO_SALIDA'
  | 'FOTO_DANO_PREVIO'
  | 'FOTO_PROCESO'
  | 'VIDEO_INSPECCION'
  | 'VIDEO_INICIAL'
  | 'VIDEO_FINAL'
  | 'VIDEO_PAUSA'
  | 'VIDEO_REANUDAR'
  | 'FOTO_MAQUINA'
  | 'FOTO_LIMPIEZA'
  | 'FICHA_TECNICA'
  | 'DOCUMENTO'
  | 'FOTO_INCIDENTE'
  | 'VIDEO_INCIDENTE'
  | 'DOCUMENTO_INCIDENTE'
  | 'PDF_CIERRE'
  | 'IMAGEN_PRODUCTO'
  | 'FOTO_AJUSTE_INVENTARIO'
  | 'FOTO_INGRESO_INVENTARIO'
  | 'FOTO_ENVIO'
  | 'FOTO_AUDITORIA'
  | 'FOTO_PERFIL';

export interface GenerateUploadTicketDto {
  clientUuid?: string;
  userId?: string;
  agenciaId?: string;
  servicioId?: string;
  maquinariaId?: string;
  maquinariaNombre?: string;
  maquinariaCodigo?: string;
  incidenteId?: string;
  /** 'reporte' | 'reparacion' (también se aceptan los alias antiguos 'fallas' | 'resoluciones'). */
  incidenteFase?: 'reporte' | 'reparacion' | 'fallas' | 'resoluciones';
  mantenimientoId?: string;
  insumoId?: string;
  insumoNombre?: string;
  /** Evidencias de envíos: número de guía y etapa ('recepcion' | 'rechazo' | 'resolucion'). */
  envioGuia?: string;
  envioEtapa?: 'recepcion' | 'rechazo' | 'resolucion';
  /** Evidencias de auditorías: el módulo ('informes' o '5s') y el informe o auditoría al que pertenecen (si aún no existe, se guarda como «borrador»). */
  auditoriaTipo?: 'informes' | '5s';
  auditoriaId?: string;
  category?: StorageCategory;
  type: MediaEvidenceType;
  fileName?: string;
  contentType?: string;
}

export interface UploadTicketResponse {
  ticketId: string;
  clientUuid?: string;
  type: string;
  key: string;
  uploadUrl: string;
  publicUrl: string;
  driver: 's3';
  expiresInSeconds: number;
  headers: Record<string, string>;
}

const ALLOWED_TYPES = new Set<MediaEvidenceType>([
  'FOTO_INGRESO',
  'FOTO_SALIDA',
  'FOTO_DANO_PREVIO',
  'FOTO_PROCESO',
  'VIDEO_INSPECCION',
  'VIDEO_INICIAL',
  'VIDEO_FINAL',
  'VIDEO_PAUSA',
  'VIDEO_REANUDAR',
  'FOTO_MAQUINA',
  'FOTO_LIMPIEZA',
  'FICHA_TECNICA',
  'DOCUMENTO',
  'FOTO_INCIDENTE',
  'VIDEO_INCIDENTE',
  'DOCUMENTO_INCIDENTE',
  'PDF_CIERRE',
  'IMAGEN_PRODUCTO',
  'FOTO_AJUSTE_INVENTARIO',
  'FOTO_INGRESO_INVENTARIO',
  'FOTO_ENVIO',
  'FOTO_AUDITORIA',
  'FOTO_PERFIL',
]);

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private s3Client: S3Client;
  private readonly bucketName: string;
  private region: string;
  private publicUrlPrefix: string;
  private regionResolved = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma?: PrismaService,
  ) {
    this.region = this.configService.get<string>('AWS_REGION')?.trim() || '';
    this.bucketName =
      this.configService.get<string>('AWS_S3_BUCKET_NAME')?.trim() || '';
    if (!this.region || !this.bucketName) {
      throw new Error(
        'AWS_REGION y AWS_S3_BUCKET_NAME son obligatorios. EasyDry no admite almacenamiento local.',
      );
    }
    this.publicUrlPrefix =
      this.configService.get<string>('AWS_S3_PUBLIC_URL_PREFIX') ||
      `https://${this.bucketName}.s3.${this.region}.amazonaws.com`;
    const accessKeyId = (
      this.configService.get<string>('AWS_ACCESS_KEY_ID') ?? ''
    ).trim();
    const secretAccessKey = (
      this.configService.get<string>('AWS_SECRET_ACCESS_KEY') ?? ''
    ).trim();
    if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
      throw new Error(
        'AWS_ACCESS_KEY_ID y AWS_SECRET_ACCESS_KEY deben configurarse juntos.',
      );
    }

    const endpoint =
      this.configService.get<string>('AWS_ENDPOINT')?.trim() ||
      this.configService.get<string>('AWS_S3_ENDPOINT')?.trim();
    this.s3Client = this.createS3Client(
      this.region,
      accessKeyId,
      secretAccessKey,
      endpoint,
    );
  }

  async asegurarPuedeSubirEvidenciaEspecial(
    serviceId: string | undefined,
    actor: any,
  ): Promise<void> {
    if (rolDeUsuario(actor) !== 'PULIDOR') return;
    if (!serviceId || !this.prisma) {
      throw new ForbiddenException(
        'Solo el pulidor responsable puede subir evidencias de esta orden.',
      );
    }
    const servicio = await this.prisma.servicioEspecial.findFirst({
      where: {
        OR: [
          { id: serviceId },
          { clientUuid: serviceId },
          { codigoSE: { equals: serviceId, mode: 'insensitive' } },
          { ordenTrabajoOT: { equals: serviceId, mode: 'insensitive' } },
        ],
      },
      select: { operadorId: true },
    });
    if (!servicio || servicio.operadorId !== actor.id) {
      throw new ForbiddenException(
        'Solo el primer pulidor asignado puede subir evidencias de esta orden.',
      );
    }
  }

  private createS3Client(
    region: string,
    accessKeyId = (
      this.configService.get<string>('AWS_ACCESS_KEY_ID') ?? ''
    ).trim(),
    secretAccessKey = (
      this.configService.get<string>('AWS_SECRET_ACCESS_KEY') ?? ''
    ).trim(),
    endpoint = this.configService.get<string>('AWS_ENDPOINT')?.trim() ||
      this.configService.get<string>('AWS_S3_ENDPOINT')?.trim(),
  ): S3Client {
    return new S3Client({
      region,
      followRegionRedirects: true,
      ...(accessKeyId && secretAccessKey
        ? { credentials: { accessKeyId, secretAccessKey } }
        : {}),
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
  }

  private bucketRegionFromError(error: unknown): string | null {
    const err = error as {
      $metadata?: { httpStatusCode?: number };
      $response?: { headers?: Record<string, string> };
      BucketRegion?: string;
      cause?: {
        $metadata?: { httpStatusCode?: number };
        $response?: { headers?: Record<string, string> };
        BucketRegion?: string;
      };
    };
    const headers =
      err?.$response?.headers || err?.cause?.$response?.headers || {};
    const region = (
      headers['x-amz-bucket-region'] ||
      headers['X-Amz-Bucket-Region'] ||
      err?.BucketRegion ||
      err?.cause?.BucketRegion ||
      ''
    ).trim();
    return region || null;
  }

  private applyBucketRegion(actualRegion: string): void {
    const region = actualRegion.trim() || 'us-east-1';
    if (region === this.region) return;
    this.logger.warn(
      `El bucket ${this.bucketName} está en ${region}, no en ${this.region}. Recreando el cliente S3.`,
    );
    this.region = region;
    this.publicUrlPrefix = `https://${this.bucketName}.s3.${this.region}.amazonaws.com`;
    this.s3Client.destroy();
    this.s3Client = this.createS3Client(this.region);
  }

  private async ensureBucketRegion(): Promise<void> {
    if (this.regionResolved) return;
    try {
      const loc = await this.s3Client.send(
        new GetBucketLocationCommand({ Bucket: this.bucketName }),
      );
      this.applyBucketRegion(loc.LocationConstraint || 'us-east-1');
      this.regionResolved = true;
    } catch (error) {
      const redirected = this.bucketRegionFromError(error);
      if (redirected) {
        this.applyBucketRegion(redirected);
        this.regionResolved = true;
      }
    }
  }

  async onModuleInit(): Promise<void> {
    await this.ensureBucketRegion();
    try {
      await this.s3Client.send(
        new HeadBucketCommand({ Bucket: this.bucketName }),
      );
      this.logger.log(`S3 verificado: ${this.bucketName} (${this.region})`);
      return;
    } catch (error) {
      const redirectedRegion = this.bucketRegionFromError(error);
      if (redirectedRegion && redirectedRegion !== this.region) {
        this.logger.warn(
          `El bucket ${this.bucketName} está en ${redirectedRegion}, no en ${this.region}. Recreando el cliente S3.`,
        );
        this.region = redirectedRegion;
        this.publicUrlPrefix =
          this.configService.get<string>('AWS_S3_PUBLIC_URL_PREFIX') ||
          `https://${this.bucketName}.s3.${this.region}.amazonaws.com`;
        this.s3Client.destroy();
        this.s3Client = this.createS3Client(this.region);
        try {
          await this.s3Client.send(
            new HeadBucketCommand({ Bucket: this.bucketName }),
          );
          this.logger.log(`S3 verificado: ${this.bucketName} (${this.region})`);
          return;
        } catch (retryError) {
          this.logger.error(
            `S3 sigue sin responder en ${this.region}. El API arranca; las subidas se reintentarán al usarse.`,
            retryError instanceof Error ? retryError.message : retryError,
          );
          return;
        }
      }

      this.logger.error(
        `No se pudo verificar el bucket S3 ${this.bucketName} (${this.region}). El API arranca igual.`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  public async buildS3Key(
    dto: GenerateUploadTicketDto,
  ): Promise<{ key: string; contentType: string }> {
    const type = String(dto.type || '').toUpperCase() as MediaEvidenceType;
    if (!ALLOWED_TYPES.has(type)) {
      throw new BadRequestException(
        `Tipo de evidencia no soportado: ${dto.type}`,
      );
    }

    const category = dto.category || this.defaultCategory(type);
    this.assertCategorySupportsType(category, type);

    // ── Resolución del nombre real de la agencia ──────────────────────────
    // El frontend puede enviar un UUID, un nombre de agencia, o un código.
    // Intentamos resolver el nombre real desde BD para usar como slug de carpeta S3.
    const agencia = await this.resolveAgenciaSlug(dto.agenciaId);

    const serviceId = this.safeSegment(
      dto.servicioId || dto.clientUuid,
      'sin-orden',
    );
    const incidenteId = this.safeSegment(
      dto.incidenteId || dto.clientUuid,
      'sin-incidente',
    );
    const uuid = crypto.randomUUID().slice(0, 8);
    const timestamp = Date.now();
    const isVideo = type.startsWith('VIDEO_');
    const isDocument =
      type === 'DOCUMENTO' ||
      type === 'DOCUMENTO_INCIDENTE' ||
      type === 'PDF_CIERRE';
    const requestedExtension = String(dto.fileName || '')
      .toLowerCase()
      .match(/\.([a-z0-9]+)$/)?.[1];
    const videoExtension =
      requestedExtension === 'mov' || requestedExtension === 'm4v'
        ? requestedExtension
        : 'mp4';
    const imageExt =
      requestedExtension === 'png' ||
      requestedExtension === 'webp' ||
      requestedExtension === 'jpeg'
        ? requestedExtension === 'jpeg'
          ? 'jpg'
          : requestedExtension
        : 'jpg';
    const ext = isVideo ? videoExtension : isDocument ? 'pdf' : imageExt;
    const contentType = isVideo
      ? videoExtension === 'mov'
        ? 'video/quicktime'
        : videoExtension === 'm4v'
          ? 'video/x-m4v'
          : 'video/mp4'
      : isDocument
        ? 'application/pdf'
        : ext === 'png'
          ? 'image/png'
          : ext === 'webp'
            ? 'image/webp'
            : 'image/jpeg';
    const filename = `${timestamp}_${type.toLowerCase()}_${uuid}.${ext}`;

    let key: string;
    if (category === 'PERFIL_USUARIO' || type === 'FOTO_PERFIL') {
      const userId = this.profileUserId(dto.userId || dto.clientUuid);
      return {
        key: `usuarios/${userId}/perfil/avatar.jpg`,
        contentType: 'image/jpeg',
      };
    } else if (category === 'AUDITORIAS' || type === 'FOTO_AUDITORIA') {
      // Evidencias de informes de inspección y de auditorías 5S: agencias/{agencia}/auditorias/{informes|5s}/{id}/
      const modulo = dto.auditoriaTipo === '5s' ? '5s' : 'informes';
      const referencia = this.safeSegment(dto.auditoriaId, 'borrador');
      key = `agencias/${agencia}/auditorias/${modulo}/${referencia}/${filename}`;
    } else if (type === 'FOTO_ENVIO') {
      // Todo lo de un envío vive junto, sin importar el origen o el destino: inventario/envios/{guia}/{etapa}/
      const guia = this.safeSegment(dto.envioGuia, 'sin-guia');
      const etapa = ['recepcion', 'rechazo', 'resolucion'].includes(String(dto.envioEtapa)) ? dto.envioEtapa : 'recepcion';
      key = `inventario/envios/${guia}/${etapa}/${filename}`;
    } else if (
      type === 'FOTO_AJUSTE_INVENTARIO' ||
      type === 'FOTO_INGRESO_INVENTARIO'
    ) {
      const insumoSlug = this.safeSegment(
        dto.insumoNombre || dto.insumoId,
        'insumo',
      );
      const agenciaSeg =
        agencia || this.safeSegment(dto.agenciaId || dto.servicioId, 'bodega');
      const folder =
        type === 'FOTO_INGRESO_INVENTARIO' ? 'ingresos' : 'reajustes';
      key = `agencias/${agenciaSeg}/inventario/${folder}/${insumoSlug}/${filename}`;
    } else if (category === 'CATALOGO_INSUMOS' || type === 'IMAGEN_PRODUCTO') {
      let rawInsumoName = dto.insumoNombre || '';
      const candidateId = dto.insumoId || dto.clientUuid || '';

      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          candidateId,
        );
      if (!rawInsumoName && isUuid && this.prisma) {
        try {
          const insumoDb = await this.prisma.insumo.findUnique({
            where: { id: candidateId },
            select: { nombre: true, codigoSKU: true },
          });
          if (insumoDb?.nombre) {
            rawInsumoName = insumoDb.nombre;
          }
        } catch {
          // fallback
        }
      }

      if (!rawInsumoName) {
        rawInsumoName = candidateId || 'insumo';
      }

      const insumoSlug = this.safeSegment(rawInsumoName, 'insumo');
      const finalImageFilename = `${insumoSlug}.${ext}`;
      key = `catalogo/insumos/${insumoSlug}/${finalImageFilename}`;
    } else if (
      category === 'SERVICIOS_GENERALES' ||
      category === 'SERVICIOS_ESPECIALES'
    ) {
      const serviceKind =
        category === 'SERVICIOS_GENERALES' ? 'generales' : 'especiales';
      const folder =
        type === 'VIDEO_INICIAL'
          ? 'videos/inicial'
          : type === 'VIDEO_FINAL'
            ? 'videos/final'
            : type === 'VIDEO_PAUSA'
              ? 'videos/pausas'
              : type === 'VIDEO_REANUDAR'
                ? 'videos/reanudaciones'
                : isVideo
                  ? 'videos'
                  : isDocument
                    ? 'documentos'
                    : 'fotos';
      key = `agencias/${agencia}/servicios/${serviceKind}/${serviceId}/${folder}/${filename}`;
    } else if (
      category === 'MAQUINARIA_IMAGEN' ||
      category === 'MAQUINARIA_FICHA' ||
      category === 'MAQUINARIA_INCIDENTE' ||
      category === 'MAQUINARIA_MANTENIMIENTO' ||
      category === 'MAQUINARIA_LIMPIEZA' ||
      type === 'FOTO_MAQUINA' ||
      type === 'FICHA_TECNICA' ||
      type === 'FOTO_LIMPIEZA'
    ) {
      // Estructura fuera de las agencias: la carpeta usa el código de la máquina, que no cambia
      // aunque la máquina se mueva. La agencia/bahía actual vive solo en la base de datos.
      const equipo = await this.resolveMaquinariaSlug(dto);
      const folder = isDocument ? 'documento' : 'multimedia';
      const stamp = new Date()
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\..*$/, '')
        .replace('T', '-');
      const maquinariaFilename = `${stamp}_${type.toLowerCase()}_${uuid}.${ext}`;
      if (category === 'MAQUINARIA_IMAGEN' || type === 'FOTO_MAQUINA') {
        key = `maquinaria/${equipo}/perfil/foto/${maquinariaFilename}`;
      } else if (category === 'MAQUINARIA_FICHA' || type === 'FICHA_TECNICA') {
        key = `maquinaria/${equipo}/perfil/ficha-tecnica/${maquinariaFilename}`;
      } else if (category === 'MAQUINARIA_MANTENIMIENTO') {
        const mantId = this.safeSegment(
          dto.mantenimientoId || dto.clientUuid,
          'sin-id',
        );
        key = `maquinaria/${equipo}/mantenimientos/${mantId}/${folder}/${maquinariaFilename}`;
      } else if (
        category === 'MAQUINARIA_LIMPIEZA' ||
        type === 'FOTO_LIMPIEZA'
      ) {
        const diaUtc = new Date().toISOString().slice(0, 10);
        key = `maquinaria/${equipo}/limpiezas/${diaUtc}/${maquinariaFilename}`;
      } else {
        const fase = this.incidenteFase(dto);
        key = `maquinaria/${equipo}/incidentes/${incidenteId}/${fase}/${folder}/${maquinariaFilename}`;
      }
    } else {
      const now = new Date();
      key = `agencias/${agencia}/documentos/cierres/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${filename}`;
    }

    return { key, contentType };
  }

  /**
   * Resuelve el agenciaId en un slug legible para usar en rutas S3.
   * Prioridad:
   *  1. Si es UUID → busca el nombre real en BD → slugifica
   *  2. Si es texto (nombre o código) → slugifica directamente
   *  3. Fallback → 'agencia-general'
   */
  /**
   * Segmento de la agencia en la ruta de S3: su ID (inmutable, sin tildes). El nombre vive en PostgreSQL.
   * Si llega un código o nombre en vez del ID, se busca la agencia para obtener su ID.
   */
  private async resolveAgenciaSlug(agenciaId?: string): Promise<string> {
    if (!agenciaId || !agenciaId.trim()) return 'agencia-general';

    const raw = agenciaId.trim();
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        raw,
      );
    if (isUuid) return raw.toLowerCase();

    if (this.prisma) {
      try {
        const agencia = await this.prisma.agencia.findFirst({
          where: { OR: [{ codigo: raw }, { nombre: raw }] },
          select: { id: true },
        });
        if (agencia?.id) return agencia.id.toLowerCase();
      } catch {
        // sin resolver: se usa la carpeta general
      }
    }
    return 'agencia-general';
  }

  /** 'reporte' (lo sube quien reporta) o 'reparacion' (lo sube quien repara). */
  private incidenteFase(
    dto: GenerateUploadTicketDto,
  ): 'reporte' | 'reparacion' {
    const raw = String(dto.incidenteFase || '')
      .trim()
      .toLowerCase();
    if (
      raw === 'resoluciones' ||
      raw === 'resolucion' ||
      raw === 'reparacion' ||
      raw === 'solucion'
    ) {
      return 'reparacion';
    }
    return 'reporte';
  }

  /**
   * Carpeta estable del equipo, independiente de la agencia.
   * Prioridad: código → BD (si llega UUID) → nombre → id.
   */
  private async resolveMaquinariaSlug(
    dto: GenerateUploadTicketDto,
  ): Promise<string> {
    const codigo = String(dto.maquinariaCodigo || '').trim();
    if (codigo) return this.safeSegment(codigo, 'equipo');

    const candidateId = String(dto.maquinariaId || '').trim();
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        candidateId,
      );
    if (isUuid && this.prisma) {
      try {
        const maquina = await this.prisma.maquinaria.findUnique({
          where: { id: candidateId },
          select: { codigo: true, nombre: true },
        });
        if (maquina?.codigo) return this.safeSegment(maquina.codigo, 'equipo');
        if (maquina?.nombre) return this.safeSegment(maquina.nombre, 'equipo');
      } catch {
        // fallback
      }
    }

    const nombre = String(
      dto.maquinariaNombre || dto.insumoNombre || '',
    ).trim();
    if (nombre) return this.safeSegment(nombre, 'equipo');
    if (candidateId) return this.safeSegment(candidateId, 'equipo');
    return 'equipo';
  }

  public async generateUploadTicket(
    dto: GenerateUploadTicketDto,
  ): Promise<UploadTicketResponse> {
    await this.ensureBucketRegion();
    const type = String(dto.type || '').toUpperCase();
    if (type === 'FOTO_PERFIL' || dto.category === 'PERFIL_USUARIO') {
      await this.deleteUserProfileImages(dto.userId || dto.clientUuid);
    }

    const { key, contentType } = await this.buildS3Key({
      ...dto,
      ...(type === 'FOTO_PERFIL' || dto.category === 'PERFIL_USUARIO'
        ? { fileName: 'avatar.jpg', contentType: 'image/jpeg' }
        : {}),
    });
    const expiresInSeconds = 900;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(this.s3Client, command, {
      expiresIn: expiresInSeconds,
    });
    return this.ticketResponse(
      dto,
      key,
      uploadUrl,
      `${this.publicUrlPrefix.replace(/\/$/, '')}/${key}`,
      contentType,
      expiresInSeconds,
      {},
    );
  }

  public async uploadObject(
    dto: GenerateUploadTicketDto,
    body: Buffer,
    contentType?: string,
  ): Promise<{ key: string; publicUrl: string }> {
    await this.ensureBucketRegion();
    const built = await this.buildS3Key({
      ...dto,
      contentType: contentType || dto.contentType,
    });
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: built.key,
        Body: body,
        ContentType: contentType || built.contentType,
      }),
    );
    if (
      String(contentType || built.contentType || '')
        .toLowerCase()
        .startsWith('image/')
    ) {
      void this.generarMiniaturaDesdeBuffer(built.key, body);
    }
    return {
      key: built.key,
      publicUrl: `${this.publicUrlPrefix.replace(/\/$/, '')}/${built.key}`,
    };
  }

  /** Carpeta raíz de una máquina en S3 (por código, independiente de la agencia). */
  public maquinariaPrefix(codigo: string): string {
    return `maquinaria/${this.safeSegment(codigo, 'equipo')}/`;
  }

  /** Extrae la clave S3 de una URL pública administrada por este servicio (o de una clave cruda). */
  public keyFromUrl(rawUrl: string): string | null {
    const url = String(rawUrl || '').trim();
    if (!url) return null;
    const prefix = this.publicUrlPrefix.replace(/\/$/, '');
    let key: string | null = null;
    if (url.startsWith(`${prefix}/`)) {
      key = url.slice(prefix.length + 1);
    } else if (url.includes('/storage/file?key=')) {
      key = url.split('/storage/file?key=')[1] || null;
    } else if (!/^[a-z]+:\/\//i.test(url)) {
      key = url;
    }
    if (!key) return null;
    try {
      return decodeURIComponent(key.split('?')[0]).replace(/^[/\\]+/, '');
    } catch {
      return null;
    }
  }

  private async readRange(
    key: string,
    start: number,
    endInclusive: number,
  ): Promise<Uint8Array> {
    const res = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Range: `bytes=${start}-${endInclusive}`,
      }),
    );
    return (await res.Body?.transformToByteArray()) ?? new Uint8Array();
  }

  /** Busca la caja moov recorriendo las cajas de primer nivel sin descargar el video completo. */
  private async readVideoDurationSeconds(
    key: string,
    size: number,
  ): Promise<number | null> {
    const MAX_MOOV_BYTES = 8 * 1024 * 1024;
    let offset = 0;
    for (let i = 0; i < 64 && offset + 8 <= size; i++) {
      const head = await this.readRange(
        key,
        offset,
        Math.min(offset + 15, size - 1),
      );
      const box = readBoxHeader(head, 0, offset);
      if (!box) return null;
      const total = box.toEnd ? size - offset : box.size;
      if (box.type === 'moov') {
        if (total > MAX_MOOV_BYTES) return null;
        const moov = await this.readRange(key, offset, offset + total - 1);
        return parseMoovDurationSeconds(moov);
      }
      if (total < 8) return null;
      offset += total;
    }
    return null;
  }

  /**
   * Verifica en S3 que el archivo exista y sea realmente lo que dice ser: tipo real por magic bytes,
   * tamaño según el tipo y, en videos, duración de 13 a 30 s. Lanza BadRequestException si no cumple.
   */
  public async inspectEvidence(
    rawUrl: string,
    expected?: { prefix: string },
  ): Promise<InspectedEvidence> {
    await this.ensureBucketRegion();
    const key = this.keyFromUrl(rawUrl);
    if (!key)
      throw new BadRequestException(
        'La URL de la evidencia no pertenece al almacenamiento de EasyDry.',
      );
    if (expected && !key.startsWith(expected.prefix)) {
      throw new BadRequestException(
        'La evidencia no pertenece a la carpeta de esta máquina.',
      );
    }

    let size = 0;
    try {
      const head = await this.s3Client.send(
        new HeadObjectCommand({ Bucket: this.bucketName, Key: key }),
      );
      size = Number(head.ContentLength || 0);
    } catch {
      throw new BadRequestException(
        'La evidencia no existe en el almacenamiento. Súbela de nuevo.',
      );
    }
    if (size <= 0) throw new BadRequestException('La evidencia está vacía.');

    const detected = detectKind(
      await this.readRange(key, 0, Math.min(size, 32) - 1),
    );
    if (!detected) {
      throw new BadRequestException(
        'Formato no permitido. Usa JPG, PNG, WEBP, MP4/MOV o PDF.',
      );
    }
    const maxBytes = EVIDENCE_RULES[detected.kind].maxBytes;
    if (size > maxBytes) {
      throw new BadRequestException(
        `El archivo pesa ${(size / 1024 / 1024).toFixed(1)} MB y el máximo para ${detected.kind.toLowerCase()} es ${maxBytes / 1024 / 1024} MB.`,
      );
    }

    let durationSeconds: number | undefined;
    if (detected.kind === 'VIDEO') {
      const seconds = await this.readVideoDurationSeconds(key, size);
      const error = videoDurationError(seconds);
      if (error) throw new BadRequestException(error);
      durationSeconds = Math.round((seconds as number) * 100) / 100;
    }

    return {
      key,
      kind: detected.kind,
      mimeType: detected.mime,
      sizeBytes: size,
      durationSeconds,
    };
  }

  public async getPresignedDownloadUrl(
    rawKey: string,
    expiresInSeconds = 3600,
  ): Promise<string> {
    await this.ensureBucketRegion();
    let key = String(rawKey || '').trim();
    if (key.includes('amazonaws.com/')) {
      key = key.split('amazonaws.com/')[1] || key;
    } else if (key.startsWith('/uploads/')) {
      key = key.replace(/^\/uploads\//, '');
    } else if (key.startsWith('uploads/')) {
      key = key.replace(/^uploads\//, '');
    }
    const normalizedKey = key.replace(/^[/\\]+/, '').replace(/\\/g, '/');
    if (!normalizedKey)
      throw new BadRequestException('La clave del archivo es obligatoria.');

    const isMp4 = normalizedKey.toLowerCase().endsWith('.mp4');
    const isWebm = normalizedKey.toLowerCase().endsWith('.webm');
    const overrideContentType = isMp4
      ? 'video/mp4'
      : isWebm
        ? 'video/webm'
        : undefined;

    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: normalizedKey,
      ...(overrideContentType
        ? { ResponseContentType: overrideContentType }
        : {}),
    });

    return getSignedUrl(this.s3Client, command, {
      expiresIn: expiresInSeconds,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  MINIATURAS: cada foto tiene una copia liviana en `thumbs/<clave-original>.jpg`
  //  (480 px de ancho, JPEG). Los listados cargan la miniatura y la foto completa solo
  //  se descarga al abrirla. La ruta es determinística: no requiere columnas en la base.
  // ─────────────────────────────────────────────────────────────────────────

  private static readonly THUMB_WIDTH = 480;
  private static readonly IMAGE_KEY = /\.(jpe?g|png|webp|heic|heif)$/i;

  public thumbnailKeyFor(key: string): string {
    return `thumbs/${String(key)
      .replace(/^[/\\]+/, '')
      .replace(/\.[^./]+$/, '')}.jpg`;
  }

  private async escribirMiniatura(
    key: string,
    original: Buffer,
  ): Promise<void> {
    const thumb = await sharp(original, { failOn: 'none' })
      .rotate()
      .resize({ width: StorageService.THUMB_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 72, mozjpeg: true })
      .toBuffer();
    await this.ensureBucketRegion();
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: this.thumbnailKeyFor(key),
        Body: thumb,
        ContentType: 'image/jpeg',
      }),
    );
  }

  /** Genera la miniatura desde los bytes ya disponibles. Nunca lanza: una falla solo se registra. */
  public async generarMiniaturaDesdeBuffer(
    key: string,
    original: Buffer,
  ): Promise<void> {
    try {
      if (!StorageService.IMAGE_KEY.test(key) || key.startsWith('thumbs/'))
        return;
      await this.escribirMiniatura(key, original);
    } catch (error: unknown) {
      this.logger.warn(
        `No se pudo generar la miniatura de ${key}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /** Clave de la vista media (1600 px): `view/<clave-original>.jpg`. */
  public viewKeyFor(key: string): string {
    return `view/${String(key)
      .replace(/^[/\\]+/, '')
      .replace(/\.[^./]+$/, '')}.jpg`;
  }

  private static readonly VIEW_SIDE = 1600;

  /**
   * Vista media para el visor: la foto original de un celular o cámara puede pesar varios MB y tardar en
   * abrirse y moverse. Si el original ya es liviano no se genera y el visor usa el original.
   */
  private async escribirVistaMedia(
    key: string,
    original: Buffer,
  ): Promise<void> {
    const meta = await sharp(original, { failOn: 'none' }).metadata();
    const lado = Math.max(meta.width || 0, meta.height || 0);
    if (lado <= StorageService.VIEW_SIDE && original.length < 700_000) return;
    const vista = await sharp(original, { failOn: 'none' })
      .rotate()
      .resize({
        width: StorageService.VIEW_SIDE,
        height: StorageService.VIEW_SIDE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
    await this.ensureBucketRegion();
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: this.viewKeyFor(key),
        Body: vista,
        ContentType: 'image/jpeg',
      }),
    );
  }

  /**
   * Genera la miniatura y la vista media de una foto ya subida a S3 (descarga una sola vez).
   * Nunca lanza: una falla solo se registra y el cliente usa el original.
   */
  public async generarVariantes(fileUrl: string): Promise<void> {
    try {
      const key = this.keyFromUrl(fileUrl);
      if (
        !key ||
        !StorageService.IMAGE_KEY.test(key) ||
        key.startsWith('thumbs/') ||
        key.startsWith('view/')
      )
        return;
      await this.ensureBucketRegion();
      const object = await this.s3Client.send(
        new GetObjectCommand({ Bucket: this.bucketName, Key: key }),
      );
      const bytes = await object.Body?.transformToByteArray();
      if (!bytes) return;
      const original = Buffer.from(bytes);
      await this.escribirMiniatura(key, original);
      await this.escribirVistaMedia(key, original);
    } catch (error: unknown) {
      this.logger.warn(
        `No se pudieron generar las variantes de ${fileUrl}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /** Genera la miniatura de una foto que el cliente ya subió a S3 (descarga, reduce y guarda). Nunca lanza. */
  public async generarMiniaturaDesdeUrl(fileUrl: string): Promise<void> {
    try {
      const prefix = this.publicUrlPrefix.replace(/\/$/, '');
      const url = String(fileUrl || '').trim();
      if (!prefix || !url.startsWith(`${prefix}/`)) return;
      const key = decodeURIComponent(
        url.slice(prefix.length + 1).split('?')[0],
      );
      if (!StorageService.IMAGE_KEY.test(key) || key.startsWith('thumbs/'))
        return;

      await this.ensureBucketRegion();
      const object = await this.s3Client.send(
        new GetObjectCommand({ Bucket: this.bucketName, Key: key }),
      );
      const bytes = await object.Body?.transformToByteArray();
      if (!bytes) return;
      await this.escribirMiniatura(key, Buffer.from(bytes));
    } catch (error: unknown) {
      this.logger.warn(
        `No se pudo generar la miniatura de ${fileUrl}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  public getBucketName(): string {
    return this.bucketName;
  }

  public isManagedPublicUrl(rawUrl: string): boolean {
    const url = String(rawUrl || '').trim();
    const prefix = this.publicUrlPrefix.replace(/\/$/, '');
    return Boolean(prefix && url.startsWith(`${prefix}/`));
  }

  public profileObjectKey(userId?: string): string {
    return `usuarios/${this.profileUserId(userId)}/perfil/avatar.jpg`;
  }

  public async deleteUserProfileImages(userId?: string): Promise<void> {
    const prefix = `usuarios/${this.profileUserId(userId)}/perfil/`;
    try {
      const listed = await this.s3Client.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: prefix,
        }),
      );
      const objects = (listed.Contents || [])
        .map((item) => item.Key)
        .filter((key): key is string => Boolean(key));
      if (!objects.length) return;

      await this.s3Client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucketName,
          Delete: { Objects: objects.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      this.logger.log(
        `Avatar anterior eliminado: ${prefix} (${objects.length})`,
      );
    } catch (error) {
      this.logger.warn(
        `No se pudieron eliminar avatares previos en ${prefix}`,
        error as Error,
      );
    }
  }

  private ticketResponse(
    dto: GenerateUploadTicketDto,
    key: string,
    uploadUrl: string,
    publicUrl: string,
    contentType: string,
    expiresInSeconds: number,
    extraHeaders: Record<string, string> = {},
  ): UploadTicketResponse {
    return {
      ticketId: `tkt_s3_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      clientUuid: dto.clientUuid,
      type: dto.type,
      key,
      uploadUrl,
      publicUrl,
      driver: 's3',
      expiresInSeconds,
      headers: { 'Content-Type': contentType, ...extraHeaders },
    };
  }

  private profileUserId(value?: string): string {
    const raw = String(value || '')
      .trim()
      .toLowerCase();
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        raw,
      )
    ) {
      return raw;
    }
    return this.safeSegment(raw, 'usuario');
  }

  /**
   * ¿La carpeta de agencia de una llave (`agencias/<segmento>/…`) está dentro del alcance del usuario? El segmento es el nombre de la
   * agencia. País: cualquiera; región: las agencias de su región; agencia: la suya.
   */
  public async agenciaSegmentoEnAlcance(
    user: any,
    segmento: string,
  ): Promise<boolean> {
    const alcance = resolverAlcance(user);
    if (alcance.tipo === 'GLOBAL') return true;
    if (!this.prisma) return false;
    const agencias = await this.prisma.agencia.findMany({
      where:
        alcance.tipo === 'REGION'
          ? { regionId: alcance.regionId }
          : alcance.tipo === 'AGENCIA'
            ? { id: alcance.agenciaId }
            : { id: { in: [] } },
      select: { id: true, nombre: true },
    });
    const buscado = String(segmento || '').toLowerCase();
    return agencias.some(
      (a) =>
        a.id.toLowerCase() === buscado ||
        this.safeSegment(a.nombre, 'agencia-general').toLowerCase() === buscado,
    );
  }

  /**
   * ¿Puede el usuario ver los archivos de esta máquina (carpeta `maquinaria/{código}/`)? Todo el país, todas;
   * región, las de su región; agencia, las de su agencia; el pulidor y el ámbito propio, solo las asignadas a él.
   * Si no se encuentra la máquina por ese código no hay a quién compararla y rige solo el permiso.
   */
  public async maquinaSegmentoEnAlcance(user: any, segmento: string): Promise<boolean> {
    const alcance = resolverAlcance(user);
    if (alcance.tipo === 'GLOBAL') return true;
    if (!this.prisma) return false;
    const maquina = await this.prisma.maquinaria.findFirst({
      where: { codigo: { equals: String(segmento || ''), mode: 'insensitive' } },
      select: { agenciaId: true, operadorAsignadoId: true, agencia: { select: { regionId: true } } },
    });
    if (!maquina) return true;
    if (rolDeUsuario(user) === 'PULIDOR' || alcance.tipo === 'PROPIO') {
      return !!user?.id && maquina.operadorAsignadoId === String(user.id);
    }
    if (alcance.tipo === 'REGION') return !!maquina.agencia?.regionId && maquina.agencia.regionId === alcance.regionId;
    if (alcance.tipo === 'AGENCIA') return !!maquina.agenciaId && maquina.agenciaId === alcance.agenciaId;
    return false;
  }

  private safeSegment(value: string | undefined, fallback: string): string {
    const normalized = String(value || fallback)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return normalized || fallback;
  }

  private defaultCategory(type: MediaEvidenceType): StorageCategory {
    if (type === 'FOTO_PERFIL') return 'PERFIL_USUARIO';
    if (type === 'FOTO_ENVIO') return 'INVENTARIO_ENVIOS';
    if (type === 'FOTO_AUDITORIA') return 'AUDITORIAS';
    if (
      type === 'IMAGEN_PRODUCTO' ||
      type === 'FOTO_AJUSTE_INVENTARIO' ||
      type === 'FOTO_INGRESO_INVENTARIO'
    )
      return 'CATALOGO_INSUMOS';
    if (type === 'VIDEO_PAUSA' || type === 'VIDEO_REANUDAR')
      return 'SERVICIOS_ESPECIALES';
    if (type === 'FOTO_MAQUINA') return 'MAQUINARIA_IMAGEN';
    if (type === 'FOTO_LIMPIEZA') return 'MAQUINARIA_LIMPIEZA';
    if (type === 'FICHA_TECNICA' || type === 'DOCUMENTO')
      return 'MAQUINARIA_FICHA';
    if (
      type === 'FOTO_INCIDENTE' ||
      type === 'VIDEO_INCIDENTE' ||
      type === 'DOCUMENTO_INCIDENTE'
    )
      return 'MAQUINARIA_INCIDENTE';
    if (type === 'PDF_CIERRE') return 'DOCUMENTO';
    return 'SERVICIOS_GENERALES';
  }

  private assertCategorySupportsType(
    category: StorageCategory,
    type: MediaEvidenceType,
  ): void {
    if (category === 'PERFIL_USUARIO' && type === 'FOTO_PERFIL') return;
    if (category === 'INVENTARIO_ENVIOS' && type === 'FOTO_ENVIO') return;
    if (category === 'AUDITORIAS' && type === 'FOTO_AUDITORIA') return;
    if (
      category === 'CATALOGO_INSUMOS' &&
      (type === 'IMAGEN_PRODUCTO' ||
        type === 'FOTO_AJUSTE_INVENTARIO' ||
        type === 'FOTO_INGRESO_INVENTARIO')
    )
      return;
    if (category === 'MAQUINARIA_IMAGEN' && type === 'FOTO_MAQUINA') return;
    if (
      category === 'MAQUINARIA_MANTENIMIENTO' &&
      (type === 'FOTO_INCIDENTE' ||
        type === 'DOCUMENTO' ||
        type === 'FICHA_TECNICA' ||
        type === 'VIDEO_INCIDENTE')
    )
      return;
    if (category === 'MAQUINARIA_LIMPIEZA' && type === 'FOTO_LIMPIEZA') return;
    const serviceTypes = new Set<MediaEvidenceType>([
      'FOTO_INGRESO',
      'FOTO_SALIDA',
      'FOTO_DANO_PREVIO',
      'FOTO_PROCESO',
      'VIDEO_INSPECCION',
      'VIDEO_INICIAL',
      'VIDEO_FINAL',
      'VIDEO_PAUSA',
      'VIDEO_REANUDAR',
    ]);
    const valid =
      category === 'SERVICIOS_GENERALES' || category === 'SERVICIOS_ESPECIALES'
        ? serviceTypes.has(type)
        : category === 'MAQUINARIA_FICHA'
          ? type === 'FICHA_TECNICA' || type === 'DOCUMENTO'
          : category === 'MAQUINARIA_INCIDENTE'
            ? type === 'FOTO_INCIDENTE' ||
              type === 'VIDEO_INCIDENTE' ||
              type === 'DOCUMENTO_INCIDENTE'
            : category === 'DOCUMENTO' && type === 'PDF_CIERRE';
    if (!valid)
      throw new BadRequestException(
        `El tipo ${type} no corresponde a la categoría ${category}.`,
      );
  }
}
