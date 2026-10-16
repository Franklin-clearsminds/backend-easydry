import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/** Carpeta raíz del archivo histórico en el bucket. Es privada y distinta de la de evidencias. */
export const PREFIJO_ARCHIVO = 'archivo-historico';

/** Dónde se guardan los archivos Parquet. Las pruebas usan una versión en memoria: nunca tocan el bucket real. */
export interface AlmacenArchivo {
  put(clave: string, cuerpo: Buffer, contentType: string): Promise<void>;
  /** `null` si el objeto no existe. */
  get(clave: string): Promise<Buffer | null>;
}

export const ALMACEN_ARCHIVO = Symbol('ALMACEN_ARCHIVO');

/**
 * S3 con credenciales propias del archivado (ARCHIVO_AWS_*) si existen: así se puede dar a ese usuario permiso solo sobre
 * `archivo-historico/` y sin permiso de borrar. Si no, usa las de la aplicación.
 */
@Injectable()
export class AlmacenS3 implements AlmacenArchivo {
  private readonly cliente: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    const leer = (...nombres: string[]) => nombres.map((n) => config.get<string>(n)?.trim()).find(Boolean) ?? '';
    this.bucket = leer('ARCHIVO_S3_BUCKET', 'AWS_S3_BUCKET_NAME');
    const accessKeyId = leer('ARCHIVO_AWS_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID');
    const secretAccessKey = leer('ARCHIVO_AWS_SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY');
    const endpoint = leer('AWS_ENDPOINT', 'AWS_S3_ENDPOINT');
    this.cliente = new S3Client({
      region: leer('AWS_REGION') || 'us-east-1',
      followRegionRedirects: true,
      ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
  }

  async put(clave: string, cuerpo: Buffer, contentType: string): Promise<void> {
    await this.cliente.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: clave, Body: cuerpo, ContentType: contentType, ServerSideEncryption: 'AES256' }),
    );
  }

  async get(clave: string): Promise<Buffer | null> {
    try {
      const r = await this.cliente.send(new GetObjectCommand({ Bucket: this.bucket, Key: clave }));
      return Buffer.from(await r.Body!.transformToByteArray());
    } catch (e: any) {
      if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }
}
