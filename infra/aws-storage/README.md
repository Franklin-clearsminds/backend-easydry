# AWS S3 de EasyDry (desarrollo)

Estos archivos configuran el bucket `easydry-storage-dev` según la estructura usada por `StorageService`.

## Aplicación con AWS CLI

Ejecutar con un perfil autorizado para administrar el bucket:

```powershell
aws s3api put-bucket-cors --bucket easydry-storage-dev --cors-configuration file://infra/aws-storage/cors.json
aws s3api put-bucket-policy --bucket easydry-storage-dev --policy file://infra/aws-storage/bucket-policy.json
aws s3api put-bucket-lifecycle-configuration --bucket easydry-storage-dev --lifecycle-configuration file://infra/aws-storage/lifecycle.json
```

La política solicitada permite lectura pública solo bajo `agencias/*`. Para que AWS la acepte hay que desactivar, para este bucket, el bloqueo de políticas públicas. Los `PUT` siguen siendo privados y solo se admiten mediante tickets prefirmados.

`StorageService` etiqueta cada objeto como `image`, `video` o `document`. Las reglas lifecycle usan esas etiquetas porque S3 no puede filtrar por una carpeta que aparece en medio de la clave.

En producción conviene reemplazar `"AllowedOrigins": ["*"]` por los dominios web exactos. Las apps nativas no envían un origen de navegador.
