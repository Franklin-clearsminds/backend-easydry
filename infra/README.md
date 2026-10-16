# Infraestructura S3

## Ciclo de vida de evidencias (`s3-lifecycle-evidencias.json`)

Pasa las evidencias (fotos, videos, documentos) a clases de almacenamiento más baratas con el tiempo. Nunca borra nada y las URLs firmadas siguen abriendo al instante.

| Edad | Clase |
|---|---|
| 0 a 90 días | Standard |
| 90 a 365 días | Standard-IA |
| más de 365 días | Glacier Instant Retrieval |

Cubre `agencias/`, `inventario/envios/` y `maquinaria/`. Excluye `usuarios/` (avatares) y `catalogo/` (fotos de insumos), que se consultan con frecuencia.

No usar Glacier Flexible Retrieval ni Deep Archive: tardan minutos u horas en devolver el archivo y la app mostraría un error al abrir una foto vieja.

### Aplicar

`put-bucket-lifecycle-configuration` **reemplaza** todas las reglas del bucket. Primero revisa si ya existen:

```bash
aws s3api get-bucket-lifecycle-configuration --bucket <AWS_S3_BUCKET_NAME>
```

Si no hay reglas (o las incluyes en el JSON), aplica:

```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket <AWS_S3_BUCKET_NAME> \
  --lifecycle-configuration file://infra/s3-lifecycle-evidencias.json
```

También se puede hacer desde la consola: bucket → Management → Lifecycle rules.

El usuario IAM que lo aplique necesita el permiso `s3:PutLifecycleConfiguration`. Las credenciales de la aplicación no deberían tenerlo.
