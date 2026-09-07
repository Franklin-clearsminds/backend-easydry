# test_hardening_operational.ps1
# Automated validation of operational hardening: Kardex serialization, stock reversal,
# duplicate plate footprint, bay occupancy guard, and quality gate mass approval.

$ErrorActionPreference = "Stop"
$BaseUrl = "http://localhost:3000/api/v1"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   TEST DE HARDENING OPERATIVO, KARDEX Y CALIDAD        " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# -------------------------------------------------------------------------
# Autenticacion
# -------------------------------------------------------------------------
Write-Host ""
Write-Host "Iniciando sesion con usuario administrador..." -ForegroundColor Yellow
$loginRes = Invoke-RestMethod -Uri "$BaseUrl/auth/login" -Method Post -ContentType "application/json" -Body (@{
    email = "admin@easydry.com"
    password = "Admin123*"
} | ConvertTo-Json)
$token = $loginRes.accessToken
$headers = @{ Authorization = "Bearer $token" }
Write-Host "  -> Autenticado con exito. User: $($loginRes.user.email)" -ForegroundColor Green

# Obtener bahias y catalogo
$bootstrap = Invoke-RestMethod -Uri "$BaseUrl/sync/bootstrap" -Method Post -Headers $headers -ContentType "application/json" -Body "{}"
$bahia1 = $bootstrap.bahias[0].id
$bahia2 = if ($bootstrap.bahias.Count -gt 1) { $bootstrap.bahias[1].id } else { $bootstrap.bahias[0].id }
$catConReceta = $bootstrap.catalogos | Where-Object { $_.recetas.Count -gt 0 } | Select-Object -First 1
$catalogoId = $catConReceta.id
$insumoId = $catConReceta.recetas[0].insumoId
Write-Host "  -> Bahia 1: $bahia1 | Bahia 2: $bahia2 | Catalogo: $($catConReceta.nombre)" -ForegroundColor Green

# -------------------------------------------------------------------------
# Test 1: Reversion de Insumos al Anular Servicio Finalizado (softDelete)
# -------------------------------------------------------------------------
Write-Host ""
Write-Host "[Test 1] Probando reversion y reposicion de insumos en softDelete..." -ForegroundColor Yellow

# Crear y finalizar un servicio con receta
$revUuid = "revert-" + [Guid]::NewGuid().ToString()
$crearRev = @{
    deviceId = "mobile-rev-test"
    mutations = @(
        @{
            mutationId = "mut-rev-1-" + [Guid]::NewGuid().ToString()
            clientUuid = $revUuid
            entity = "servicio_lavado"
            action = "CREATE"
            timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
            data = @{
                placa = "REV-" + (Get-Random -Minimum 1000 -Maximum 9999)
                modelo = "Prueba Reversion Stock"
                bahiaId = $bahia1
                servicioCatalogoId = $catalogoId
                estado = "FINALIZADO"
                fotoSalidaUrl = "https://storage.easydry.com/fotos/rev_salida.jpg"
            }
        }
    )
} | ConvertTo-Json -Depth 5

$revRes = Invoke-RestMethod -Uri "$BaseUrl/sync/push" -Method Post -Headers $headers -ContentType "application/json" -Body $crearRev
$servicioRevId = $revRes.results[0].serverAssignedId
Write-Host "  -> Servicio creado y finalizado: Id=$servicioRevId" -ForegroundColor Green

# Consultar Kardex del consumo generado
$kardexDespuesFin = Invoke-RestMethod -Uri "$BaseUrl/inventario/kardex/list" -Method Post -Headers $headers -ContentType "application/json" -Body (@{
    insumoId = $insumoId
} | ConvertTo-Json)
$consumoKardex = $kardexDespuesFin.items | Where-Object { $_.referenciaId -eq $servicioRevId -and $_.tipoMovimiento -like "CONSUMO_SERVICIO*" } | Select-Object -First 1
$stockInicialUbicacion = [double]$consumoKardex.stockAnterior
$stockTrasFinalizar = [double]$consumoKardex.stockPosterior
Write-Host "  -> Stock inicial ubicación: $stockInicialUbicacion | Tras finalizar: $stockTrasFinalizar (disminuyó $($consumoKardex.cantidad))" -ForegroundColor DarkCyan

# Anular servicio con reposicion de insumos
$deletePayload = @{
    id = $servicioRevId
    motivo = "Anulacion por digitacion duplicada de prueba"
    reponerInsumos = $true
} | ConvertTo-Json

$delRes = Invoke-RestMethod -Uri "$BaseUrl/operaciones/servicios/delete" -Method Post -Headers $headers -ContentType "application/json" -Body $deletePayload
Write-Host "  -> Servicio anulado correctamente. Estado: $($delRes.estado)" -ForegroundColor Green

# Verificar que en Kardex se genero movimiento ANULACION_SERVICIO_REVERSA y el stock se repuso
$kardexDespuesAnul = Invoke-RestMethod -Uri "$BaseUrl/inventario/kardex/list" -Method Post -Headers $headers -ContentType "application/json" -Body (@{
    insumoId = $insumoId
} | ConvertTo-Json)
$movimientoReversa = $kardexDespuesAnul.items | Where-Object { $_.referenciaId -eq $servicioRevId -and $_.tipoMovimiento -eq "ANULACION_SERVICIO_REVERSA" } | Select-Object -First 1

if (-not $movimientoReversa) {
    throw "Fallo en Test 1: no se encontro movimiento ANULACION_SERVICIO_REVERSA para el servicio anulado"
}
$stockRepuesto = [double]$movimientoReversa.stockPosterior
Write-Host "  -> Movimiento de Reversa detectado en Kardex: Tipo=$($movimientoReversa.tipoMovimiento), Cantidad=+$($movimientoReversa.cantidad)" -ForegroundColor Green
Write-Host "  -> Stock final repuesto a: $stockRepuesto (Coincide con inicial: $([Math]::Round($stockRepuesto, 4) -eq [Math]::Round($stockInicialUbicacion, 4)))" -ForegroundColor Green
if ([Math]::Round($stockRepuesto, 4) -ne [Math]::Round($stockInicialUbicacion, 4)) {
    throw "Fallo en Test 1: el stock repuesto ($stockRepuesto) no coincide con el inicial ($stockInicialUbicacion)"
}

# -------------------------------------------------------------------------
# Test 2: Huella Operativa Anti-Duplicados (Misma Placa Activa)
# -------------------------------------------------------------------------
Write-Host ""
Write-Host "[Test 2] Probando Huella Operativa Anti-Duplicados (Misma Placa en Proceso)..." -ForegroundColor Yellow
$placaDuplicada = "DUP-" + (Get-Random -Minimum 1000 -Maximum 9999).ToString()

# 1. Crear primer servicio activo
$uuidActivo1 = "act1-" + [Guid]::NewGuid().ToString()
$pushActivo1 = @{
    deviceId = "mobile-dup-1"
    mutations = @(
        @{
            mutationId = "mut-dup-1-" + [Guid]::NewGuid().ToString()
            clientUuid = $uuidActivo1
            entity = "servicio_lavado"
            action = "CREATE"
            timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
            data = @{
                placa = $placaDuplicada
                modelo = "Toyota Yaris Original"
                bahiaId = $bahia2
                estado = "EN_PROCESO"
            }
        }
    )
} | ConvertTo-Json -Depth 5
$resActivo1 = Invoke-RestMethod -Uri "$BaseUrl/sync/push" -Method Post -Headers $headers -ContentType "application/json" -Body $pushActivo1
Write-Host "  -> Primer registro de placa ${placaDuplicada}: Status=$($resActivo1.results[0].status), Id=$($resActivo1.results[0].serverAssignedId)" -ForegroundColor Green

# 2. Intentar registrar la misma placa en otra orden concurrente/offline
$uuidActivo2 = "act2-" + [Guid]::NewGuid().ToString()
$pushActivo2 = @{
    deviceId = "mobile-dup-2"
    mutations = @(
        @{
            mutationId = "mut-dup-2-" + [Guid]::NewGuid().ToString()
            clientUuid = $uuidActivo2
            entity = "servicio_lavado"
            action = "CREATE"
            timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 1000
            data = @{
                placa = $placaDuplicada
                modelo = "Toyota Yaris Duplicado Offline"
                bahiaId = $bahia2
                estado = "EN_ESPERA"
            }
        }
    )
} | ConvertTo-Json -Depth 5
$resActivo2 = Invoke-RestMethod -Uri "$BaseUrl/sync/push" -Method Post -Headers $headers -ContentType "application/json" -Body $pushActivo2
Write-Host "  -> Segundo registro de placa ${placaDuplicada}: Status=$($resActivo2.results[0].status), Error=$($resActivo2.results[0].error)" -ForegroundColor Green

if ($resActivo2.results[0].status -ne "FAILED" -or -not ($resActivo2.results[0].error -match "POSIBLE_DUPLICADO_PLACA")) {
    throw "Fallo en Test 2: el segundo registro con la misma placa no fue aislado en la DLQ"
}

# Verificar en DLQ
$dlqCheck = Invoke-RestMethod -Uri "$BaseUrl/sync/dlq/list" -Method Post -Headers $headers -ContentType "application/json" -Body "{}"
$dlqItem = $dlqCheck.items | Where-Object { $_.clientUuid -eq $uuidActivo2 } | Select-Object -First 1
if (-not $dlqItem) {
    throw "Fallo en Test 2: la orden duplicada no se registro en SyncDeadLetterQueue"
}
Write-Host "  -> Orden duplicada aislada con exito en DLQ con motivo: $($dlqItem.errorMotivo)" -ForegroundColor Green

# -------------------------------------------------------------------------
# Test 3: Control Fisico de Ocupacion de Bahia
# -------------------------------------------------------------------------
Write-Host ""
Write-Host "[Test 3] Probando control de doble ocupacion fisica de bahia..." -ForegroundColor Yellow
$occupyFail = $false
try {
    # Intentar ingresar un segundo vehiculo en Bahía 2 en estado EN_PROCESO (ya ocupada por $placaDuplicada)
    $badBayPayload = @{
        placa = "OCC-9999"
        modelo = "Kia Sportage"
        bahiaId = $bahia2
        servicioCatalogoId = 1
        estado = "EN_PROCESO"
    } | ConvertTo-Json
    Invoke-RestMethod -Uri "$BaseUrl/operaciones/servicios/create" -Method Post -Headers $headers -ContentType "application/json" -Body $badBayPayload
} catch {
    $occupyFail = $true
    Write-Host "  -> Excepcion esperada capturada: $($_.Exception.Message)" -ForegroundColor Green
}
if (-not $occupyFail) {
    throw "Fallo en Test 3: el backend permitio meter dos vehiculos simultaneos en estado EN_PROCESO en la misma bahia"
}
Write-Host "  -> Control de sobreocupacion de bahia validado exitosamente." -ForegroundColor Green

# -------------------------------------------------------------------------
# Test 4: Quality Gate en Aprobacion Masiva Gerencial
# -------------------------------------------------------------------------
Write-Host ""
Write-Host "[Test 4] Probando Quality Gate en Cierre Diario (Aprobacion Masiva)..." -ForegroundColor Yellow

# 1. Crear servicio A FINALIZADO CON foto de salida
$uuidFotoOk = "fotook-" + [Guid]::NewGuid().ToString()
$pushFotoOk = @{
    deviceId = "mobile-gate"
    mutations = @(
        @{
            mutationId = "mut-foto-ok"
            clientUuid = $uuidFotoOk
            entity = "servicio_lavado"
            action = "CREATE"
            timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
            data = @{
                placa = "FOT-0001"
                modelo = "Auto con Foto"
                estado = "FINALIZADO"
                fotoSalidaUrl = "https://storage.easydry.com/fotos/salida_valida.jpg"
            }
        }
    )
} | ConvertTo-Json -Depth 5
$resFotoOk = Invoke-RestMethod -Uri "$BaseUrl/sync/push" -Method Post -Headers $headers -ContentType "application/json" -Body $pushFotoOk
$idFotoOk = $resFotoOk.results[0].serverAssignedId

# 2. Crear servicio B FINALIZADO SIN foto de salida
$uuidSinFoto = "sinfoto-" + [Guid]::NewGuid().ToString()
$pushSinFoto = @{
    deviceId = "mobile-gate"
    mutations = @(
        @{
            mutationId = "mut-sin-foto"
            clientUuid = $uuidSinFoto
            entity = "servicio_lavado"
            action = "CREATE"
            timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 500
            data = @{
                placa = "FOT-0002"
                modelo = "Auto Sin Foto"
                estado = "FINALIZADO"
            }
        }
    )
} | ConvertTo-Json -Depth 5
$resSinFoto = Invoke-RestMethod -Uri "$BaseUrl/sync/push" -Method Post -Headers $headers -ContentType "application/json" -Body $pushSinFoto
$idSinFoto = $resSinFoto.results[0].serverAssignedId
Write-Host "  -> Creados: Auto Con Foto ($idFotoOk) y Auto Sin Foto ($idSinFoto)" -ForegroundColor DarkCyan

# 3. Disparar aprobacion masiva exigiendo Quality Gate
$aprobacionMasiva = Invoke-RestMethod -Uri "$BaseUrl/operaciones/servicios/aprobar-todos" -Method Post -Headers $headers -ContentType "application/json" -Body (@{
    requiereFotoSalida = $true
} | ConvertTo-Json)

Write-Host "  -> Aprobados: $($aprobacionMasiva.aprobadosCount)" -ForegroundColor Green
Write-Host "  -> Omitidos sin foto: $($aprobacionMasiva.omitidosSinFotoCount)" -ForegroundColor Green
Write-Host "  -> Mensaje: $($aprobacionMasiva.mensaje)" -ForegroundColor Green

# 4. Verificar que Auto Sin Foto sigue en estado FINALIZADO y Auto Con Foto quedo APROBADO
$checkFotoOk = Invoke-RestMethod -Uri "$BaseUrl/operaciones/servicios/detail" -Method Post -Headers $headers -ContentType "application/json" -Body (@{ id = $idFotoOk } | ConvertTo-Json)
$checkSinFoto = Invoke-RestMethod -Uri "$BaseUrl/operaciones/servicios/detail" -Method Post -Headers $headers -ContentType "application/json" -Body (@{ id = $idSinFoto } | ConvertTo-Json)

Write-Host "  -> Estado Auto Con Foto: $($checkFotoOk.estado)" -ForegroundColor Green
Write-Host "  -> Estado Auto Sin Foto: $($checkSinFoto.estado)" -ForegroundColor Green

if ($checkFotoOk.estado -ne "APROBADO") {
    throw "Fallo en Test 4: el auto con foto debio haber sido APROBADO"
}
if ($checkSinFoto.estado -ne "FINALIZADO") {
    throw "Fallo en Test 4: el auto sin foto debio haber permanecido FINALIZADO para control de calidad"
}
Write-Host "  -> Quality Gate de Aprobacion Masiva verificado al 100%." -ForegroundColor Green

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   TODAS LAS PRUEBAS DE HARDENING OPERATIVO PASARON 100%  " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
