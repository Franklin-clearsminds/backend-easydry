# ==============================================================================
# EasyDry Enterprise - Suite de Pruebas de Integracion Frontends (Web & Movil)
# Valida los 5 Modulos de Integracion:
# 1. Aprobaciones Gerenciales y Cierre Diario
# 2. Servicios Especiales de Detailing (CRUD, Iniciar, Completar)
# 3. Ciclo de Despacho y Recepcion Quimica con Doble Partida Kardex
# 4. Asignacion Dinamica de Operador a Bahia e Historial
# 5. Serializador Denormalizado (Campos planos para templates de Angular y React Native)
# ==============================================================================

$baseUrl = "http://localhost:3000/api/v1"
$ErrorActionPreference = "Stop"

function Assert-Condition($condition, $message) {
    if (-not $condition) {
        Write-Host "[-] FALLO: $message" -ForegroundColor Red
        exit 1
    }
    Write-Host "[+] OK: $message" -ForegroundColor Green
}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "PASO 0: Autenticacion" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$loginAdmin = Invoke-RestMethod -Uri "$baseUrl/auth/login" -Method POST `
    -Headers @{ "Content-Type" = "application/json" } `
    -Body '{"email":"admin@easydry.com","password":"Admin123*"}'
$adminToken = $loginAdmin.accessToken

$loginOp = Invoke-RestMethod -Uri "$baseUrl/auth/login" -Method POST `
    -Headers @{ "Content-Type" = "application/json" } `
    -Body '{"email":"operador.bahia01@easydry.com","password":"Admin123*"}'
$opToken = $loginOp.accessToken
$operadorId = $loginOp.user.id
$agenciaId = $loginOp.user.agenciaId

Assert-Condition ($adminToken -ne $null) "Token Admin obtenido"
Assert-Condition ($opToken -ne $null) "Token Operador obtenido"

# Obtener bahias
$bahiasResp = Invoke-RestMethod -Uri "$baseUrl/agencias/bahias/list" -Method POST `
    -Headers @{ "Authorization" = "Bearer $adminToken"; "Content-Type" = "application/json" } `
    -Body "{""agenciaId"":""$agenciaId""}"
$bahia = $bahiasResp[0]
$bahiaId = $bahia.id
Assert-Condition ($bahiaId -ne $null) "Bahia encontrada: $($bahia.codigo)"

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "MODULO 4: Asignacion Dinamica de Bahia con Historial" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# Asignar operador a la bahia
$asigResp = Invoke-RestMethod -Uri "$baseUrl/agencias/bahias/asignar-operador" -Method POST `
    -Headers @{ "Authorization" = "Bearer $adminToken"; "Content-Type" = "application/json" } `
    -Body "{""bahiaId"":""$bahiaId"",""operadorId"":""$operadorId"",""notas"":""Turno Matutino QA""}"

Assert-Condition ($asigResp.operadorActualId -eq $operadorId) "Operador asignado a bahia exitosamente"
Assert-Condition ($asigResp.operadorActual.name -ne $null) "Datos de operador embebidos en bahia"

# Consultar historial
$histResp = Invoke-RestMethod -Uri "$baseUrl/agencias/bahias/historial-asignaciones" -Method POST `
    -Headers @{ "Authorization" = "Bearer $adminToken"; "Content-Type" = "application/json" } `
    -Body "{""bahiaId"":""$bahiaId""}"

Assert-Condition ($histResp.data.Count -ge 1) "Registro de historial de asignacion verificado ($($histResp.total) registros)"
Write-Host "Historial verificado: $($histResp.data[0].bahia.nombre) -> $($histResp.data[0].operador.name)"

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "MODULO 1 & 5: Creacion de Servicio, Serializacion y Aprobacion Gerencial" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# Abastecer stock en la agencia para que los lavados de prueba puedan finalizar
$stocks = Invoke-RestMethod -Uri "$baseUrl/inventario/stock/list" -Method POST `
    -Headers @{ "Authorization" = "Bearer $adminToken"; "Content-Type" = "application/json" } `
    -Body "{""sucursalId"":""$agenciaId""}"
foreach ($st in $stocks) {
    try {
        Invoke-RestMethod -Uri "$baseUrl/inventario/stock/ajuste" -Method POST `
            -Headers @{ "Authorization" = "Bearer $adminToken"; "Content-Type" = "application/json" } `
            -Body "{""stockUbicacionId"":""$($st.id)"",""cantidadNueva"":500,""razon"":""Ajuste de inventario para pruebas""}" | Out-Null
    } catch {}
}

# Crear servicio de prueba
$clientUuid1 = "srv-test-" + [guid]::NewGuid().ToString().Substring(0, 8)
$createServicio = Invoke-RestMethod -Uri "$baseUrl/operaciones/servicios/create" -Method POST `
    -Headers @{ "Authorization" = "Bearer $adminToken"; "Content-Type" = "application/json" } `
    -Body @"
{
    "clientUuid": "$clientUuid1",
    "placa": "PBA-9999",
    "modelo": "Hyundai Tucson",
    "color": "Blanco",
    "cliente": "Empresa Corporativa SA",
    "bahiaId": "$bahiaId",
    "servicioCatalogoId": 1,
    "estado": "EN_PROCESO"
}
"@

# Validar campos denormalizados del serializador (MODULO 5)
Assert-Condition ($createServicio.bahiaNombre -ne $null) "Serializador: bahiaNombre presente ('$($createServicio.bahiaNombre)')"
Assert-Condition ($createServicio.agenciaNombre -ne $null) "Serializador: agenciaNombre presente ('$($createServicio.agenciaNombre)')"
Assert-Condition ($createServicio.sucursalNombre -ne $null) "Serializador: sucursalNombre presente ('$($createServicio.sucursalNombre)')"
Assert-Condition ($createServicio.ordenTrabajoOT -ne $null) "Serializador: ordenTrabajoOT presente ('$($createServicio.ordenTrabajoOT)')"
Assert-Condition ($createServicio.numeroOrden -ne $null) "Serializador: numeroOrden presente ('$($createServicio.numeroOrden)')"
Assert-Condition ($createServicio.marca -eq "Hyundai") "Serializador: marca extraida correctamente ('$($createServicio.marca)')"
Assert-Condition ($createServicio.fecha -ne $null) "Serializador: fecha ISO plana presente ('$($createServicio.fecha)')"

$servicioId1 = $createServicio.id

# Finalizar el servicio
$finishServicio = Invoke-RestMethod -Uri "$baseUrl/operaciones/servicios/update" -Method POST `
    -Headers @{ "Authorization" = "Bearer $adminToken"; "Content-Type" = "application/json" } `
    -Body "{""id"":""$servicioId1"",""estado"":""FINALIZADO""}"

Assert-Condition ($finishServicio.estado -eq "FINALIZADO") "Servicio marcado como FINALIZADO"

# Aprobar servicio por Gerencia (MODULO 1)
$aprobarResp = Invoke-RestMethod -Uri "$baseUrl/operaciones/servicios/aprobar" -Method POST `
    -Headers @{ "Authorization" = "Bearer $adminToken"; "Content-Type" = "application/json" } `
    -Body "{""id"":""$servicioId1"",""observacion"":""Aprobado con estandares tecnicos cumplidos""}"

Assert-Condition ($aprobarResp.estado -eq "APROBADO") "Servicio en estado APROBADO"
Assert-Condition ($aprobarResp.observacionGerente -like "*Aprobado con estandares*") "Observacion de gerente registrada"
Assert-Condition ($aprobarResp.fechaAprobacion -ne $null) "Fecha de aprobacion registrada"
Assert-Condition ($aprobarResp.aprobadoPor -ne $null) "Aprobador registrado: $($aprobarResp.aprobadoPor)"

# Rechazar servicio de prueba
$clientUuid2 = "srv-test-" + [guid]::NewGuid().ToString().Substring(0, 8)
$createServicio2 = Invoke-RestMethod -Uri "$baseUrl/operaciones/servicios/create" -Method POST `
    -Headers @{ "Authorization" = "Bearer $adminToken"; "Content-Type" = "application/json" } `
    -Body @"
{
    "clientUuid": "$clientUuid2",
    "placa": "PBA-8888",
    "modelo": "Kia Sportage",
    "bahiaId": "$bahiaId",
    "servicioCatalogoId": 1,
    "estado": "FINALIZADO"
}
"@

$rechazarResp = Invoke-RestMethod -Uri "$baseUrl/operaciones/servicios/rechazar" -Method POST `
    -Headers @{ "Authorization" = "Bearer $adminToken"; "Content-Type" = "application/json" } `
    -Body "{""id"":""$($createServicio2.id)"",""motivo"":""Secado incompleto en guardafangos""}"

Assert-Condition ($rechazarResp.estado -eq "RECHAZADO") "Servicio en estado RECHAZADO"
Assert-Condition ($rechazarResp.motivoRechazo -like "*Secado incompleto*") "Motivo de rechazo registrado"

# Aprobacion masiva de cierre diario
$aprobacionMasiva = Invoke-RestMethod -Uri "$baseUrl/operaciones/servicios/aprobar-todos" -Method POST `
    -Headers @{ "Authorization" = "Bearer $adminToken"; "Content-Type" = "application/json" } `
    -Body "{""agenciaId"":""$agenciaId""}"

Assert-Condition ($aprobacionMasiva.ok -eq $true) "Aprobacion masiva ejecutada: $($aprobacionMasiva.mensaje)"

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "MODULO 2: Servicios Especiales de Detailing (ServicioEspecial)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$codigoSE = "SE-TEST-" + [guid]::NewGuid().ToString().Substring(0, 6).ToUpper()
$createSEResp = Invoke-RestMethod -Uri "$baseUrl/operaciones/servicios-especiales/crear" -Method POST `
    -Headers @{ "Authorization" = "Bearer $adminToken"; "Content-Type" = "application/json" } `
    -Body @"
{
    "codigoSE": "$codigoSE",
    "tipoServicio": "PULIDO",
    "vehiculoInfo": {
        "placa": "PBA-7777",
        "marca": "Audi",
        "modelo": "A4",
        "color": "Negro",
        "cliente": "Fernando Torres"
    },
    "agenciaId": "$agenciaId",
    "prioridad": "ALTA",
    "observaciones": "Correccion de laca por lluvia acida"
}
"@

Assert-Condition ($createSEResp.id -ne $null) "Servicio especial creado (ID: $($createSEResp.id), Codigo: $($createSEResp.codigoSE))"
Assert-Condition ($createSEResp.placa -eq "PBA-7777") "Placa registrada correctamente"
Assert-Condition ($createSEResp.marca -eq "Audi") "Marca registrada correctamente"
Assert-Condition ($createSEResp.cliente -eq "Fernando Torres") "Cliente registrado correctamente"
Assert-Condition ($createSEResp.estado -eq "Pendiente") "Estado inicial Pendiente"

$seId = $createSEResp.id

# Iniciar servicio especial
$iniciarSE = Invoke-RestMethod -Uri "$baseUrl/operaciones/servicios-especiales/iniciar" -Method POST `
    -Headers @{ "Authorization" = "Bearer $adminToken"; "Content-Type" = "application/json" } `
    -Body "{""id"":""$seId""}"

Assert-Condition ($iniciarSE.estado -eq "En Proceso") "Servicio especial en estado En Proceso"
Assert-Condition ($iniciarSE.fechaInicio -ne $null) "Fecha de inicio registrada"

# Completar servicio especial con calificacion de calidad
$completarSE = Invoke-RestMethod -Uri "$baseUrl/operaciones/servicios-especiales/completar" -Method POST `
    -Headers @{ "Authorization" = "Bearer $adminToken"; "Content-Type" = "application/json" } `
    -Body @"
{
    "id": "$seId",
    "calificacionCalidad": 5,
    "observaciones": "Acabado espejo impecable verificado bajo lampara LED",
    "evidencias": [
        {"tipo": "DESPUES", "url": "https://storage.easydry.com/fotos/se-despues.jpg"}
    ]
}
"@

Assert-Condition ($completarSE.estado -eq "Completado") "Servicio especial en estado Completado"
Assert-Condition ($completarSE.calificacionCalidad -eq 5) "Calificacion de calidad 5 estrellas asignada"
Assert-Condition ($completarSE.fechaFin -ne $null) "Fecha fin registrada"

# Listar servicios especiales
$listSE = Invoke-RestMethod -Uri "$baseUrl/operaciones/servicios-especiales/list" -Method POST `
    -Headers @{ "Authorization" = "Bearer $adminToken"; "Content-Type" = "application/json" } `
    -Body "{""agenciaId"":""$agenciaId""}"

Assert-Condition ($listSE.items.Count -ge 1) "Listado de servicios especiales verificado ($($listSE.total) total)"

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "MODULO 3: Despachos y Recepcion Quimica con Doble Partida Kardex" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# Obtener un insumo con stock en Bodega Central
$insumos = Invoke-RestMethod -Uri "$baseUrl/inventario/insumos/list" -Method POST `
    -Headers @{ "Authorization" = "Bearer $adminToken"; "Content-Type" = "application/json" } `
    -Body "{}"
$insumo = $insumos[0]
$insumoId = $insumo.id
Assert-Condition ($insumoId -ne $null) "Insumo encontrado: $($insumo.nombre) ($($insumo.codigoSKU))"

# Asegurar stock en Bodega Central via Compra a Proveedor
$compraResp = Invoke-RestMethod -Uri "$baseUrl/inventario/movimientos/compras/registrar" -Method POST `
    -Headers @{ "Authorization" = "Bearer $adminToken"; "Content-Type" = "application/json" } `
    -Body @"
{
    "proveedorNombre": "Distribuidora Quimica Central",
    "observaciones": "Ingreso de quimicos para despacho",
    "detalles": [
        {
            "insumoId": "$insumoId",
            "cantidadEnviada": 100,
            "costoUnitarioUSD": 5.50
        }
    ]
}
"@

# Crear despacho quimico
$guiaDespacho = "DESP-" + [guid]::NewGuid().ToString().Substring(0, 6).ToUpper()
$despachoResp = Invoke-RestMethod -Uri "$baseUrl/inventario/despachos/crear" -Method POST `
    -Headers @{ "Authorization" = "Bearer $adminToken"; "Content-Type" = "application/json" } `
    -Body @"
{
    "numeroGuia": "$guiaDespacho",
    "tipo": "DESPACHO_AGENCIA",
    "agenciaId": "$agenciaId",
    "observaciones": "Envio semanal de quimicos de lavado",
    "detalles": [
        {
            "insumoId": "$insumoId",
            "cantidadEnviada": 5
        }
    ]
}
"@

Assert-Condition ($despachoResp.id -ne $null) "Despacho creado con guia: $($despachoResp.numeroGuia)"
Assert-Condition ($despachoResp.estadoDespacho -eq "EN_TRANSITO") "Estado inicial del despacho: EN_TRANSITO"

# Listar despachos en curso
$listDespachos = Invoke-RestMethod -Uri "$baseUrl/inventario/despachos/list" -Method POST `
    -Headers @{ "Authorization" = "Bearer $adminToken"; "Content-Type" = "application/json" } `
    -Body "{""estadoDespacho"":""EN_TRANSITO""}"

Assert-Condition ($listDespachos.Count -ge 1) "Listado de despachos en transito verificado"

# Confirmar recepcion en agencia
$confirmarResp = Invoke-RestMethod -Uri "$baseUrl/inventario/despachos/confirmar-recepcion" -Method POST `
    -Headers @{ "Authorization" = "Bearer $adminToken"; "Content-Type" = "application/json" } `
    -Body @"
{
    "movimientoId": "$($despachoResp.id)",
    "accion": "RECIBIDO",
    "agenciaId": "$agenciaId",
    "observaciones": "Bidones recibidos en perfecto estado y sellados"
}
"@

Assert-Condition ($confirmarResp.ok -eq $true) "Recepcion de despacho confirmada"
Assert-Condition ($confirmarResp.nuevoEstado -eq "RECIBIDO") "Estado final del despacho: RECIBIDO"

# Verificar doble asiento contable en Kardex (DESPACHO_SALIDA y DESPACHO_ENTRADA)
$kardexResp = Invoke-RestMethod -Uri "$baseUrl/inventario/kardex/list" -Method POST `
    -Headers @{ "Authorization" = "Bearer $adminToken"; "Content-Type" = "application/json" } `
    -Body "{""insumoId"":""$insumoId"",""pageSize"":10}"

$movSalida = $kardexResp.items | Where-Object { $_.referenciaId -eq $guiaDespacho -and $_.tipoMovimiento -eq "DESPACHO_SALIDA" }
$movEntrada = $kardexResp.items | Where-Object { $_.referenciaId -eq $guiaDespacho -and $_.tipoMovimiento -eq "DESPACHO_ENTRADA" }

Assert-Condition ($movSalida -ne $null) "Kardex: Asiento de salida de Bodega Central registrado (DESPACHO_SALIDA)"
Assert-Condition ($movEntrada -ne $null) "Kardex: Asiento de entrada en Agencia registrado (DESPACHO_ENTRADA)"
Write-Host "Trazabilidad de Kardex completa y balanceada para guia $guiaDespacho"

Write-Host "`n============================================================" -ForegroundColor Green
Write-Host "TODAS LAS PRUEBAS DE INTEGRACION (1 AL 5) PASARON CON EXITO!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
