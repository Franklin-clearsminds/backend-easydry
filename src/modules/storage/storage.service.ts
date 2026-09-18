import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'node:crypto';
import path from 'node:path';

export type StorageCategory =
  | 'SERVICIOS_GENERALES'
  | 'SERVICIOS_ESPECIALES'
  | 'MAQUINARIA_FICHA'
  | 'MAQUINARIA_INCIDENTE'
  | 'DOCUMENTO';

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
  | 'FICHA_TECNICA'
  | 'DOCUMENTO'
  | 'FOTO_INCIDENTE'
  | 'VIDEO_INCIDENTE'
  | 'DOCUMENTO_INCIDENTE'
  | 'PDF_CIERRE';

export interface GenerateUploadTicketDto {
  clientUuid?: string;
  agenciaId?: string;
  servicioId?: string;
  maquinariaId?: string;
  incidenteId?: string;
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
  driver: 's3' | 'local';
  expiresInSeconds: number;
  headers: Record<string, string>;
}

const ALLOWED_TYPES = new Set<MediaEvidenceType>([
  'FOTO_INGRESO', 'FOTO_SALIDA', 'FOTO_DANO_PREVIO', 'FOTO_PROCESO',
  'VIDEO_INSPECCION', 'VIDEO_INICIAL', 'VIDEO_FINAL', 'VIDEO_PAUSA', 'VIDEO_REANUDAR', 'FICHA_TECNICA',
  'DOCUMENTO', 'FOTO_INCIDENTE', 'VIDEO_INCIDENTE', 'DOCUMENTO_INCIDENTE', 'PDF_CIERRE',
]);

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3Client?: S3Client;
  private readonly bucketName: string;
  private readonly region: string;
  private readonly publicUrlPrefix: string;
  private readonly isS3Configured: boolean;
  private readonly localRoot: string;
  private readonly ticketSecret: string;
  private readonly maxFileSizeBytes: number;

  constructor(private readonly configService: ConfigService) {
    this.region = this.configService.get<string>('AWS_REGION', 'us-east-1');
    this.bucketName = this.configService.get<string>('AWS_S3_BUCKET_NAME', 'easydry-storage-dev');
    this.publicUrlPrefix = this.configService.get<string>('AWS_S3_PUBLIC_URL_PREFIX')
      || `https://${this.bucketName}.s3.${this.region}.amazonaws.com`;
    this.localRoot = path.resolve(this.configService.get<string>('UPLOAD_DIR', './uploads'));
    this.ticketSecret = this.configService.get<string>('STORAGE_TICKET_SECRET')
      || this.configService.get<string>('JWT_SECRET', 'easydry-local-storage');
    this.maxFileSizeBytes = this.configService.get<number>('MAX_FILE_SIZE_MB', 35) * 1024 * 1024;

    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');
    const endpoint = this.configService.get<string>('AWS_ENDPOINT') || this.configService.get<string>('AWS_S3_ENDPOINT');
    const driver = this.configService.get<string>('STORAGE_DRIVER', 'local').toLowerCase();

    if (driver === 's3' && accessKeyId && secretAccessKey) {
      this.s3Client = new S3Client({
        region: this.region,
        credentials: { accessKeyId, secretAccessKey },
        ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      });
      this.isS3Configured = true;
      this.logger.log(`S3 inicializado: ${this.bucketName} (${this.region})${endpoint ? ' [Endpoint: ' + endpoint + ']' : ''}`);
    } else {
      this.isS3Configured = false;
      this.logger.warn('Storage en modo local: STORAGE_DRIVER no es s3 o faltan credenciales AWS.');
    }
  }

  public buildS3Key(dto: GenerateUploadTicketDto): { key: string; contentType: string } {
    const type = String(dto.type || '').toUpperCase() as MediaEvidenceType;
    if (!ALLOWED_TYPES.has(type)) {
      throw new BadRequestException(`Tipo de evidencia no soportado: ${dto.type}`);
    }

    const category = dto.category || this.defaultCategory(type);
    this.assertCategorySupportsType(category, type);

    const agencia = this.safeSegment(dto.agenciaId, 'agencia-general');
    const serviceId = this.safeSegment(dto.servicioId || dto.clientUuid, 'sin-orden');
    const maquinariaId = this.safeSegment(dto.maquinariaId, 'sin-maquinaria');
    const incidenteId = this.safeSegment(dto.incidenteId || dto.clientUuid, 'sin-incidente');
    const uuid = crypto.randomUUID().slice(0, 8);
    const timestamp = Date.now();
    const isVideo = type.startsWith('VIDEO_');
    const isDocument = type === 'DOCUMENTO' || type === 'DOCUMENTO_INCIDENTE' || type === 'PDF_CIERRE';
    const ext = isVideo ? 'mp4' : isDocument ? 'pdf' : 'jpg';
    const contentType = isVideo ? 'video/mp4' : isDocument ? 'application/pdf' : 'image/jpeg';
    const filename = `${timestamp}_${type.toLowerCase()}_${uuid}.${ext}`;

    let key: string;
    if (category === 'SERVICIOS_GENERALES' || category === 'SERVICIOS_ESPECIALES') {
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
    } else if (category === 'MAQUINARIA_FICHA') {
      const folder = isDocument ? 'documentos' : 'fotos';
      key = `agencias/${agencia}/maquinaria/${maquinariaId}/ficha-tecnica/${folder}/${filename}`;
    } else if (category === 'MAQUINARIA_INCIDENTE') {
      const folder = isVideo ? 'videos' : isDocument ? 'documentos' : 'fotos';
      key = `agencias/${agencia}/maquinaria/${maquinariaId}/incidentes/${incidenteId}/${folder}/${filename}`;
    } else {
      const now = new Date();
      key = `agencias/${agencia}/documentos/cierres/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${filename}`;
    }

    return { key, contentType };
  }

  public async generateUploadTicket(dto: GenerateUploadTicketDto): Promise<UploadTicketResponse> {
    const { key, contentType } = this.buildS3Key(dto);
    const expiresInSeconds = 900;

    if (this.isS3Configured && this.s3Client) {
      const lifecycleClass = contentType.startsWith('video/') ? 'video' : contentType === 'application/pdf' ? 'document' : 'image';
      const tagging = `storage-class=${lifecycleClass}`;
      const command = new PutObjectCommand({ Bucket: this.bucketName, Key: key, ContentType: contentType, Tagging: tagging });
      const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn: expiresInSeconds });
      return this.ticketResponse(dto, key, uploadUrl, `${this.publicUrlPrefix.replace(/\/$/, '')}/${key}`, 's3', contentType, expiresInSeconds, {
        'x-amz-tagging': tagging,
      });
    }

    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const token = this.signLocalTicket(key, expiresAt);
    const query = `key=${encodeURIComponent(key)}&expires=${expiresAt}&token=${token}`;
    return this.ticketResponse(dto, key, `/api/v1/storage/local-upload?${query}`, `/uploads/${key}`, 'local', contentType, expiresInSeconds);
  }

  public verifyLocalTicket(key: string, expires: number, token: string): string {
    if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException('El ticket de subida local expiró.');
    }
    const normalizedKey = key.replace(/\\/g, '/');
    const expected = this.signLocalTicket(normalizedKey, expires);
    const received = Buffer.from(token || '', 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    if (received.length !== expectedBuffer.length || !crypto.timingSafeEqual(received, expectedBuffer)) {
      throw new UnauthorizedException('Ticket de subida local inválido.');
    }
    const target = path.resolve(this.localRoot, ...normalizedKey.split('/'));
    if (target !== this.localRoot && !target.startsWith(`${this.localRoot}${path.sep}`)) {
      throw new BadRequestException('Ruta de almacenamiento inválida.');
    }
    return target;
  }

  public async getPresignedDownloadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    if (!this.isS3Configured || !this.s3Client) return `/uploads/${key}`;
    return getSignedUrl(this.s3Client, new GetObjectCommand({ Bucket: this.bucketName, Key: key }), { expiresIn: expiresInSeconds });
  }

  public getMaxFileSizeBytes(): number { return this.maxFileSizeBytes; }
  public getBucketName(): string { return this.bucketName; }
  public isUsingS3(): boolean { return this.isS3Configured; }

  private ticketResponse(dto: GenerateUploadTicketDto, key: string, uploadUrl: string, publicUrl: string, driver: 's3' | 'local', contentType: string, expiresInSeconds: number, extraHeaders: Record<string, string> = {}): UploadTicketResponse {
    return {
      ticketId: `tkt_${driver}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      clientUuid: dto.clientUuid,
      type: dto.type,
      key,
      uploadUrl,
      publicUrl,
      driver,
      expiresInSeconds,
      headers: { 'Content-Type': contentType, ...extraHeaders },
    };
  }

  private signLocalTicket(key: string, expires: number): string {
    return crypto.createHmac('sha256', this.ticketSecret).update(`${key}:${expires}`).digest('hex');
  }

  private safeSegment(value: string | undefined, fallback: string): string {
    const normalized = String(value || fallback).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    return normalized || fallback;
  }

  private defaultCategory(type: MediaEvidenceType): StorageCategory {
    if (type === 'VIDEO_PAUSA' || type === 'VIDEO_REANUDAR') return 'SERVICIOS_ESPECIALES';
    if (type === 'FICHA_TECNICA' || type === 'DOCUMENTO') return 'MAQUINARIA_FICHA';
    if (type === 'FOTO_INCIDENTE' || type === 'VIDEO_INCIDENTE' || type === 'DOCUMENTO_INCIDENTE') return 'MAQUINARIA_INCIDENTE';
    if (type === 'PDF_CIERRE') return 'DOCUMENTO';
    return 'SERVICIOS_GENERALES';
  }

  private assertCategorySupportsType(category: StorageCategory, type: MediaEvidenceType): void {
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
