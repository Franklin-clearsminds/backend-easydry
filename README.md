# EasyDry® — Backend API Gateway & Offline Sync Engine

> **Plataforma Integral de Gestión y Control Operativo para Centros de Lavado Automotriz Ecológico.**  
> Backend empresarial desarrollado con **NestJS 10**, **TypeScript**, **Prisma ORM**, **PostgreSQL** y arquitectura **100% POST** con soporte para **Sincronización Offline Industrial**.

---

## 🚀 Tecnologías y Arquitectura

* **Framework:** [NestJS 10](https://nestjs.com/) (Modular, Inyección de Dependencias, Decoradores tipados).
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

---

## 📁 Estructura del Proyecto

```text
backend-easydry/
├── prisma/
│   └── schema.prisma            # Modelos de BD (Usuarios, Roles, Servicios, Bahías, Insumos, DLQ, SyncDevice)
├── src/
│   ├── modules/
│   │   ├── auth/                # Login, Refresh, Estrategia JWT, Guards y Decoradores
│   │   ├── sync/                # Motor de Sincronización Offline (Push, Pull, Bootstrap, Media, DLQ)
│   │   ├── operaciones/         # Servicios de lavado, bahías, recetas y consumo automático
│   │   ├── inventario/          # Insumos, stock por agencia, transferencias y alertas
│   │   ├── catalogos/           # Servicios ofertados, categorías, recetas estándar
│   │   ├── sedes/               # Gestión de Regiones y Agencias
│   │   ├── maquinaria/          # Registro de máquinas, mantenimientos preventivos y correctivos
│   │   └── usuarios/            # CRUD de usuarios y asignación de roles
│   ├── config/                  # Validaciones de variables de entorno
│   ├── app.module.ts            # Módulo raíz que orquesta los submódulos
│   └── main.ts                  # Bootstrap con Swagger, CORS y Global Validation Pipes
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
```bash
pnpm install
# o con npm:
npm install
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

#### C. Crear una nueva migración (Durante el desarrollo de nuevas entidades)
Cuando agregues o modifiques modelos en `prisma/schema.prisma`:
```bash
# Genera el archivo SQL en prisma/migrations/<timestamp>_<nombre>/ y lo aplica localmente
npx prisma migrate dev --name <nombre_descriptivo_del_cambio>
```

#### D. Comandos útiles de auditoría y base de datos
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

## 🧪 Pruebas Automatizadas

El proyecto cuenta con suites de validación que prueban el flujo completo (autenticación, scoping RBAC, stock y sincronización offline endurecida):

```bash
# Ejecutar prueba integral de sincronización offline (Idempotencia, DLQ, Conflictos y Presigned Media):
powershell -ExecutionPolicy Bypass -File "../scratch/test_hardened_sync.ps1"
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
