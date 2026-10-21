# EasyDry® — Backend API Gateway & Offline Sync Engine

> **Plataforma Integral de Gestión y Control Operativo para Centros de Lavado Automotriz Ecológico.**  
> Backend empresarial desarrollado con **NestJS 12**, **TypeScript**, **Prisma ORM 6**, **PostgreSQL** y arquitectura **100% POST** con soporte para **Sincronización Offline Industrial** y **Notificaciones en Tiempo Real (WebSocket)**.

---

## 🚀 Tecnologías y Arquitectura

* **Framework:** [NestJS 12](https://nestjs.com/) (Modular, Inyección de Dependencias, Decoradores tipados).
* **ORM:** [Prisma v6](https://www.prisma.io/) con cliente generado para PostgreSQL.
* **Base de Datos:** PostgreSQL (`easydry_db`) con relaciones relacionales y auditoría JSON.
* **Seguridad y Cifrado:**
  * Autenticación con **JWT** (Access Token + Refresh Token de larga duración).
  * Matriz **RBAC** granular (Control de Acceso Basado en Roles con permisos inmutables para `SUPER_ADMIN`).
  * Cifrado simétrico **AES-256-CBC** para datos y tokens sensibles.
* **Estándar de Comunicación:** **100% POST** en todos los endpoints operativos para evitar fugas de información en URLs, prevenir caché no deseada de proxies y unificar contratos de payload.
* **Motor Offline-First:** Diseñado para soportar fallos de red en subsuelos y zonas remotas:
  * **Outbox Pattern Idempotente** (`clientUuid`).
  * **Dead-Letter Queue (DLQ)** para aislar mutaciones corruptas o "poison pills".
  * **Deltas Seguros:** Ventana de solapamiento de 5 segundos (`safeSince`) y scoping por agencia/rol.
  * **Subida Multimedia Desacoplada:** Tickets prefirmados para fotos sin sobrecargar payloads JSON.
  * **Resolución de Conflictos:** "Gana la Operación en Campo" (el trabajo físico prevalece sobre cancelaciones administrativas).
* **Notificaciones en Tiempo Real:** Gateway WebSocket (`@nestjs/websockets` + `socket.io`, namespace `/notifications`) con autenticación por JWT en el handshake, respaldado por persistencia en PostgreSQL (`Notification`). El envío es "fire-and-forget": nunca bloquea ni revienta la operación principal si falla. La app móvil recibe sus avisos por push de Expo.
* **Caché y escalado (Redis opcional):** con `REDIS_URL` se comparten entre instancias la caché, el límite de peticiones, los sockets (`RedisIoAdapter`) y los candados de las tareas programadas. Sin Redis todo funciona igual con la memoria de cada proceso (una sola instancia), y si Redis cae el sistema sigue sin caché.
* **Evidencias en S3 privado:** fotos, videos y PDF suben con URL prefirmada; solo los avatares y el catálogo de insumos son públicos. El resto se entrega firmado y con permiso.
* **Archivado a Parquet (DuckDB):** los datos históricos se mueven de PostgreSQL a archivos `.parquet` en S3 y se leen de forma transparente por rango de fechas. Está apagado por defecto (ver sección *Archivado histórico*).

---

## 📁 Estructura del Proyecto

```text
backend-easydry/
├── prisma/
│   ├── schema.prisma            # Modelos de BD (Usuarios, Roles, Servicios, Bahías, Insumos, Notification, Reto, DLQ, SyncDevice)
│   └── migrations/              # Migraciones SQL versionadas (una carpeta por cambio de esquema)
├── src/
│   ├── modules/
│   │   ├── auth/                # Login, Refresh, Estrategia JWT, Guards y Decoradores
│   │   ├── sync/                # Motor de Sincronización Offline (Push, Pull, Bootstrap, Media, DLQ)
│   │   ├── operaciones/         # Servicios de lavado (OT), bahías, recetas, consumo automático y evidencias
│   │   ├── inventario/          # Insumos (con categoría validada), presentaciones, stock por agencia y alertas
│   │   ├── catalogos/           # Servicios ofertados (GENERAL/ESPECIAL), categorías, recetas estándar
│   │   ├── agencias/            # Gestión de Regiones, Agencias, usuarios y alcance (GLOBAL/REGION/AGENCIA)
│   │   ├── maquinaria/          # Maquinaria, limpieza (con evidencia fotográfica), mantenimientos (todos preventivos) e incidentes
│   │   ├── analytics/           # Dashboards, consumo de químicos y ranking de lavadores (cantidad + tiempo promedio)
│   │   ├── notifications/       # Persistencia + Gateway WebSocket de notificaciones (8 eventos operativos)
│   │   ├── retos/                # Retos comerciales/operativos: creación, listado y cierre con ganador
│   │   ├── schedule/             # Cron jobs: recordatorios y escalamiento de limpieza, mantenimientos vencidos
│   │   ├── aprobaciones/         # Flujo de aprobación gerencial de servicios finalizados
│   │   ├── auditorias/           # Auditorías 5S e informes con adjuntos
│   │   ├── reportes/             # Reportes operativos (Excel/PDF) filtrados por ámbito, con generación en segundo plano
│   │   ├── storage/              # Tickets prefirmados de S3, privacidad de archivos y variantes (thumbs/view)
│   │   ├── archivado/            # Archivado de datos históricos a Parquet en S3 y lectura federada con DuckDB
│   │   └── roles/                # Catálogo de roles y capacidades (RBAC)
│   ├── common/                   # Decoradores de permisos, guards, utilidades de alcance y paginación compartida
│   ├── config/                   # Validaciones de variables de entorno
│   ├── app.module.ts             # Módulo raíz que orquesta los submódulos
│   └── main.ts                   # Bootstrap con Swagger, CORS, Global Validation Pipes y WebSocket Gateway
├── .env                         # Variables de entorno activas (ignorado por git)
├── .env.example                 # Plantilla de variables de entorno requeridas
├── .gitignore                   # Exclusión de node_modules, dist, .env y temporales
└── package.json                 # Dependencias y scripts de ejecución
```

---

## ⚙️ Configuración y Variables de Entorno

1. Copia la plantilla de variables de entorno:
   ```bash
   cp .env.example .env
   ```

2. Completa el `.env`. La plantilla `.env.example` documenta cada variable; estas son las que importan:

   | Grupo | Variables | Notas |
   |---|---|---|
   | Base de datos | `DATABASE_URL` | PostgreSQL. Con varias instancias fija `connection_limit` por instancia o usa PgBouncer. |
   | Redis (opcional) | `REDIS_URL`, `REDIS_PREFIX` | Vacío = memoria local de cada proceso. `docker compose up -d redis` lo levanta en local. |
   | Seguridad | `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`, `JWT_ACCESS_EXPIRATION`, `JWT_REFRESH_EXPIRATION` | **Obligatorias en producción**: el servidor no arranca sin ellas. Los valores de la plantilla son solo de desarrollo. |
   | Red | `PORT`, `NODE_ENV`, `CORS_ORIGIN`, `TRUST_PROXY`, `COOKIE_SAMESITE` | `CORS_ORIGIN` debe incluir el dominio del panel (también lo valida el WebSocket). El refresh token del navegador va en una cookie HttpOnly; con web y API en dominios distintos usa `COOKIE_SAMESITE=none` (HTTPS). |
   | Almacenamiento | `AWS_REGION`, `AWS_S3_BUCKET_NAME`, `AWS_S3_PUBLIC_URL_PREFIX`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT` | S3 es obligatorio (sin respaldo local). En AWS usa un IAM Role y deja vacías las dos claves. |
   | Seed | `SEED_SUPERADMIN_EMAIL/PASSWORD`, `SEED_ADMIN_EMAIL/PASSWORD` | Obligatorias, sin valores por defecto. Las contraseñas cumplen la política (10+ caracteres, mayúscula, minúscula, número y especial). |
   | Importación | `IMPORT_PASSWORD_INICIAL` | Contraseña inicial de los usuarios nuevos del Excel. |
   | Archivado | `ARCHIVADO_ACTIVO`, `ARCHIVADO_SIMULACRO` | Ver *Archivado histórico*. |
   | Swagger | `SWAGGER_ENABLED` | Apagado en producción salvo que se active a propósito. |

---

## 🛠️ Instalación y Puesta en Marcha

### 1. Instalar dependencias

> ⚠️ **Usa siempre `pnpm`.** Este monorepo usa `pnpm-workspace.yaml`; ejecutar `npm install` sobre un `node_modules` generado por pnpm corrompe el árbol de dependencias (confunde las carpetas `.pnpm` con el algoritmo de resolución de npm). Si esto ocurre, borra `node_modules` y reinstala con `pnpm install`.

```bash
pnpm install
```

### 2. Gestión de Base de Datos y Migraciones con Prisma

> ⚠️ **Regla de Oro en Producción & Trabajo en Equipo:**
> **NUNCA utilices `prisma db push` ni `prisma db pull`.**  
> - `db push` es un anti-patrón en entornos empresariales: elude la tabla de historial `_prisma_migrations`, no genera archivos SQL versionables y puede destruir o alterar columnas y datos en silencio.
> - `db pull` sobreescribe el archivo `schema.prisma` desde la base de datos, perdiendo configuraciones y nombres de relaciones definidos en el modelo.  
> **Todo cambio en el esquema debe ser trazable mediante migraciones SQL versionadas (`prisma migrate`).**

#### A. Aplicar migraciones existentes (Nueva instalación o Producción/CI)
Aplica todas las migraciones SQL pendientes del directorio `prisma/migrations/` en la base de datos:
```bash
# Aplicar migraciones pendientes
pnpm run prisma:deploy
# o directamente:
npx prisma migrate deploy

# Generar el cliente tipado de Prisma
pnpm run prisma:generate
# o directamente:
npx prisma generate
```

#### B. Sembrar roles y cuentas iniciales
El seed (`prisma/seed.ts`) es idempotente: no borra nada por defecto y solo crea lo que falta. Siembra los roles oficiales, las pantallas del sistema y **únicamente** las cuentas `SUPER_ADMIN` y `ADMIN`, con los correos y contraseñas del `.env` (`SEED_*`).
```bash
pnpm run prisma:seed
# o directamente:
npx prisma db seed
```
`SEED_ACTUALIZAR_ROLES=SI` restablece los permisos de los roles oficiales a los de fábrica; `SEED_RESET=SI` **vacía toda la base** (en producción exige además `SEED_CONFIRMAR_PRODUCCION=SI`).

Los demás usuarios (lavadores, pulidores, líderes, aprobadores, etc.) se cargan con el importador del Excel `DATOS AGENCIAS.xlsx` (`pnpm run prisma:import-agencias`, ver [USUARIOS-DEMO.md](../USUARIOS-DEMO.md)) o se crean desde el módulo **Usuarios** de la web.

#### C. Datos de prueba (solo desarrollo local)
`pnpm run seed:demo` genera datos operativos de prueba. Además, `pnpm run seed:retos-demo`: crea/reutiliza un reto de agencias y uno de pulidores, con órdenes sintéticas finalizadas del mes actual. El script es idempotente y solo actualiza registros con IDs/OT `DEMO-RETO`; no borra datos operativos.
```bash
pnpm run seed:retos-demo
```

#### D. Crear una nueva migración (Durante el desarrollo de nuevas entidades)
Cuando agregues o modifiques modelos en `prisma/schema.prisma`:
```bash
# Genera el archivo SQL en prisma/migrations/<timestamp>_<nombre>/ y lo aplica localmente
npx prisma migrate dev --name <nombre_descriptivo_del_cambio>
```

> ⚠️ **Si tu base de datos local tiene drift de esquema** (columnas o tablas creadas manualmente o con `db push` antes de existir su migración), `migrate dev` detectará la diferencia y **propondrá resetear toda la base de datos**, borrando los datos. Si ves esa advertencia, **no confirmes el reset**: en su lugar escribe el archivo `migration.sql` a mano dentro de `prisma/migrations/<timestamp>_<nombre>/` (copiando la sintaxis de una migración reciente) y aplícalo con `pnpm run prisma:deploy`, que solo ejecuta migraciones pendientes sin comparar ni resetear el esquema.

#### E. Comandos útiles de auditoría y base de datos
| Comando | Descripción |
|---|---|
| `pnpm run prisma:status` | Revisa si existen migraciones pendientes de aplicar o si la BD está al día. |
| `pnpm run prisma:studio` | Abre Prisma Studio en `http://localhost:5555` para auditar datos en interfaz web. |
| `pnpm run prisma:generate` | Regenera `@prisma/client` tras cambios de tipos. |

### 3. Ejecutar el Servidor
```bash
# Modo desarrollo con auto-reload (watch)
pnpm run start:dev

# Modo producción
pnpm run build
pnpm run start:prod
```

El servidor iniciará en: **`http://localhost:3000/api/v1`**  
Documentación Swagger interactiva: **`http://localhost:3000/api/docs`**

---

## 📡 Mapeo de Endpoints de Sincronización Offline (`/sync`)

Todos los endpoints requieren autenticación con `Bearer Token`:

| Método | Endpoint | Descripción |
|---|---|---|
| `POST` | `/api/v1/sync/bootstrap` | Descarga de catálogos, recetas de insumos, bahías activas y datos del usuario para inicializar el SQLite local del móvil. |
| `POST` | `/api/v1/sync/push` *(alias `/sync/operations`)* | Ingesta granular de mutaciones offline (`CREATE`, `UPDATE`, `COMPLETE`) con idempotencia por `clientUuid`, telemetría de dispositivo y resolución de conflictos. |
| `POST` | `/api/v1/sync/pull` *(alias `/sync/delta`)* | Descarga incremental de órdenes modificadas con ventana `safeSince` (5 segundos de solapamiento) y scoping por agencia/región del operador. |
| `POST` | `/api/v1/sync/media/presigned-url` *(alias `/media/ticket`)* | Emite tickets de subida binaria para fotos de evidencia (`FOTO_INGRESO`, `FOTO_SALIDA`) sin saturar los JSON de sincronización. |
| `POST` | `/api/v1/sync/media/confirm` | Confirma la subida de imagen y la vincula a la orden de trabajo (`fotoIngresoUrl` / `fotoSalidaUrl`). |
| `POST` | `/api/v1/sync/dlq/list` | Lista las mutaciones tóxicas en cuarentena (Dead-Letter Queue) para soporte y auditoría. |
| `POST` | `/api/v1/sync/dlq/resolve` | Marca mutaciones de la DLQ como resueltas tras remediación manual o técnica. |

---

## 🔔 Notificaciones en Tiempo Real (`/notifications`)

Sistema de notificaciones respaldado en PostgreSQL (tabla `Notification`) y empujado a la web por WebSocket:

| Método / Canal | Endpoint / Evento | Descripción |
|---|---|---|
| `POST` | `/api/v1/notifications/list` | Historial paginado de notificaciones propias, más recientes primero. |
| `POST` | `/api/v1/notifications/resumen` | Cantidad de notificaciones sin leer (badge de la campanita). |
| `POST` | `/api/v1/notifications/marcar-leida` | Marca una notificación puntual como leída. |
| `POST` | `/api/v1/notifications/marcar-todas-leidas` | Marca todas las notificaciones propias como leídas. |
| `WebSocket` | `ws://localhost:3000/notifications` (namespace `/notifications`) | El cliente envía el JWT en `handshake.auth.token`; el servidor valida origen, token, usuario activo y sesión no revocada, y empuja `notification:new` solo a los sockets del destinatario. |

El envío es *fire-and-forget*: si falla (por ejemplo, el socket ya no está conectado) solo se registra una advertencia en el log. Con `REDIS_URL` configurado, el adaptador de Redis reparte los eventos entre todas las instancias del backend.

---

## 🗄️ Archivado histórico (Parquet + DuckDB)

Los datos viejos se mueven de PostgreSQL a `archivo-historico/<tabla>/anio=YYYY/mes=MM/part-000N.parquet` en S3: se sube, se verifica conteo y checksum y solo entonces se borra de la base. Lo archivado es inmutable y las búsquedas por rango de fechas lo leen de forma transparente (base primero, archivo después). Las evidencias (fotos y videos) no se mueven; se manejan con reglas de ciclo de vida de S3 (`infra/`).

* La corrida es semanal (domingo 03:00) y está **apagada por defecto**: `ARCHIVADO_ACTIVO=true` la enciende y `ARCHIVADO_SIMULACRO=false` hace que suba y borre de verdad (por defecto solo informa qué haría).
* **Antes de la primera corrida real, haz un respaldo completo de la base.**

---

## 🧪 Pruebas Automatizadas

Suite de pruebas unitarias/integración con [Vitest](https://vitest.dev/), de integración contra la base local: cada archivo crea sus propios datos con una marca única (`test/integracion/entorno.ts`) y los borra al terminar; solo se simulan los bordes externos (S3, sockets, reloj). Ver `MANUAL-BACKEND-COMPLETO.md` §14: cubre autenticación, scoping RBAC por rol/alcance, reglas de negocio de operaciones (OT), stock, maquinaria/limpieza, notificaciones, analítica y retos.

```bash
pnpm test
```

---

## 👥 Cuentas y primer acceso

El sistema **no trae usuarios ni contraseñas de ejemplo**. Las cuentas salen del seed (Super Admin y Admin), del importador del Excel o del módulo Usuarios de la web. Consulta [USUARIOS-DEMO.md](../USUARIOS-DEMO.md) para el detalle de los tres caminos y [FUNCIONALIDAD-POR-ROL.md](../FUNCIONALIDAD-POR-ROL.md) para lo que puede hacer cada rol.

---

## 📄 Licencia

Propiedad exclusiva de **EasyDry® 2026**. Todos los derechos reservados.
