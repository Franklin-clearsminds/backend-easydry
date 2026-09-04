import { PrismaClient, ServiceStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed de base de datos EasyDry...');

  const passwordHash = await bcrypt.hash('Admin123*', 10);

  // 1. Crear Regiones Oficiales (id, codigo, nombre, estado: 1)
  console.log('🗺️ Creando regiones oficiales...');
  const regionesData = [
    { codigo: 'REG-SIERRA', nombre: 'Sierra', descripcion: 'Clúster Sierra Centro y Norte (Pichincha, Imbabura, Tungurahua)', estado: 1 },
    { codigo: 'REG-COSTA',  nombre: 'Costa',  descripcion: 'Clúster Costa y Litoral (Guayas, Manabí, El Oro)', estado: 1 },
    { codigo: 'REG-AUSTRO', nombre: 'Austro', descripcion: 'Clúster Austro y Sur (Azuay, Loja, Cañar)', estado: 1 },
  ];

  const regionesMap = new Map<string, string>();
  for (const r of regionesData) {
    const reg = await prisma.region.upsert({
      where: { codigo: r.codigo },
      update: { nombre: r.nombre, descripcion: r.descripcion, estado: r.estado },
      create: r,
    });
    regionesMap.set(r.codigo, reg.id);
  }

  // 2. Crear Marcas (id, nombre, estado: 0 | 1)
  console.log('🏷️ Creando marcas oficiales...');
  const marcasData = [
    { nombre: 'EasyDry Oficial', estado: 1 },
    { nombre: 'EasyDry Franchise Express', estado: 1 },
    { nombre: 'EasyDry Detailing Studio', estado: 1 },
    { nombre: 'EasyDry Green Eco', estado: 0 }, // Ejemplo marca inactiva
  ];

  const marcasMap = new Map<string, string>();
  for (const m of marcasData) {
    const marca = await prisma.marca.upsert({
      where: { nombre: m.nombre },
      update: { estado: m.estado },
      create: m,
    });
    marcasMap.set(m.nombre, marca.id);
  }

  // 3. Crear Agencias Maestras vinculadas a Marca y Región
  console.log('📍 Creando agencias...');
  const marcaOficialId = marcasMap.get('EasyDry Oficial')!;
  const marcaStudioId  = marcasMap.get('EasyDry Detailing Studio')!;
  const regSierraId    = regionesMap.get('REG-SIERRA')!;
  const regCostaId     = regionesMap.get('REG-COSTA')!;

  const agenciasData = [
    { codigo: 'SUC-CORP', nombre: 'EasyDry Corporativo Nacional', region: 'Sierra', regionId: regSierraId, direccion: 'Av. República y Amazonas, Edif. Corporativo', telefono: '022345678', email: 'corp@easydry.com', numeroBahias: 2, estado: 1, marcaId: marcaOficialId },
    { codigo: 'SUC-QNOR', nombre: 'EasyDry Quito Norte', region: 'Sierra', regionId: regSierraId, direccion: 'Av. Galo Plaza Lasso y Capitán Borja', telefono: '022456789', email: 'norte@easydry.com', numeroBahias: 4, estado: 1, marcaId: marcaOficialId },
    { codigo: 'SUC-QSUR', nombre: 'EasyDry Quito Sur', region: 'Sierra', regionId: regSierraId, direccion: 'Av. Maldonado y Morán Valverde', telefono: '022567890', email: 'sur@easydry.com', numeroBahias: 3, estado: 1, marcaId: marcaOficialId },
    { codigo: 'SUC-CUMB', nombre: 'EasyDry Cumbayá', region: 'Sierra', regionId: regSierraId, direccion: 'Av. Interoceánica Km 12', telefono: '022678901', email: 'cumbaya@easydry.com', numeroBahias: 2, estado: 1, marcaId: marcaStudioId },
    { codigo: 'SUC-GYE1', nombre: 'EasyDry Guayaquil (Costa)', region: 'Costa', regionId: regCostaId, direccion: 'Av. Juan Tanca Marengo Km 2.5', telefono: '042789012', email: 'costa@easydry.com', numeroBahias: 4, estado: 1, marcaId: marcaOficialId },
    { codigo: 'SUC-MNT1', nombre: 'Taller Central Nacional', region: 'Sierra', regionId: regSierraId, direccion: 'Parque Industrial Sur', telefono: '022890123', email: 'taller@easydry.com', numeroBahias: 2, estado: 1, marcaId: marcaOficialId },
    { codigo: 'SUC-BOD1', nombre: 'Bodega Central EasyDry', region: 'Sierra', regionId: regSierraId, direccion: 'Centro Logístico Pifo', telefono: '022901234', email: 'bodega@easydry.com', numeroBahias: 1, estado: 1, marcaId: marcaOficialId },
  ];

  const agenciasMap = new Map<string, string>();
  for (const a of agenciasData) {
    const agencia = await prisma.agencia.upsert({
      where: { codigo: a.codigo },
      update: {
        nombre: a.nombre,
        region: a.region,
        regionId: a.regionId,
        direccion: a.direccion,
        telefono: a.telefono,
        email: a.email,
        numeroBahias: a.numeroBahias,
        estado: a.estado,
        marcaId: a.marcaId,
      },
      create: a,
    });
    agenciasMap.set(a.codigo, agencia.id);
  }

  // 4. Crear Bahías Operativas
  console.log('🚿 Creando bahías operativas...');
  const quitoNorteId = agenciasMap.get('SUC-QNOR')!;
  const guayaquilId = agenciasMap.get('SUC-GYE1')!;

  const bahiasData = [
    { codigo: 'QNOR-B01', nombre: 'Bahía 01 - Lavado Express', agenciaId: quitoNorteId },
    { codigo: 'QNOR-B02', nombre: 'Bahía 02 - Lavado Completo', agenciaId: quitoNorteId },
    { codigo: 'QNOR-B03', nombre: 'Bahía 03 - Detallado & Acabados', agenciaId: quitoNorteId },
    { codigo: 'GYE1-B01', nombre: 'Bahía 01 - Costa Express', agenciaId: guayaquilId },
    { codigo: 'GYE1-B02', nombre: 'Bahía 02 - Costa Detallado', agenciaId: guayaquilId },
  ];

  const bahiasMap = new Map<string, string>();
  for (const b of bahiasData) {
    const bahia = await prisma.bahia.upsert({
      where: { codigo: b.codigo },
      update: { nombre: b.nombre, agenciaId: b.agenciaId },
      create: b,
    });
    bahiasMap.set(b.codigo, bahia.id);
  }

  // 5. Crear Catálogo de Servicios
  console.log('📋 Creando catálogo de servicios...');
  const catalogoData = [
    { codigo: 'SER-001', nombre: 'Lavado Express Ecológico', categoria: 'GENERAL', descripcion: 'Lavado exterior en seco con cera bio-protectora y aspirado rápido.', precio: 12.0, tiempoEstimadoMin: 25 },
    { codigo: 'SER-002', nombre: 'Lavado Completo + Encerado', categoria: 'GENERAL', descripcion: 'Lavado profundo de carrocería, limpieza de aros, aspirado total e hidratación de plásticos.', precio: 22.0, tiempoEstimadoMin: 45 },
    { codigo: 'SER-003', nombre: 'Desinfección & Limpieza Interior', categoria: 'ESPECIAL', descripcion: 'Desinfección de tapicería con vapor ecológico y ozonificación antibacteriana.', precio: 35.0, tiempoEstimadoMin: 60 },
    { codigo: 'SER-004', nombre: 'Pulido y Corrección de Pintura', categoria: 'ESPECIAL', descripcion: 'Eliminación de micro-rayones y hologramas con pulidoras orbitales.', precio: 75.0, tiempoEstimadoMin: 120 },
    { codigo: 'SER-005', nombre: 'Tratamiento Cerámico Nanotecnológico', categoria: 'ESPECIAL', descripcion: 'Protección cerámica 9H hidrofóbica de larga duración contra rayos UV y lluvia ácida.', precio: 120.0, tiempoEstimadoMin: 180 },
  ];

  for (const c of catalogoData) {
    await prisma.catalogoServicio.upsert({
      where: { codigo: c.codigo },
      update: { nombre: c.nombre, categoria: c.categoria, descripcion: c.descripcion, precio: c.precio, tiempoEstimadoMin: c.tiempoEstimadoMin },
      create: c,
    });
  }

  // 6. Crear Roles Oficiales en la tabla Role
  console.log('🛡️ Creando roles en la tabla Role...');
  const rolesData = [
    { namerol: 'SUPER_ADMIN', estado: 1, permisos: ['dashboard', 'usuarios', 'sucursales', 'agencias', 'regiones', 'operadores', 'servicios', 'maquinaria', 'inventario', 'reportes', 'configuracion'] },
    { namerol: 'ADMIN', estado: 1, permisos: ['dashboard', 'usuarios', 'sucursales', 'agencias', 'regiones', 'operadores', 'servicios', 'maquinaria', 'inventario', 'reportes'] },
    { namerol: 'APROBADOR', estado: 1, permisos: ['dashboard', 'notificaciones', 'servicios', 'aprobaciones', 'reportes', 'sync'] },
    { namerol: 'SUPERVISOR', estado: 1, permisos: ['dashboard', 'notificaciones', 'mapa-operativo', 'sucursales', 'agencias', 'regiones', 'operadores', 'asignaciones', 'servicios', 'productividad', 'maquinaria', 'inventario', 'reportes', 'sync'] },
    { namerol: 'COORD_MANTENIMIENTO', estado: 1, permisos: ['dashboard', 'maquinaria', 'taller-tecnico', 'inventario', 'sync'] },
    { namerol: 'TECNICO', estado: 1, permisos: ['dashboard', 'maquinaria', 'taller-tecnico', 'inventario', 'sync'] },
    { namerol: 'LIDER_AGENCIA', estado: 1, permisos: ['servicios', 'bahias', 'maquinaria', 'taller-tecnico', 'inventario', 'sync'] },
    { namerol: 'JEFE_COMERCIAL', estado: 1, permisos: ['dashboard', 'sucursales', 'agencias', 'regiones', 'reportes', 'retos', 'notificaciones'] },
    { namerol: 'COORD_COMERCIAL', estado: 1, permisos: ['dashboard', 'sucursales', 'agencias', 'regiones', 'reportes', 'retos', 'notificaciones'] },
    { namerol: 'COORD_SERVICIOS_ESPECIALES', estado: 1, permisos: ['servicios', 'pulidores', 'agenda', 'sync'] },
    { namerol: 'PULIDOR_FIJO', estado: 1, permisos: ['servicios', 'bahias', 'inventario', 'sync'] },
    { namerol: 'PULIDOR_MOVIL', estado: 1, permisos: ['servicios', 'bahias', 'inventario', 'sync'] },
    { namerol: 'COORD_BODEGA', estado: 1, permisos: ['dashboard', 'inventario', 'bodega', 'notificaciones', 'reportes', 'sync'] },
    { namerol: 'ASISTENTE_BODEGA', estado: 1, permisos: ['inventario', 'bodega', 'notificaciones', 'sync'] },
  ];

  const rolesMap = new Map<string, string>();
  for (const r of rolesData) {
    const role = await prisma.role.upsert({
      where: { namerol: r.namerol },
      update: { estado: r.estado, permisos: r.permisos },
      create: { namerol: r.namerol, estado: r.estado, permisos: r.permisos },
    });
    rolesMap.set(r.namerol, role.id);
  }

  // Eliminar cualquier rol obsoleto que no esté en la lista oficial
  await prisma.role.deleteMany({
    where: { namerol: { notIn: rolesData.map((r) => r.namerol) } },
  });

  // 7. Crear Usuarios Demo Oficiales con Agencias y Regiones asignadas
  console.log('👥 Creando usuarios demo...');
  const usersData = [
    { email: 'superadmin@easydry.com', name: 'Carlos', lastname: 'Mendoza', roleNamerol: 'SUPER_ADMIN', agenciaCodigo: 'SUC-CORP', agenciasCodigos: ['SUC-CORP', 'SUC-QNOR', 'SUC-QSUR', 'SUC-CUMB', 'SUC-GYE1'], regionCodigo: null },
    { email: 'admin@easydry.com', name: 'Administrador', lastname: 'Easy Dry', roleNamerol: 'ADMIN', agenciaCodigo: 'SUC-CORP', agenciasCodigos: ['SUC-CORP', 'SUC-QNOR', 'SUC-QSUR', 'SUC-CUMB', 'SUC-GYE1'], regionCodigo: null },
    { email: 'gerente.norte@easydry.com', name: 'Roberto', lastname: 'Gómez', roleNamerol: 'APROBADOR', agenciaCodigo: 'SUC-QNOR', agenciasCodigos: ['SUC-QNOR', 'SUC-CUMB'], regionCodigo: 'REG-SIERRA' },
    { email: 'supervisor.costa@easydry.com', name: 'María', lastname: 'Viteri', roleNamerol: 'SUPERVISOR', agenciaCodigo: 'SUC-GYE1', agenciasCodigos: ['SUC-GYE1'], regionCodigo: 'REG-COSTA' },
    { email: 'mantenimiento@easydry.com', name: 'Fernando', lastname: 'Paredes', roleNamerol: 'COORD_MANTENIMIENTO', agenciaCodigo: 'SUC-MNT1', agenciasCodigos: ['SUC-MNT1'], regionCodigo: 'REG-SIERRA' },
    { email: 'tecnico@easydry.com', name: 'Técnico', lastname: 'Maquinaria', roleNamerol: 'TECNICO', agenciaCodigo: 'SUC-MNT1', agenciasCodigos: ['SUC-MNT1'], regionCodigo: 'REG-SIERRA' },
    { email: 'operador.bahia01@easydry.com', name: 'Andrés', lastname: 'Pérez', roleNamerol: 'LIDER_AGENCIA', agenciaCodigo: 'SUC-QNOR', agenciasCodigos: ['SUC-QNOR'], regionCodigo: 'REG-SIERRA' },
    { email: 'jefe.comercial@easydry.com', name: 'Patricia', lastname: 'Salazar', roleNamerol: 'JEFE_COMERCIAL', agenciaCodigo: 'SUC-CORP', agenciasCodigos: ['SUC-CORP', 'SUC-QNOR', 'SUC-QSUR', 'SUC-CUMB', 'SUC-GYE1'], regionCodigo: null },
    { email: 'comercial@easydry.com', name: 'Valeria', lastname: 'Castillo', roleNamerol: 'COORD_COMERCIAL', agenciaCodigo: 'SUC-QNOR', agenciasCodigos: ['SUC-QNOR', 'SUC-QSUR', 'SUC-CUMB'], regionCodigo: 'REG-SIERRA' },
    { email: 'especiales@easydry.com', name: 'Javier', lastname: 'Morales', roleNamerol: 'COORD_SERVICIOS_ESPECIALES', agenciaCodigo: 'SUC-CORP', agenciasCodigos: ['SUC-CORP', 'SUC-QNOR'], regionCodigo: null },
    { email: 'operador.especial@easydry.com', name: 'Marco', lastname: 'Sánchez', roleNamerol: 'PULIDOR_MOVIL', agenciaCodigo: 'SUC-QNOR', agenciasCodigos: ['SUC-CORP', 'SUC-QNOR', 'SUC-QSUR', 'SUC-CUMB', 'SUC-GYE1'], regionCodigo: 'REG-SIERRA' },
    { email: 'operador.pulido.norte@easydry.com', name: 'Diego', lastname: 'Pulido', roleNamerol: 'PULIDOR_FIJO', agenciaCodigo: 'SUC-QNOR', agenciasCodigos: ['SUC-QNOR'], regionCodigo: 'REG-SIERRA' },
    { email: 'distribuidor@easydry.com', name: 'Gonzalo', lastname: 'Almeida', roleNamerol: 'COORD_BODEGA', agenciaCodigo: 'SUC-BOD1', agenciasCodigos: ['SUC-BOD1'], regionCodigo: 'REG-SIERRA' },
    { email: 'asistente.bodega@easydry.com', name: 'Luis', lastname: 'Torres', roleNamerol: 'ASISTENTE_BODEGA', agenciaCodigo: 'SUC-BOD1', agenciasCodigos: ['SUC-BOD1'], regionCodigo: 'REG-SIERRA' },
  ];

  const createdUsers = new Map<string, string>();
  for (const u of usersData) {
    const agenciaId = u.agenciaCodigo ? agenciasMap.get(u.agenciaCodigo) ?? null : null;
    const agenciasIds = u.agenciasCodigos.map((code) => agenciasMap.get(code)).filter((id): id is string => Boolean(id));
    const regionId = u.regionCodigo ? regionesMap.get(u.regionCodigo) ?? null : null;
    const roleId = rolesMap.get(u.roleNamerol)!;

    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {
        name: u.name,
        lastname: u.lastname,
        roleId,
        passwordHash,
        agenciaId,
        agenciasIds,
        regionId,
        estado: 1,
      },
      create: {
        email: u.email,
        name: u.name,
        lastname: u.lastname,
        roleId,
        passwordHash,
        agenciaId,
        agenciasIds,
        regionId,
        estado: 1,
      },
    });
    createdUsers.set(u.email, user.id);
  }

  // 8. Crear Orden de Lavado Inicial de Demostración
  console.log('🚗 Creando orden de lavado de demostración...');
  const operadorId = createdUsers.get('operador.bahia01@easydry.com')!;
  const bahiaId = bahiasMap.get('QNOR-B01')!;
  const catExpress = await prisma.catalogoServicio.findUnique({ where: { codigo: 'SER-001' } });

  if (catExpress) {
    await prisma.servicioLavado.upsert({
      where: { clientUuid: 'demo-uuid-in-progress-001' },
      update: {},
      create: {
        clientUuid: 'demo-uuid-in-progress-001',
        placa: 'PBX-8921',
        modelo: 'Chevrolet D-Max 4x4',
        color: 'Gris Plata',
        cliente: 'Corporación Favorita',
        estado: ServiceStatus.EN_PROCESO,
        bahiaId,
        servicioCatalogoId: catExpress.id,
        operadorId,
        observaciones: 'Vehículo con polvo de obra en guardafangos.',
        horaIngreso: new Date(),
        horaInicio: new Date(),
      },
    });
  }

  // 9. Crear Tipos de Envase Paramétricos
  console.log('📦 Creando catálogo de tipos de envase...');
  const envasesData = [
    { codigo: 'CAN-20L', nombre: 'Caneca 20 Litros', descripcion: 'Caneca plástica industrial para químicos a granel', capacidad: 20.0, unidadBase: 'L' },
    { codigo: 'GAL-3.78L', nombre: 'Galón 3.785 L', descripcion: 'Galón estándar de polietileno', capacidad: 3.785, unidadBase: 'L' },
    { codigo: 'BID-10L', nombre: 'Bidón 10 Litros', descripcion: 'Bidón con asa ergonómica', capacidad: 10.0, unidadBase: 'L' },
    { codigo: 'BOT-1L', nombre: 'Botella Dosificadora 1L', descripcion: 'Botella transparente con escala graduada', capacidad: 1.0, unidadBase: 'L' },
    { codigo: 'FRAS-500ML', nombre: 'Frasco Aplicador 500 ml', descripcion: 'Frasco con tapa pull-push para pulimentos', capacidad: 0.5, unidadBase: 'L' },
    { codigo: 'FRAS-250ML', nombre: 'Frasco Tratamiento 250 ml', descripcion: 'Frasco ámbar con gotero para cerámico', capacidad: 0.25, unidadBase: 'L' },
    { codigo: 'SPY-750ML', nombre: 'Atomizador Spray 750 ml', descripcion: 'Gatillo spray industrial de alta resistencia', capacidad: 0.75, unidadBase: 'L' },
    { codigo: 'PACK-10U', nombre: 'Pack x10 Unidades', descripcion: 'Paquete retractilado de 10 unidades', capacidad: 10.0, unidadBase: 'u' },
    { codigo: 'UNID', nombre: 'Unidad Individual', descripcion: 'Pieza o unidad individual de trabajo', capacidad: 1.0, unidadBase: 'u' },
  ];

  const envasesMap = new Map<string, string>();
  for (const e of envasesData) {
    const envase = await prisma.tipoEnvase.upsert({
      where: { codigo: e.codigo },
      update: { nombre: e.nombre, descripcion: e.descripcion, capacidad: e.capacidad, unidadBase: e.unidadBase, estado: 1 },
      create: { codigo: e.codigo, nombre: e.nombre, descripcion: e.descripcion, capacidad: e.capacidad, unidadBase: e.unidadBase, estado: 1 },
    });
    envasesMap.set(e.codigo, envase.id);
  }

  // 10. Crear Unidades de Medida
  console.log('📏 Creando unidades de medida...');
  const unidadesData = [
    { codigo: 'L',   nombre: 'Litro',      simbolo: 'L',   tipo: 'VOLUMEN',   factorBase: 1.0 },
    { codigo: 'ML',  nombre: 'Mililitro',  simbolo: 'ml',  tipo: 'VOLUMEN',   factorBase: 0.001 },
    { codigo: 'KG',  nombre: 'Kilogramo',  simbolo: 'kg',  tipo: 'MASA',      factorBase: 1.0 },
    { codigo: 'G',   nombre: 'Gramo',      simbolo: 'g',   tipo: 'MASA',      factorBase: 0.001 },
    { codigo: 'U',   nombre: 'Unidad',     simbolo: 'u',   tipo: 'UNITARIO',  factorBase: 1.0 },
    { codigo: 'PAQ', nombre: 'Paquete',    simbolo: 'paq', tipo: 'UNITARIO',  factorBase: 1.0 },
  ];

  const unidadesMap = new Map<string, string>();
  for (const u of unidadesData) {
    const unidad = await prisma.unidadMedida.upsert({
      where: { codigo: u.codigo },
      update: { nombre: u.nombre, simbolo: u.simbolo, tipo: u.tipo, factorBase: u.factorBase, estado: 1 },
      create: { codigo: u.codigo, nombre: u.nombre, simbolo: u.simbolo, tipo: u.tipo, factorBase: u.factorBase, estado: 1 },
    });
    unidadesMap.set(u.codigo, unidad.id);
  }

  // 11. Crear Catálogo Maestro de Insumos
  console.log('🧪 Creando catálogo de insumos...');
  const insumosData = [
    { codigoSKU: 'INS-001', nombre: 'Shampoo Bio-Espuma Concentrado', categoria: 'QUIMICOS_LAVADO', descripcion: 'Shampoo biodegradable pH neutro super espumante', tipoEnvaseCodigo: 'CAN-20L', unidadCodigo: 'L', contenidoNeto: 20.0, stockMinBodega: 10, stockMinAgencia: 2, stockOptBodega: 30, costoUSD: 42.50, proveedor: 'Ecolab Industrial' },
    { codigoSKU: 'INS-002', nombre: 'Cera Carnauba Líquida Hidrofóbica', categoria: 'CERAS_SELLADORES', descripcion: 'Cera premium con efecto gota de agua de secado rápido', tipoEnvaseCodigo: 'GAL-3.78L', unidadCodigo: 'L', contenidoNeto: 3.785, stockMinBodega: 8, stockMinAgencia: 1, stockOptBodega: 20, costoUSD: 34.00, proveedor: '3M Car Care' },
    { codigoSKU: 'INS-003', nombre: 'Desengrasante Biodegradable Cítrico', categoria: 'DESENGRASANTES', descripcion: 'Desengrasante ecológico no corrosivo para llantas y tolvas', tipoEnvaseCodigo: 'CAN-20L', unidadCodigo: 'L', contenidoNeto: 20.0, stockMinBodega: 8, stockMinAgencia: 2, stockOptBodega: 25, costoUSD: 38.00, proveedor: 'Chemical Guys Ec' },
    { codigoSKU: 'INS-004', nombre: 'Compuesto Pulidor Heavy Cut', categoria: 'PULIMENTOS', descripcion: 'Pasta abrasiva para corte fuerte y corrección de rayas profundas', tipoEnvaseCodigo: 'FRAS-500ML', unidadCodigo: 'ML', contenidoNeto: 500.0, stockMinBodega: 15, stockMinAgencia: 3, stockOptBodega: 35, costoUSD: 28.00, proveedor: 'Menzerna Oficial' },
    { codigoSKU: 'INS-005', nombre: 'Compuesto Pulidor Finish Alto Brillo', categoria: 'PULIMENTOS', descripcion: 'Lustrador micro-fino para acabado espejo sin hologramas', tipoEnvaseCodigo: 'FRAS-500ML', unidadCodigo: 'ML', contenidoNeto: 500.0, stockMinBodega: 15, stockMinAgencia: 3, stockOptBodega: 35, costoUSD: 26.50, proveedor: 'Menzerna Oficial' },
    { codigoSKU: 'INS-006', nombre: 'Tratamiento Cerámico Nanotecnológico 9H', categoria: 'CERAS_SELLADORES', descripcion: 'Recubrimiento cerámico permanente resistente a UV y químicos', tipoEnvaseCodigo: 'FRAS-250ML', unidadCodigo: 'ML', contenidoNeto: 250.0, stockMinBodega: 10, stockMinAgencia: 2, stockOptBodega: 25, costoUSD: 65.00, proveedor: 'Gyeon Quartz' },
    { codigoSKU: 'INS-007', nombre: 'Toalla Microfibra Premium 40x40 cm 400GSM', categoria: 'TEXTILES', descripcion: 'Microfibra sin costuras para secado suave sin micro-rayones', tipoEnvaseCodigo: 'PACK-10U', unidadCodigo: 'U', contenidoNeto: 10.0, stockMinBodega: 25, stockMinAgencia: 5, stockOptBodega: 60, costoUSD: 18.00, proveedor: 'The Rag Company' },
    { codigoSKU: 'INS-008', nombre: 'Renovador de Neumáticos y Plásticos', categoria: 'QUIMICOS_LAVADO', descripcion: 'Acondicionador base agua de acabado satinado duradero', tipoEnvaseCodigo: 'GAL-3.78L', unidadCodigo: 'L', contenidoNeto: 3.785, stockMinBodega: 10, stockMinAgencia: 2, stockOptBodega: 30, costoUSD: 22.00, proveedor: 'Meguiars Professional' },
  ];

  const insumosMap = new Map<string, string>();
  for (const i of insumosData) {
    const insumo = await prisma.insumo.upsert({
      where: { codigoSKU: i.codigoSKU },
      update: {
        nombre: i.nombre,
        categoria: i.categoria,
        descripcion: i.descripcion,
        tipoEnvaseId: envasesMap.get(i.tipoEnvaseCodigo)!,
        unidadMedidaId: unidadesMap.get(i.unidadCodigo)!,
        contenidoNeto: i.contenidoNeto,
        stockMinimoBodega: i.stockMinBodega,
        stockMinimoAgencia: i.stockMinAgencia,
        stockOptimoBodega: i.stockOptBodega,
        costoUnitarioUSD: i.costoUSD,
        proveedorPrincipal: i.proveedor,
        estado: 1,
      },
      create: {
        codigoSKU: i.codigoSKU,
        nombre: i.nombre,
        categoria: i.categoria,
        descripcion: i.descripcion,
        tipoEnvaseId: envasesMap.get(i.tipoEnvaseCodigo)!,
        unidadMedidaId: unidadesMap.get(i.unidadCodigo)!,
        contenidoNeto: i.contenidoNeto,
        stockMinimoBodega: i.stockMinBodega,
        stockMinimoAgencia: i.stockMinAgencia,
        stockOptimoBodega: i.stockOptBodega,
        costoUnitarioUSD: i.costoUSD,
        proveedorPrincipal: i.proveedor,
        estado: 1,
      },
    });
    insumosMap.set(i.codigoSKU, insumo.id);
  }

  // 12. Crear Existencias de Stock Multi-Ubicación (Bodega Central, Agencia Quito Norte, Pulidores)
  console.log('📊 Creando existencias multi-ubicación (Bodega, Agencia y Pulidores)...');
  const bodegaCentralId = agenciasMap.get('SUC-BOD1')!;
  const pulidorFijoId = createdUsers.get('operador.pulido.norte@easydry.com')!;
  const pulidorMovilId = createdUsers.get('operador.especial@easydry.com')!;

  const stocksIniciales = [
    // --- Stock en Bodega Central (Nivel alto para abastecer a la red) ---
    { insumoSKU: 'INS-001', tipo: 'BODEGA_CENTRAL' as const, agenciaId: bodegaCentralId, pulidorId: null, cantidad: 45.0, minima: 10.0 },
    { insumoSKU: 'INS-002', tipo: 'BODEGA_CENTRAL' as const, agenciaId: bodegaCentralId, pulidorId: null, cantidad: 28.0, minima: 8.0 },
    { insumoSKU: 'INS-003', tipo: 'BODEGA_CENTRAL' as const, agenciaId: bodegaCentralId, pulidorId: null, cantidad: 32.0, minima: 8.0 },
    { insumoSKU: 'INS-004', tipo: 'BODEGA_CENTRAL' as const, agenciaId: bodegaCentralId, pulidorId: null, cantidad: 50.0, minima: 15.0 },
    { insumoSKU: 'INS-005', tipo: 'BODEGA_CENTRAL' as const, agenciaId: bodegaCentralId, pulidorId: null, cantidad: 48.0, minima: 15.0 },
    { insumoSKU: 'INS-006', tipo: 'BODEGA_CENTRAL' as const, agenciaId: bodegaCentralId, pulidorId: null, cantidad: 25.0, minima: 10.0 },
    { insumoSKU: 'INS-007', tipo: 'BODEGA_CENTRAL' as const, agenciaId: bodegaCentralId, pulidorId: null, cantidad: 60.0, minima: 25.0 },
    { insumoSKU: 'INS-008', tipo: 'BODEGA_CENTRAL' as const, agenciaId: bodegaCentralId, pulidorId: null, cantidad: 35.0, minima: 10.0 },

    // --- Stock en Agencia Quito Norte (Insumos para lavado general y bahías) ---
    { insumoSKU: 'INS-001', tipo: 'AGENCIA' as const, agenciaId: quitoNorteId, pulidorId: null, cantidad: 6.0, minima: 2.0 },
    { insumoSKU: 'INS-002', tipo: 'AGENCIA' as const, agenciaId: quitoNorteId, pulidorId: null, cantidad: 3.0, minima: 1.0 },
    { insumoSKU: 'INS-003', tipo: 'AGENCIA' as const, agenciaId: quitoNorteId, pulidorId: null, cantidad: 4.0, minima: 2.0 },
    { insumoSKU: 'INS-007', tipo: 'AGENCIA' as const, agenciaId: quitoNorteId, pulidorId: null, cantidad: 8.0, minima: 3.0 },
    { insumoSKU: 'INS-008', tipo: 'AGENCIA' as const, agenciaId: quitoNorteId, pulidorId: null, cantidad: 4.0, minima: 2.0 },

    // --- Stock Pulidor Fijo (Diego Pulido - asignado a su agencia) ---
    { insumoSKU: 'INS-004', tipo: 'PULIDOR_FIJO' as const, agenciaId: quitoNorteId, pulidorId: pulidorFijoId, cantidad: 3.0, minima: 1.0 },
    { insumoSKU: 'INS-005', tipo: 'PULIDOR_FIJO' as const, agenciaId: quitoNorteId, pulidorId: pulidorFijoId, cantidad: 3.0, minima: 1.0 },
    { insumoSKU: 'INS-006', tipo: 'PULIDOR_FIJO' as const, agenciaId: quitoNorteId, pulidorId: pulidorFijoId, cantidad: 2.0, minima: 1.0 },

    // --- Stock Pulidor Móvil (Marco Sánchez - Kit móvil de vehículo) ---
    { insumoSKU: 'INS-004', tipo: 'PULIDOR_MOVIL' as const, agenciaId: quitoNorteId, pulidorId: pulidorMovilId, cantidad: 4.0, minima: 1.0 },
    { insumoSKU: 'INS-005', tipo: 'PULIDOR_MOVIL' as const, agenciaId: quitoNorteId, pulidorId: pulidorMovilId, cantidad: 4.0, minima: 1.0 },
    { insumoSKU: 'INS-006', tipo: 'PULIDOR_MOVIL' as const, agenciaId: quitoNorteId, pulidorId: pulidorMovilId, cantidad: 3.0, minima: 1.0 },
    { insumoSKU: 'INS-007', tipo: 'PULIDOR_MOVIL' as const, agenciaId: quitoNorteId, pulidorId: pulidorMovilId, cantidad: 6.0, minima: 2.0 },
  ];

  for (const st of stocksIniciales) {
    const insumoId = insumosMap.get(st.insumoSKU)!;
    const existing = await prisma.stockUbicacion.findFirst({
      where: {
        insumoId,
        tipoUbicacion: st.tipo,
        agenciaId: st.agenciaId,
        pulidorId: st.pulidorId,
      },
    });

    if (existing) {
      await prisma.stockUbicacion.update({
        where: { id: existing.id },
        data: {
          cantidadActual: st.cantidad,
          cantidadMinima: st.minima,
        },
      });
    } else {
      await prisma.stockUbicacion.create({
        data: {
          insumoId,
          tipoUbicacion: st.tipo,
          agenciaId: st.agenciaId,
          pulidorId: st.pulidorId,
          cantidadActual: st.cantidad,
          cantidadMinima: st.minima,
        },
      });
    }
  }

  // 13. Crear Recetas de Insumos por Servicio del Catálogo
  console.log('🧾 Creando recetas de insumos por servicio...');

  const catServicios = await prisma.catalogoServicio.findMany({ select: { id: true, codigo: true } });
  const catMap = new Map<string, number>(catServicios.map((c) => [c.codigo, c.id]));

  const unidadLId  = unidadesMap.get('L')!;
  const unidadMLId = unidadesMap.get('ML')!;
  const unidadUID  = unidadesMap.get('U')!;

  const recetasData = [
    // === SER-001: Lavado Express Ecológico (GENERAL) ===
    { catalogoCodigo: 'SER-001', insumoSKU: 'INS-001', cantidadUsada: 0.100, unidadConsumoId: unidadLId,  esOpcional: false, observacion: '100 ml de shampoo concentrado' },
    { catalogoCodigo: 'SER-001', insumoSKU: 'INS-008', cantidadUsada: 0.050, unidadConsumoId: unidadLId,  esOpcional: false, observacion: '50 ml para neumáticos y plásticos' },
    { catalogoCodigo: 'SER-001', insumoSKU: 'INS-007', cantidadUsada: 1,     unidadConsumoId: unidadUID,  esOpcional: false, observacion: '1 microfibra de secado' },

    // === SER-002: Lavado Completo + Encerado (GENERAL) ===
    { catalogoCodigo: 'SER-002', insumoSKU: 'INS-001', cantidadUsada: 0.150, unidadConsumoId: unidadLId,  esOpcional: false, observacion: '150 ml de shampoo' },
    { catalogoCodigo: 'SER-002', insumoSKU: 'INS-002', cantidadUsada: 0.050, unidadConsumoId: unidadLId,  esOpcional: false, observacion: '50 ml de cera carnauba' },
    { catalogoCodigo: 'SER-002', insumoSKU: 'INS-003', cantidadUsada: 0.100, unidadConsumoId: unidadLId,  esOpcional: true,  observacion: '100 ml desengrasante (solo si hay barro en llantas)' },
    { catalogoCodigo: 'SER-002', insumoSKU: 'INS-008', cantidadUsada: 0.075, unidadConsumoId: unidadLId,  esOpcional: false, observacion: '75 ml renovador neumáticos' },
    { catalogoCodigo: 'SER-002', insumoSKU: 'INS-007', cantidadUsada: 2,     unidadConsumoId: unidadUID,  esOpcional: false, observacion: '2 microfibras' },

    // === SER-003: Lavado Premium Detallado (GENERAL) ===
    { catalogoCodigo: 'SER-003', insumoSKU: 'INS-001', cantidadUsada: 0.200, unidadConsumoId: unidadLId,  esOpcional: false },
    { catalogoCodigo: 'SER-003', insumoSKU: 'INS-002', cantidadUsada: 0.100, unidadConsumoId: unidadLId,  esOpcional: false },
    { catalogoCodigo: 'SER-003', insumoSKU: 'INS-003', cantidadUsada: 0.150, unidadConsumoId: unidadLId,  esOpcional: false },
    { catalogoCodigo: 'SER-003', insumoSKU: 'INS-008', cantidadUsada: 0.100, unidadConsumoId: unidadLId,  esOpcional: false },
    { catalogoCodigo: 'SER-003', insumoSKU: 'INS-007', cantidadUsada: 3,     unidadConsumoId: unidadUID,  esOpcional: false },

    // === SER-004: Pulido de Un Paso (ESPECIAL) ===
    { catalogoCodigo: 'SER-004', insumoSKU: 'INS-004', cantidadUsada: 15,    unidadConsumoId: unidadMLId, esOpcional: false, observacion: '15 ml pasta Heavy Cut por panel' },
    { catalogoCodigo: 'SER-004', insumoSKU: 'INS-005', cantidadUsada: 10,    unidadConsumoId: unidadMLId, esOpcional: false, observacion: '10 ml Finish para acabado' },
    { catalogoCodigo: 'SER-004', insumoSKU: 'INS-007', cantidadUsada: 2,     unidadConsumoId: unidadUID,  esOpcional: false },
    { catalogoCodigo: 'SER-004', insumoSKU: 'INS-002', cantidadUsada: 0.030, unidadConsumoId: unidadLId,  esOpcional: true,  observacion: 'Cera protectora final (opcional)' },

    // === SER-005: Pulido + Tratamiento Cerámico 9H (ESPECIAL) ===
    { catalogoCodigo: 'SER-005', insumoSKU: 'INS-004', cantidadUsada: 20,    unidadConsumoId: unidadMLId, esOpcional: false },
    { catalogoCodigo: 'SER-005', insumoSKU: 'INS-005', cantidadUsada: 20,    unidadConsumoId: unidadMLId, esOpcional: false },
    { catalogoCodigo: 'SER-005', insumoSKU: 'INS-006', cantidadUsada: 30,    unidadConsumoId: unidadMLId, esOpcional: false, observacion: '30 ml de cerámico 9H (≈1 panel completo)' },
    { catalogoCodigo: 'SER-005', insumoSKU: 'INS-007', cantidadUsada: 4,     unidadConsumoId: unidadUID,  esOpcional: false },
  ];

  for (const r of recetasData) {
    const catalogoServicioId = catMap.get(r.catalogoCodigo);
    const insumoId = insumosMap.get(r.insumoSKU);
    if (!catalogoServicioId || !insumoId) {
      console.warn(`⚠️  Receta omitida: catálogo "${r.catalogoCodigo}" o insumo "${r.insumoSKU}" no encontrado`);
      continue;
    }
    const existing = await prisma.recetaInsumo.findUnique({
      where: { catalogoServicioId_insumoId: { catalogoServicioId, insumoId } },
    });
    if (existing) {
      await prisma.recetaInsumo.update({
        where: { id: existing.id },
        data: {
          cantidadUsada: r.cantidadUsada,
          unidadConsumoId: r.unidadConsumoId,
          esOpcional: r.esOpcional,
          observacion: r.observacion ?? null,
        },
      });
    } else {
      await prisma.recetaInsumo.create({
        data: {
          catalogoServicioId,
          insumoId,
          cantidadUsada: r.cantidadUsada,
          unidadConsumoId: r.unidadConsumoId,
          esOpcional: r.esOpcional,
          observacion: r.observacion ?? null,
        },
      });
    }
  }

  console.log('✅ Seed completado exitosamente con Regiones, Agencias, Marcas, Operadores y Supervisores vinculados.');
  console.log('🔑 Todos los usuarios demo tienen la contraseña: Admin123*');
}

main()
  .catch((e) => {
    console.error('❌ Error ejecutando seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
