import { S3Client, HeadBucketCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import fs from 'node:fs';
import path from 'node:path';

// Cargar variables de entorno del backend de forma nativa
try {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.substring(0, eqIdx).trim();
          let val = trimmed.substring(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.substring(1, val.length - 1);
          }
          if (process.env[key] === undefined) {
            process.env[key] = val;
          }
        }
      }
    });
  }
} catch { /* ignore */ }

async function testS3Connection() {
  console.log('\n======================================================');
  console.log('   🔍 DIAGNÓSTICO DE CONEXIÓN AWS S3 — EASYDRY®       ');
  console.log('======================================================\n');

  const driver = process.env.STORAGE_DRIVER || 'local';
  const region = process.env.AWS_REGION || 'us-east-1';
  const bucketName = process.env.AWS_S3_BUCKET_NAME || 'easydry-storage-dev';
  const accessKey = process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
  const endpoint = process.env.AWS_ENDPOINT || process.env.AWS_S3_ENDPOINT;
  const publicPrefix = process.env.AWS_S3_PUBLIC_URL_PREFIX || `https://${bucketName}.s3.${region}.amazonaws.com`;

  console.log('📋 Variables de entorno detectadas:');
  console.log(` • STORAGE_DRIVER:            ${driver}`);
  console.log(` • AWS_REGION:                 ${region}`);
  console.log(` • AWS_S3_BUCKET_NAME:         ${bucketName}`);
  console.log(` • AWS_ACCESS_KEY_ID:          ${accessKey ? accessKey.substring(0, 4) + '***' + accessKey.slice(-4) : '❌ NO DEFINIDO'}`);
  console.log(` • AWS_SECRET_ACCESS_KEY:      ${secretKey ? '******** (definido)' : '❌ NO DEFINIDO'}`);
  console.log(` • AWS_ENDPOINT:               ${endpoint || '(por defecto AWS oficial)'}`);
  console.log(` • AWS_S3_PUBLIC_URL_PREFIX:   ${publicPrefix}\n`);

  if (driver.toLowerCase() !== 's3') {
    console.log('⚠️  AVISO: STORAGE_DRIVER está configurado como "' + driver + '".');
    console.log('   El backend operará en modo LOCAL (archivos guardados en disco local /uploads).');
    console.log('   Para usar AWS S3 real, cambia en tu .env: STORAGE_DRIVER="s3"\n');
  }

  if (!accessKey || !secretKey) {
    console.error('❌ ERROR: Faltan credenciales AWS_ACCESS_KEY_ID o AWS_SECRET_ACCESS_KEY en tu archivo .env.');
    console.error('   Configúralas con tu usuario IAM con permisos AmazonS3FullAccess o permisos sobre el bucket.\n');
    process.exit(1);
  }

  const s3 = new S3Client({
    region,
    credentials: {
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
    },
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  });

  const testKey = `_test_diagnostico/conexion_${Date.now()}.txt`;
  const testContent = `Prueba de conexion EasyDry S3 exitosa: ${new Date().toISOString()}`;

  try {
    // 1. Verificar acceso al Bucket
    console.log('1️⃣  Verificando existencia del bucket y permisos IAM...');
    await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
    console.log('   ✅ Bucket encontrado y accesible con las credenciales proporcionadas.');

    // 2. Probar subida (PUT)
    console.log('2️⃣  Probando subida de archivo de prueba (PutObject)...');
    await s3.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: testKey,
        Body: Buffer.from(testContent),
        ContentType: 'text/plain',
      })
    );
    console.log(`   ✅ Archivo de prueba escrito correctamente en: "${testKey}"`);

    // 3. Probar lectura (GET)
    console.log('3️⃣  Probando lectura del archivo de prueba (GetObject)...');
    const getRes = await s3.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: testKey,
      })
    );
    const bodyStr = await getRes.Body?.transformToString();
    console.log(`   ✅ Archivo leído correctamente: "${bodyStr}"`);

    // 4. Limpieza (DELETE)
    console.log('4️⃣  Limpiando archivo temporal de prueba (DeleteObject)...');
    await s3.send(
      new DeleteObjectCommand({
        Bucket: bucketName,
        Key: testKey,
      })
    );
    console.log('   ✅ Archivo temporal eliminado.');

    console.log('\n======================================================');
    console.log('   🎉 ¡CONEXIÓN CON AWS S3 VERIFICADA AL 100%!        ');
    console.log('======================================================');
    console.log(` • Tu bucket "${bucketName}" está listo para recibir`);
    console.log('   vídeos y fotos de evidencias en tiempo real.');
    console.log('======================================================\n');
  } catch (err: any) {
    console.error('\n❌ ERROR AL CONECTAR CON AWS S3:');
    console.error(` • Código: ${err?.name || err?.Code || 'Error'}`);
    console.error(` • Mensaje: ${err?.message || err}`);
    if (err?.$metadata) {
      console.error(` • HTTP Status: ${err.$metadata.httpStatusCode}`);
      console.error(` • Request ID: ${err.$metadata.requestId}`);
    }
    if (err?.Code) {
      console.error(` • AWS Error Code: ${err.Code}`);
    }

    const bucketRegion = err?.$response?.headers?.['x-amz-bucket-region'];
    if (err?.$metadata?.httpStatusCode === 301 && bucketRegion) {
      console.log(`\n🔄 Reintentando prueba automáticamente con la región detectada: "${bucketRegion}"...\n`);
      const s3Retry = new S3Client({
        region: bucketRegion,
        credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
        ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      });

      console.log(`1️⃣  Verificando existencia del bucket en "${bucketRegion}"...`);
      await s3Retry.send(new HeadBucketCommand({ Bucket: bucketName }));
      console.log('   ✅ Bucket encontrado y accesible.');

      console.log('2️⃣  Probando subida de archivo de prueba (PutObject)...');
      await s3Retry.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: testKey,
          Body: Buffer.from(testContent),
          ContentType: 'text/plain',
        })
      );
      console.log(`   ✅ Archivo de prueba subido a: "${testKey}"`);

      console.log('3️⃣  Probando lectura (GetObject)...');
      const getRes = await s3Retry.send(new GetObjectCommand({ Bucket: bucketName, Key: testKey }));
      const bodyStr = await getRes.Body?.transformToString();
      console.log(`   ✅ Archivo leído correctamente: "${bodyStr}"`);

      console.log('4️⃣  Limpiando archivo temporal (DeleteObject)...');
      await s3Retry.send(new DeleteObjectCommand({ Bucket: bucketName, Key: testKey }));
      console.log('   ✅ Archivo temporal eliminado.');

      console.log('\n======================================================');
      console.log('   🎉 ¡CREDENCIALES Y BUCKET 100% FUNCIONALES!        ');
      console.log('======================================================');
      console.log(` 👉 Solo necesitas cambiar en tu backend .env:`);
      console.log(`    AWS_REGION="${bucketRegion}"`);
      console.log(`    AWS_S3_PUBLIC_URL_PREFIX="https://${bucketName}.s3.${bucketRegion}.amazonaws.com"`);
      console.log('======================================================\n');
      return;
    }

    if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) {
      console.log(` • El bucket "${bucketName}" no existe en la región "${region}". Crea el bucket en la consola de AWS.`);
    } else if (err?.name === 'Forbidden' || err?.$metadata?.httpStatusCode === 403) {
      console.log(' • Las credenciales no tienen permisos suficientes en este bucket. Revisa las políticas IAM (s3:PutObject, s3:GetObject, s3:DeleteObject, s3:ListBucket).');
    } else if (err?.name === 'InvalidAccessKeyId') {
      console.log(' • El AWS_ACCESS_KEY_ID ingresado no es válido o ha sido revocado en AWS IAM.');
    } else if (err?.name === 'SignatureDoesNotMatch') {
      console.log(' • El AWS_SECRET_ACCESS_KEY ingresado es incorrecto.');
    } else {
      console.log(' • Verifica tu conexión a internet, región de AWS y reglas de CORS/Bucket Policy.');
    }
    console.log('');
  }
}

testS3Connection();
