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
* **Notificaciones en Tiempo Real:** Gateway WebSocket (`@nestjs/websockets` + `socket.io`) con autenticación por JWT en el handshake, respaldado por persistencia en PostgreSQL (`Notification`). Cubre 8 eventos operativos (limpiezas pendientes/atrasadas de maquinaria, mantenimientos vencidos, etc.), con envío "fire-and-forget" que nunca bloquea ni revienta la operación principal si falla.

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
│   │   ├── maquinaria/          # Maquinaria, limpieza (con evidencia fotográfica), mantenimientos e incidentes
│   │   ├── analytics/           # Dashboards, consumo de químicos y ranking de lavadores (cantidad + tiempo promedio)
│   │   ├── notifications/       # Persistencia + Gateway WebSocket de notificaciones (8 eventos operativos)
│   │   ├── retos/                # Retos comerciales/operativos: creación, listado y cierre con ganador
│   │   ├── schedule/             # Cron jobs: recordatorios y escalamiento de limpieza, mantenimientos vencidos
│   │   ├── aprobaciones/         # Flujo de aprobación gerencial de servicios finalizados
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

2. Configura los valores correspondientes en tu archivo `.env`:
   ```env
   # Base de Datos Central (PostgreSQL)
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/easydry_db?schema=public"

   # Seguridad y Autenticación JWT
   JWT_SECRET="EasyDrySecretKey2026*OfflineSync"
   JWT_ACCESS_EXPIRATION="1h"
   JWT_REFRESH_SECRET="EasyDryRefreshSecretKey2026*OfflineSync"
   JWT_REFRESH_EXPIRATION="15d"

   # Clave de Cifrado AES-256-CBC (Exactamente 32 bytes)
   ENCRYPTION_KEY="EasyDrySecretKey2026*OfflineSync32B"

   # Configuración de Red y Servidor
   PORT=3000
   NODE_ENV="development"
   CORS_ORIGIN="http://localhost:5173,http://localhost:8081,http://localhost:19006,exp://"
   UPLOAD_DIR="./uploads"
   MAX_FILE_SIZE_MB=10
   ```

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

#### B. Poblar catálogos maestros y usuarios demo
```bash
pnpm run prisma:seed
# o directamente:
npx prisma db seed
```

#### C. Crear retos y órdenes de prueba
Solo para desarrollo local: crea/reutiliza un reto de agencias y uno de pulidores, con órdenes sintéticas finalizadas del mes actual. El script es idempotente y solo actualiza registros con IDs/OT `DEMO-RETO`; no borra datos operativos.
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

Sistema de notificaciones respaldado en PostgreSQL (tabla `Notification`) y empujado al cliente por WebSocket:

| Método / Canal | Endpoint / Evento | Descripción |
|---|---|---|
| `POST` | `/api/v1/notifications/list` | Historial paginado de notificaciones propias del usuario autenticado, más recientes primero. |
| `POST` | `/api/v1/notifications/resumen` | Cantidad de notificaciones sin leer (badge de la campanita). |
| `POST` | `/api/v1/notifications/marcar-leida` | Marca una notificación puntual como leída. |
| `POST` | `/api/v1/notifications/marcar-todas-leidas` | Marca todas las notificaciones propias como leídas. |
| `WebSocket` | `ws://localhost:3000` (namespace raíz) | El cliente se conecta enviando el JWT en `handshake.auth.token`; el servidor valida la sesión igual que el `JwtStrategy` HTTP y empuja el evento `notification:new` al socket del usuario destinatario en tiempo real. |

Eventos cubiertos: limpieza de maquinaria pendiente del día, limpieza atrasada (con escalamiento único a quien audita la agencia), mantenimiento de maquinaria vencido, y otros hitos operativos del flujo de servicios. El envío es *fire-and-forget*: si falla (ej. el socket ya no está conectado), solo se registra una advertencia en el log — nunca interrumpe la operación que la originó.

---

## 🧪 Pruebas Automatizadas

Suite de pruebas unitarias/integración con [Vitest](https://vitest.dev/), usando un cliente Prisma mockeado por módulo (patrón `armar()`): cubre autenticación, scoping RBAC por rol/alcance, reglas de negocio de operaciones (OT), stock, maquinaria/limpieza, notificaciones, analítica y retos.

```bash
pnpm test
```

---

## 👥 Usuarios Demo Oficiales

Todas las cuentas demo utilizan la contraseña unificada: **`Admin123*`**

| Rol | Correo Corporativo | Alcance Operativo |
|---|---|---|
| **Super Administrador** | `superadmin@easydry.com` | Red Nacional Global (Inmutable) |
| **Administrador** | `admin@easydry.com` | Red Nacional Global |
| **Líder de Agencia** | `operador.bahia01@easydry.com` | EasyDry Quito Norte |
| **Supervisor Regional** | `supervisor.costa@easydry.com` | Región Costa |
| **Aprobador** | `gerente.norte@easydry.com` | EasyDry Quito Norte |
| **Coordinador Bodega** | `distribuidor@easydry.com` | Bodega Central |
| **Técnico Maquinaria** | `tecnico@easydry.com` | Taller Central Nacional |

> Para consultar el detalle completo de los 14 roles del sistema, revisa el archivo [USUARIOS-DEMO.md](../USUARIOS-DEMO.md).

---

## 📄 Licencia

Propiedad exclusiva de **EasyDry® 2026**. Todos los derechos reservados.
