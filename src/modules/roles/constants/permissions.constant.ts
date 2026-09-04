export interface SystemPermission {
  codigo: string;
  nombre: string;
  descripcion: string;
  grupo: string;
}

export const OFFICIAL_PERMISSIONS: SystemPermission[] = [
  {
    codigo: 'dashboard',
    nombre: 'Dashboard Principal',
    descripcion: 'Métricas clave, KPIs generales, gráficos de rendimiento y alertas',
    grupo: 'Panel Principal',
  },
  {
    codigo: 'mapa-operativo',
    nombre: 'Mapa Operativo en Vivo',
    descripcion: 'Trazabilidad visual: Sucursales, Bahías, Operadores y Maquinaria',
    grupo: 'Panel Principal',
  },
  {
    codigo: 'notificaciones',
    nombre: 'Centro de Notificaciones',
    descripcion: 'Alertas operativas, aprobaciones pendientes y avisos',
    grupo: 'Panel Principal',
  },
  {
    codigo: 'sucursales',
    nombre: 'Control de Sucursales',
    descripcion: 'Gestión y estado operativo de las agencias de la red',
    grupo: 'Operación & Sucursales',
  },
  {
    codigo: 'operadores',
    nombre: 'Operadores de Bahía',
    descripcion: 'Directorio, métricas y estado del personal operativo',
    grupo: 'Operación & Sucursales',
  },
  {
    codigo: 'asignaciones',
    nombre: 'Asignación de Bahías',
    descripcion: 'Matriz dinámica para asignar operadores a bahías',
    grupo: 'Operación & Sucursales',
  },
  {
    codigo: 'configuracion/servicios',
    nombre: 'Catálogo de Servicios',
    descripcion: 'Tarifario, tipos de lavado y políticas de evidencias',
    grupo: 'Servicios de Lavado',
  },
  {
    codigo: 'servicios',
    nombre: 'Servicios de Lavado (OT)',
    descripcion: 'Digitalización de Hoja de Control, ingreso de placas y registro',
    grupo: 'Servicios de Lavado',
  },
  {
    codigo: 'aprobaciones',
    nombre: 'Aprobaciones y Cierre Diario',
    descripcion: 'Auditoría gerencial de evidencias y aprobación de servicios',
    grupo: 'Servicios de Lavado',
  },
  {
    codigo: 'productividad',
    nombre: 'Productividad & Reto EasyDry',
    descripcion: 'Comparativa de agencias y ranking de operarios',
    grupo: 'Servicios de Lavado',
  },
  {
    codigo: 'mi-bahia',
    nombre: 'Mi Bahía (Área Operador)',
    descripcion: 'Panel rápido optimizado para el operario asignado',
    grupo: 'Servicios de Lavado',
  },
  {
    codigo: 'maquinaria',
    nombre: 'Maquinaria & Equipos',
    descripcion: 'Inventario de activos industriales y trazabilidad',
    grupo: 'Gestión de Activos',
  },
  {
    codigo: 'taller-tecnico',
    nombre: 'Taller Técnico e Incidentes',
    descripcion: 'Mantenimientos preventivos y reporte de incidencias',
    grupo: 'Gestión de Activos',
  },
  {
    codigo: 'inventario',
    nombre: 'Inventario de Insumos & Bodega',
    descripcion: 'Control de stock central vs sucursales, envases y transferencias',
    grupo: 'Gestión de Activos',
  },
  {
    codigo: 'reportes',
    nombre: 'Reportes Operativos',
    descripcion: 'Generación de informes consolidados de servicios y rendimiento',
    grupo: 'Administración',
  },
  {
    codigo: 'usuarios',
    nombre: 'Usuarios, Roles y Permisos',
    descripcion: 'Directorio de colaboradores y matriz de configuración de roles',
    grupo: 'Administración',
  },
  {
    codigo: 'configuracion',
    nombre: 'Configuración General',
    descripcion: 'Ajustes globales de la plataforma y parámetros de sincronización',
    grupo: 'Administración',
  },
  {
    codigo: 'perfil',
    nombre: 'Mi Perfil de Usuario',
    descripcion: 'Información personal, credenciales y datos de sucursal',
    grupo: 'Mi Cuenta',
  },
];

export const OFFICIAL_PERMISSION_CODES = OFFICIAL_PERMISSIONS.map((p) => p.codigo);
