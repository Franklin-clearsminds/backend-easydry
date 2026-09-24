import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeleteObjectsCommand, GetBucketLocationCommand, GetObjectCommand, HeadBucketCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service.js';

export type StorageCategory =
  | 'SERVICIOS_GENERALES'
  | 'SERVICIOS_ESPECIALES'
  | 'MAQUINARIA_IMAGEN'
  | 'MAQUINARIA_FICHA'
  | 'MAQUINARIA_INCIDENTE'
  | 'MAQUINARIA_MANTENIMIENTO'
  | 'DOCUMENTO'
  | 'CATALOGO_INSUMOS'
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
  | 'FICHA_TECNICA'
  | 'DOCUMENTO'
  | 'FOTO_INCIDENTE'
  | 'VIDEO_INCIDENTE'
  | 'DOCUMENTO_INCIDENTE'
  | 'PDF_CIERRE'
  | 'IMAGEN_PRODUCTO'
  | 'FOTO_AJUSTE_INVENTARIO'
  | 'FOTO_INGRESO_INVENTARIO'
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
  incidenteFase?: 'fallas' | 'resoluciones';
  mantenimientoId?: string;
  insumoId?: string;
  insumoNombre?: string;
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
  'FOTO_INGRESO', 'FOTO_SALIDA', 'FOTO_DANO_PREVIO', 'FOTO_PROCESO',
  'VIDEO_INSPECCION', 'VIDEO_INICIAL', 'VIDEO_FINAL', 'VIDEO_PAUSA', 'VIDEO_REANUDAR', 'FOTO_MAQUINA', 'FICHA_TECNICA',
  'DOCUMENTO', 'FOTO_INCIDENTE', 'VIDEO_INCIDENTE', 'DOCUMENTO_INCIDENTE', 'PDF_CIERRE', 'IMAGEN_PRODUCTO', 'FOTO_AJUSTE_INVENTARIO', 'FOTO_INGRESO_INVENTARIO', 'FOTO_PERFIL',
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
    this.bucketName = this.configService.get<string>('AWS_S3_BUCKET_NAME')?.trim() || '';
    if (!this.region || !this.bucketName) {
      throw new Error('AWS_REGION y AWS_S3_BUCKET_NAME son obligatorios. EasyDry no admite almacenamiento local.');
    }
    this.publicUrlPrefix = this.configService.get<string>('AWS_S3_PUBLIC_URL_PREFIX')
      || `https://${this.bucketName}.s3.${this.region}.amazonaws.com`;
    const accessKeyId = (this.configService.get<string>('AWS_ACCESS_KEY_ID') ?? '').trim();
    const secretAccessKey = (this.configService.get<string>('AWS_SECRET_ACCESS_KEY') ?? '').trim();
    if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
      throw new Error('AWS_ACCESS_KEY_ID y AWS_SECRET_ACCESS_KEY deben configurarse juntos.');
    }

    const endpoint = this.configService.get<string>('AWS_ENDPOINT')?.trim()
      || this.configService.get<string>('AWS_S3_ENDPOINT')?.trim();
    this.s3Client = this.createS3Client(this.region, accessKeyId, secretAccessKey, endpoint);
  }

  private createS3Client(
    region: string,
    accessKeyId = (this.configService.get<string>('AWS_ACCESS_KEY_ID') ?? '').trim(),
    secretAccessKey = (this.configService.get<string>('AWS_SECRET_ACCESS_KEY') ?? '').trim(),
    endpoint = this.configService.get<string>('AWS_ENDPOINT')?.trim()
      || this.configService.get<string>('AWS_S3_ENDPOINT')?.trim(),
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
    const headers = err?.$response?.headers || err?.cause?.$response?.headers || {};
    const region = (
      headers['x-amz-bucket-region']
      || headers['X-Amz-Bucket-Region']
      || err?.BucketRegion
      || err?.cause?.BucketRegion
      || ''
    ).trim();
    return region || null;
  }

  private applyBucketRegion(actualRegion: string): void {
    const region = actualRegion.trim() || 'us-east-1';
    if (region === this.region) return;
    this.logger.warn(`El bucket ${this.bucketName} está en ${region}, no en ${this.region}. Recreando el cliente S3.`);
    this.region = region;
    this.publicUrlPrefix = `https://${this.bucketName}.s3.${this.region}.amazonaws.com`;
    this.s3Client.destroy();
    this.s3Client = this.createS3Client(this.region);
  }

  private async ensureBucketRegion(): Promise<void> {
    if (this.regionResolved) return;
    try {
      const loc = await this.s3Client.send(new GetBucketLocationCommand({ Bucket: this.bucketName }));
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
      await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucketName }));
      this.logger.log(`S3 verificado: ${this.bucketName} (${this.region})`);
      return;
    } catch (error) {
      const redirectedRegion = this.bucketRegionFromError(error);
      if (redirectedRegion && redirectedRegion !== this.region) {
        this.logger.warn(
          `El bucket ${this.bucketName} está en ${redirectedRegion}, no en ${this.region}. Recreando el cliente S3.`,
        );
        this.region = redirectedRegion;
        this.publicUrlPrefix = this.configService.get<string>('AWS_S3_PUBLIC_URL_PREFIX')
          || `https://${this.bucketName}.s3.${this.region}.amazonaws.com`;
        this.s3Client.destroy();
        this.s3Client = this.createS3Client(this.region);
        try {
          await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucketName }));
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

  public async buildS3Key(dto: GenerateUploadTicketDto): Promise<{ key: string; contentType: string }> {
    const type = String(dto.type || '').toUpperCase() as MediaEvidenceType;
    if (!ALLOWED_TYPES.has(type)) {
      throw new BadRequestException(`Tipo de evidencia no soportado: ${dto.type}`);
    }

    const category = dto.category || this.defaultCategory(type);
    this.assertCategorySupportsType(category, type);

    // ── Resolución del nombre real de la agencia ──────────────────────────
    // El frontend puede enviar un UUID, un nombre de agencia, o un código.
    // Intentamos resolver el nombre real desde BD para usar como slug de carpeta S3.
    const agencia = await this.resolveAgenciaSlug(dto.agenciaId);

    const serviceId = this.safeSegment(dto.servicioId || dto.clientUuid, 'sin-orden');
    const incidenteId = this.safeSegment(dto.incidenteId || dto.clientUuid, 'sin-incidente');
    const uuid = crypto.randomUUID().slice(0, 8);
    const timestamp = Date.now();
    const isVideo = type.startsWith('VIDEO_');
    const isDocument = type === 'DOCUMENTO' || type === 'DOCUMENTO_INCIDENTE' || type === 'PDF_CIERRE';
    const requestedExtension = String(dto.fileName || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
    const videoExtension = requestedExtension === 'mov' || requestedExtension === 'm4v'
      ? requestedExtension
      : 'mp4';
    const imageExt = requestedExtension === 'png' || requestedExtension === 'webp' || requestedExtension === 'jpeg'
      ? (requestedExtension === 'jpeg' ? 'jpg' : requestedExtension)
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
    } else if (type === 'FOTO_AJUSTE_INVENTARIO' || type === 'FOTO_INGRESO_INVENTARIO') {
      const insumoSlug = this.safeSegment(dto.insumoNombre || dto.insumoId, 'insumo');
      const agenciaSeg = agencia || this.safeSegment(dto.agenciaId || dto.servicioId, 'bodega');
      const folder = type === 'FOTO_INGRESO_INVENTARIO' ? 'ingresos' : 'reajustes';
      key = `agencias/${agenciaSeg}/inventario/${folder}/${insumoSlug}/${filename}`;
    } else if (category === 'CATALOGO_INSUMOS' || type === 'IMAGEN_PRODUCTO') {
      let rawInsumoName = dto.insumoNombre || '';
      const candidateId = dto.insumoId || dto.clientUuid || '';

      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidateId);
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
    } else if (category === 'SERVICIOS_GENERALES' || category === 'SERVICIOS_ESPECIALES') {
      const serviceKind = category === 'SERVICIOS_GENERALES' ? 'generales' : 'especiales';
      const folder = type === 'VIDEO_INICIAL'
        ? 'videos/inicial'
        : type === 'VIDEO_FINAL'
          ? 'videos/final'
          : type === 'VIDEO_PAUSA'
            ? 'videos/pausas'
            : type === 'VIDEO_REANUDAR'
              ? 'videos/reanudaciones'
              : isVideo ? 'videos' : isDocument ? 'documentos' : 'fotos';
      key = `agencias/${agencia}/servicios/${serviceKind}/${serviceId}/${folder}/${filename}`;
    } else if (
      category === 'MAQUINARIA_IMAGEN'
      || category === 'MAQUINARIA_FICHA'
      || category === 'MAQUINARIA_INCIDENTE'
      || category === 'MAQUINARIA_MANTENIMIENTO'
      || type === 'FOTO_MAQUINA'
      || type === 'FICHA_TECNICA'
    ) {
      const equipo = await this.resolveMaquinariaSlug(dto);
      const folder = isVideo ? 'videos' : isDocument ? 'documentos' : 'fotos';
      if (category === 'MAQUINARIA_IMAGEN' || type === 'FOTO_MAQUINA') {
        key = `agencias/maquinaria/${equipo}/imagen/${filename}`;
      } else if (category === 'MAQUINARIA_FICHA' || type === 'FICHA_TECNICA') {
        key = `agencias/maquinaria/${equipo}/ficha-tecnica/${filename}`;
      } else if (category === 'MAQUINARIA_MANTENIMIENTO') {
        const mantId = this.safeSegment(dto.mantenimientoId || dto.clientUuid, 'sin-id');
        key = `agencias/maquinaria/${equipo}/mantenimientos/${mantId}/${folder}/${filename}`;
      } else {
        const fase = this.incidenteFase(dto);
        key = `agencias/maquinaria/${equipo}/incidentes/${incidenteId}/${fase}/${folder}/${filename}`;
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
  private async resolveAgenciaSlug(agenciaId?: string): Promise<string> {
    if (!agenciaId || !agenciaId.trim()) return 'agencia-general';

    const raw = agenciaId.trim();

    // Es un UUID → intentar resolver desde BD
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw);
    if (isUuid && this.prisma) {
      try {
        const agencia = await this.prisma.agencia.findUnique({
          where: { id: raw },
          select: { nombre: true, codigo: true },
        });
        if (agencia?.nombre) {
          return this.safeSegment(agencia.nombre, 'agencia-general');
        }
      } catch {
        // fallback al texto crudo
      }
    }

    // Es un nombre/código legible → slugificar directamente
    return this.safeSegment(raw, 'agencia-general');
  }

  private incidenteFase(dto: GenerateUploadTicketDto): 'fallas' | 'resoluciones' {
    const raw = String(dto.incidenteFase || '').trim().toLowerCase();
    if (raw === 'resoluciones' || raw === 'resolucion' || raw === 'reparacion' || raw === 'solucion') {
      return 'resoluciones';
    }
    return 'fallas';
  }

  /**
   * Carpeta estable del equipo, independiente de la agencia.
   * Prioridad: código → BD (si llega UUID) → nombre → id.
   */
  private async resolveMaquinariaSlug(dto: GenerateUploadTicketDto): Promise<string> {
    const codigo = String(dto.maquinariaCodigo || '').trim();
    if (codigo) return this.safeSegment(codigo, 'equipo');

    const candidateId = String(dto.maquinariaId || '').trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidateId);
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

    const nombre = String(dto.maquinariaNombre || dto.insumoNombre || '').trim();
    if (nombre) return this.safeSegment(nombre, 'equipo');
    if (candidateId) return this.safeSegment(candidateId, 'equipo');
    return 'equipo';
  }

  public async generateUploadTicket(dto: GenerateUploadTicketDto): Promise<UploadTicketResponse> {
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
    const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn: expiresInSeconds });
    return this.ticketResponse(
      dto,
      key,
      uploadUrl,
      `${this.publicUrlPrefix.replace(/\/$/, '')}/${key}`,
      contentType,
      expiresInSeconds,
      {}
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
    await this.s3Client.send(new PutObjectCommand({
      Bucket: this.bucketName,
      Key: built.key,
      Body: body,
      ContentType: contentType || built.contentType,
    }));
    if (String(contentType || built.contentType || '').toLowerCase().startsWith('image/')) {
      void this.generarMiniaturaDesdeBuffer(built.key, body);
    }
    return {
      key: built.key,
      publicUrl: `${this.publicUrlPrefix.replace(/\/$/, '')}/${built.key}`,
    };
  }

  public async getPresignedDownloadUrl(rawKey: string, expiresInSeconds = 3600): Promise<string> {
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
    if (!normalizedKey) throw new BadRequestException('La clave del archivo es obligatoria.');

    const isMp4 = normalizedKey.toLowerCase().endsWith('.mp4');
    const isWebm = normalizedKey.toLowerCase().endsWith('.webm');
    const overrideContentType = isMp4 ? 'video/mp4' : (isWebm ? 'video/webm' : undefined);

    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: normalizedKey,
      ...(overrideContentType ? { ResponseContentType: overrideContentType } : {}),
    });

    return getSignedUrl(this.s3Client, command, { expiresIn: expiresInSeconds });
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  MINIATURAS: cada foto tiene una copia liviana en `thumbs/<clave-original>.jpg`
  //  (480 px de ancho, JPEG). Los listados cargan la miniatura y la foto completa solo
  //  se descarga al abrirla. La ruta es determinística: no requiere columnas en la base.
  // ─────────────────────────────────────────────────────────────────────────

  private static readonly THUMB_WIDTH = 480;
  private static readonly IMAGE_KEY = /\.(jpe?g|png|webp|heic|heif)$/i;

  public thumbnailKeyFor(key: string): string {
    return `thumbs/${String(key).replace(/^[/\\]+/, '').replace(/\.[^./]+$/, '')}.jpg`;
  }

  private async escribirMiniatura(key: string, original: Buffer): Promise<void> {
    const thumb = await sharp(original, { failOn: 'none' })
      .rotate()
      .resize({ width: StorageService.THUMB_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 72, mozjpeg: true })
      .toBuffer();
    await this.ensureBucketRegion();
    await this.s3Client.send(new PutObjectCommand({
      Bucket: this.bucketName,
      Key: this.thumbnailKeyFor(key),
      Body: thumb,
      ContentType: 'image/jpeg',
    }));
  }

  /** Genera la miniatura desde los bytes ya disponibles. Nunca lanza: una falla solo se registra. */
  public async generarMiniaturaDesdeBuffer(key: string, original: Buffer): Promise<void> {
    try {
      if (!StorageService.IMAGE_KEY.test(key) || key.startsWith('thumbs/')) return;
      await this.escribirMiniatura(key, original);
    } catch (error: unknown) {
      this.logger.warn(`No se pudo generar la miniatura de ${key}: ${error instanceof Error ? error.message : error}`);
    }
  }

  /** Genera la miniatura de una foto que el cliente ya subió a S3 (descarga, reduce y guarda). Nunca lanza. */
  public async generarMiniaturaDesdeUrl(fileUrl: string): Promise<void> {
    try {
      const prefix = this.publicUrlPrefix.replace(/\/$/, '');
      const url = String(fileUrl || '').trim();
      if (!prefix || !url.startsWith(`${prefix}/`)) return;
      const key = decodeURIComponent(url.slice(prefix.length + 1).split('?')[0]);
      if (!StorageService.IMAGE_KEY.test(key) || key.startsWith('thumbs/')) return;

      await this.ensureBucketRegion();
      const object = await this.s3Client.send(new GetObjectCommand({ Bucket: this.bucketName, Key: key }));
      const bytes = await object.Body?.transformToByteArray();
      if (!bytes) return;
      await this.escribirMiniatura(key, Buffer.from(bytes));
    } catch (error: unknown) {
      this.logger.warn(`No se pudo generar la miniatura de ${fileUrl}: ${error instanceof Error ? error.message : error}`);
    }
  }

  public getBucketName(): string { return this.bucketName; }

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
      const listed = await this.s3Client.send(new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: prefix,
      }));
      const objects = (listed.Contents || [])
        .map((item) => item.Key)
        .filter((key): key is string => Boolean(key));
      if (!objects.length) return;

      await this.s3Client.send(new DeleteObjectsCommand({
        Bucket: this.bucketName,
        Delete: { Objects: objects.map((Key) => ({ Key })), Quiet: true },
      }));
      this.logger.log(`Avatar anterior eliminado: ${prefix} (${objects.length})`);
    } catch (error) {
      this.logger.warn(`No se pudieron eliminar avatares previos en ${prefix}`, error as Error);
    }
  }

  private ticketResponse(dto: GenerateUploadTicketDto, key: string, uploadUrl: string, publicUrl: string, contentType: string, expiresInSeconds: number, extraHeaders: Record<string, string> = {}): UploadTicketResponse {
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
    const raw = String(value || '').trim().toLowerCase();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
      return raw;
    }
    return this.safeSegment(raw, 'usuario');
  }

  private safeSegment(value: string | undefined, fallback: string): string {
    const normalized = String(value || fallback).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    return normalized || fallback;
  }

  private defaultCategory(type: MediaEvidenceType): StorageCategory {
    if (type === 'FOTO_PERFIL') return 'PERFIL_USUARIO';
    if (type === 'IMAGEN_PRODUCTO' || type === 'FOTO_AJUSTE_INVENTARIO' || type === 'FOTO_INGRESO_INVENTARIO') return 'CATALOGO_INSUMOS';
    if (type === 'VIDEO_PAUSA' || type === 'VIDEO_REANUDAR') return 'SERVICIOS_ESPECIALES';
    if (type === 'FOTO_MAQUINA') return 'MAQUINARIA_IMAGEN';
    if (type === 'FICHA_TECNICA' || type === 'DOCUMENTO') return 'MAQUINARIA_FICHA';
    if (type === 'FOTO_INCIDENTE' || type === 'VIDEO_INCIDENTE' || type === 'DOCUMENTO_INCIDENTE') return 'MAQUINARIA_INCIDENTE';
    if (type === 'PDF_CIERRE') return 'DOCUMENTO';
    return 'SERVICIOS_GENERALES';
  }

  private assertCategorySupportsType(category: StorageCategory, type: MediaEvidenceType): void {
    if (category === 'PERFIL_USUARIO' && type === 'FOTO_PERFIL') return;
    if (category === 'CATALOGO_INSUMOS' && (type === 'IMAGEN_PRODUCTO' || type === 'FOTO_AJUSTE_INVENTARIO' || type === 'FOTO_INGRESO_INVENTARIO')) return;
    if (category === 'MAQUINARIA_IMAGEN' && type === 'FOTO_MAQUINA') return;
    if (category === 'MAQUINARIA_MANTENIMIENTO' && (type === 'FOTO_INCIDENTE' || type === 'DOCUMENTO' || type === 'FICHA_TECNICA' || type === 'VIDEO_INCIDENTE')) return;
    const serviceTypes = new Set<MediaEvidenceType>([
      'FOTO_INGRESO', 'FOTO_SALIDA', 'FOTO_DANO_PREVIO', 'FOTO_PROCESO',
      'VIDEO_INSPECCION', 'VIDEO_INICIAL', 'VIDEO_FINAL', 'VIDEO_PAUSA', 'VIDEO_REANUDAR',
    ]);
    const valid = category === 'SERVICIOS_GENERALES' || category === 'SERVICIOS_ESPECIALES'
      ? serviceTypes.has(type)
      : category === 'MAQUINARIA_FICHA'
        ? type === 'FICHA_TECNICA' || type === 'DOCUMENTO'
        : category === 'MAQUINARIA_INCIDENTE'
          ? type === 'FOTO_INCIDENTE' || type === 'VIDEO_INCIDENTE' || type === 'DOCUMENTO_INCIDENTE'
          : category === 'DOCUMENTO' && type === 'PDF_CIERRE';
    if (!valid) throw new BadRequestException(`El tipo ${type} no corresponde a la categoría ${category}.`);
  }
}
