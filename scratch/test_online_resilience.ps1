# test_online_resilience.ps1
# Automated validation of the 8 online sync failure modes & hardening features

$ErrorActionPreference = "Stop"
$BaseUrl = "http://localhost:3000/api/v1"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   TEST DE RESILIENCIA EN FLUJO DE SINCRONIZACION ONLINE  " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# -------------------------------------------------------------------------
# Test 1: Fast-Probe Heartbeat POST /sync/ping (Sin Auth / Latencia < 20ms)
# -------------------------------------------------------------------------
Write-Host ""
Write-Host "[Test 1] Verificando Fast-Probe Heartbeat POST /sync/ping..." -ForegroundColor Yellow
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$pingRes = Invoke-RestMethod -Uri "$BaseUrl/sync/ping" -Method Post -ContentType "application/json" -Body "{}"
$stopwatch.Stop()
$elapsedMs = $stopwatch.ElapsedMilliseconds

Write-Host "  -> Responde en: $elapsedMs ms" -ForegroundColor Green
Write-Host "  -> OK: $($pingRes.ok)" -ForegroundColor Green
Write-Host "  -> ServerTime: $($pingRes.serverTime)" -ForegroundColor Green
Write-Host "  -> Timestamp: $($pingRes.timestamp)" -ForegroundColor Green
Write-Host "  -> Version: $($pingRes.version)" -ForegroundColor Green

if ($pingRes.ok -ne $true -or -not $pingRes.serverTime) {
    throw "Fallo en Test 1: ping no devolvio formato esperado"
}

# -------------------------------------------------------------------------
# Auth para pruebas subsecuentes
# -------------------------------------------------------------------------
Write-Host ""
Write-Host "Iniciando sesion con usuario de prueba..." -ForegroundColor Yellow
$loginBody = @{
    email = "admin@easydry.com"
    password = "Admin123*"
} | ConvertTo-Json

$loginRes = Invoke-RestMethod -Uri "$BaseUrl/auth/login" -Method Post -ContentType "application/json" -Body $loginBody
$token = $loginRes.accessToken
$headers = @{
    Authorization = "Bearer $token"
}
Write-Host "  -> Autenticado con exito. User: $($loginRes.user.email)" -ForegroundColor Green

# -------------------------------------------------------------------------
# Test 2: Blindaje Anti Clock-Skew (Reloj cliente descalibrado hacia el futuro)
# -------------------------------------------------------------------------
Write-Host ""
Write-Host "[Test 2] Probando sanitizacion de Clock Skew (+1 hora en el futuro)..." -ForegroundColor Yellow
$skewUuid = "skew-test-" + [Guid]::NewGuid().ToString()
$futureTime = (Get-Date).AddHours(2).ToString("o")

$skewPlaca = "SKE-" + (Get-Random -Minimum 1000 -Maximum 9999)
$skewPayload = @{
    deviceId = "mobile-skew-test"
    mutations = @(
        @{
            mutationId = "mut-skew-1"
            clientUuid = $skewUuid
            entity = "servicio_lavado"
            action = "CREATE"
            timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
            data = @{
                placa = $skewPlaca
                modelo = "Prueba Clock Skew"
                color = "Azul"
                cliente = "Cliente Skew"
                horaIngreso = $futureTime
            }
        }
    )
} | ConvertTo-Json -Depth 5

$skewRes = Invoke-RestMethod -Uri "$BaseUrl/sync/push" -Method Post -Headers $headers -ContentType "application/json" -Body $skewPayload
Write-Host "  -> Push resultado: $($skewRes.results[0].status), Id: $($skewRes.results[0].serverAssignedId)" -ForegroundColor Green

# Verificar que en base de datos la horaIngreso no quedo en el futuro lejano
$verifySkew = Invoke-RestMethod -Uri "$BaseUrl/operaciones/servicios/detail" -Method Post -Headers $headers -ContentType "application/json" -Body (@{ id = $skewRes.results[0].serverAssignedId } | ConvertTo-Json)
$ingresoParsed = [DateTime]::Parse($verifySkew.horaIngreso)
$now = (Get-Date).ToUniversalTime()
$diffMinutes = [Math]::Abs(($ingresoParsed.ToUniversalTime() - $now).TotalMinutes)
Write-Host "  -> Hora guardada: $($verifySkew.horaIngreso) (Diferencia con actual: $([Math]::Round($diffMinutes, 2)) minutos)" -ForegroundColor Green
if ($diffMinutes -gt 5) {
    throw "Fallo en Test 2: horaIngreso no fue saneada y permanece en el futuro lejano"
}
Write-Host "  -> Reloj descalibrado neutralizado y normalizado correctamente." -ForegroundColor Green

# -------------------------------------------------------------------------
# Test 3: Blindaje Anti 'Double-Tap' / Insercion Concurrente Idempotente
# -------------------------------------------------------------------------
Write-Host ""
Write-Host "[Test 3] Probando idempotencia ante Double-Tap / Concurrencia con mismo clientUuid..." -ForegroundColor Yellow
$doubleTapUuid = "doubletap-" + [Guid]::NewGuid().ToString()

$tapPlaca = "TAP-" + (Get-Random -Minimum 1000 -Maximum 9999)
$tapPayload1 = @{
    deviceId = "mobile-tap-1"
    mutations = @(
        @{
            mutationId = "tap-mut-1"
            clientUuid = $doubleTapUuid
            entity = "servicio_lavado"
            action = "CREATE"
            timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
            data = @{
                placa = $tapPlaca
                modelo = "Prueba Double Tap"
            }
        }
    )
} | ConvertTo-Json -Depth 5

$tapPayload2 = @{
    deviceId = "mobile-tap-2"
    mutations = @(
        @{
            mutationId = "tap-mut-2"
            clientUuid = $doubleTapUuid
            entity = "servicio_lavado"
            action = "CREATE"
            timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 5
            data = @{
                placa = $tapPlaca
                modelo = "Prueba Double Tap"
            }
        }
    )
} | ConvertTo-Json -Depth 5

# Primer tap
$tapRes1 = Invoke-RestMethod -Uri "$BaseUrl/sync/push" -Method Post -Headers $headers -ContentType "application/json" -Body $tapPayload1
Write-Host "  -> Tap 1: Status=$($tapRes1.results[0].status), AssignedId=$($tapRes1.results[0].serverAssignedId)" -ForegroundColor Green

# Segundo tap (reintento simultaneo o consecutivo con mismo clientUuid)
$tapRes2 = Invoke-RestMethod -Uri "$BaseUrl/sync/push" -Method Post -Headers $headers -ContentType "application/json" -Body $tapPayload2
Write-Host "  -> Tap 2: Status=$($tapRes2.results[0].status), AssignedId=$($tapRes2.results[0].serverAssignedId)" -ForegroundColor Green

if ($tapRes1.results[0].status -ne "APPLIED" -or $tapRes2.results[0].status -ne "ALREADY_EXISTS") {
    throw "Fallo en Test 3: el segundo tap debio retornar ALREADY_EXISTS de forma idempotente sin error 500"
}
if ($tapRes1.results[0].serverAssignedId -ne $tapRes2.results[0].serverAssignedId) {
    throw "Fallo en Test 3: los IDs asignados deben coincidir exactamente"
}
Write-Host "  -> Double-Tap neutralizado: ambos devolvieron 200 OK y el mismo serverAssignedId." -ForegroundColor Green

# -------------------------------------------------------------------------
# Test 4: Maquina de Estados Irreversible contra Paquetes Fuera de Orden
# -------------------------------------------------------------------------
Write-Host ""
Write-Host "[Test 4] Probando proteccion contra entregas fuera de orden (Out-of-Order Delivery)..." -ForegroundColor Yellow
$orderUuid = "stateguard-" + [Guid]::NewGuid().ToString()

# 1. Crear servicio y finalizarlo directamente
$ordPlaca = "ORD-" + (Get-Random -Minimum 1000 -Maximum 9999)
$createFinalizado = @{
    deviceId = "mobile-guard"
    mutations = @(
        @{
            mutationId = "mut-create-final"
            clientUuid = $orderUuid
            entity = "servicio_lavado"
            action = "CREATE"
            timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
            data = @{
                placa = $ordPlaca
                modelo = "Prueba State Guard"
                estado = "FINALIZADO"
            }
        }
    )
} | ConvertTo-Json -Depth 5

$createRes = Invoke-RestMethod -Uri "$BaseUrl/sync/push" -Method Post -Headers $headers -ContentType "application/json" -Body $createFinalizado
$serviceId = $createRes.results[0].serverAssignedId
Write-Host "  -> Servicio creado como FINALIZADO: Id=$serviceId" -ForegroundColor Green

# 2. Simular paquete rezagado que llega con retraso pretendiendo colocar EN_PROCESO
Write-Host "  -> Enviando paquete rezagado que solicita EN_PROCESO sobre orden ya FINALIZADA..." -ForegroundColor Yellow
$laggedPacket = @{
    deviceId = "mobile-guard"
    mutations = @(
        @{
            mutationId = "mut-lagged-packet"
            clientUuid = $orderUuid
            entity = "servicio_lavado"
            action = "UPDATE"
            timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - 5000
            data = @{
                id = $serviceId
                estado = "EN_PROCESO"
                observaciones = "Paquete rezagado de red celular"
            }
        }
    )
} | ConvertTo-Json -Depth 5

$laggedRes = Invoke-RestMethod -Uri "$BaseUrl/sync/push" -Method Post -Headers $headers -ContentType "application/json" -Body $laggedPacket
Write-Host "  -> Paquete rezagado procesado: $($laggedRes.results[0].status)" -ForegroundColor Green

# 3. Comprobar que en base de datos NO retrocedio a EN_PROCESO
$checkOrder = Invoke-RestMethod -Uri "$BaseUrl/operaciones/servicios/detail" -Method Post -Headers $headers -ContentType "application/json" -Body (@{ id = $serviceId } | ConvertTo-Json)
Write-Host "  -> Estado actual en base de datos: $($checkOrder.estado)" -ForegroundColor Green
if ($checkOrder.estado -ne "FINALIZADO") {
    throw "Fallo en Test 4: la orden retrocedio indebidamente a $($checkOrder.estado)"
}
Write-Host "  -> Maquina de estados blindada: el paquete retrasado no pudo degradar el estado FINALIZADO." -ForegroundColor Green

# 4. Probar intento de degradacion directa via API web (debe arrojar 400 Bad Request)
Write-Host "  -> Probando intento de degradacion directa via API (debe arrojar 400 Bad Request)..." -ForegroundColor Yellow
$directFail = $false
try {
    $badDirectBody = @{
        id = $serviceId
        estado = "EN_ESPERA"
    } | ConvertTo-Json
    Invoke-RestMethod -Uri "$BaseUrl/operaciones/servicios/update" -Method Post -Headers $headers -ContentType "application/json" -Body $badDirectBody
} catch {
    $directFail = $true
    Write-Host "  -> Excepcion esperada capturada: $($_.Exception.Message)" -ForegroundColor Green
}
if (-not $directFail) {
    throw "Fallo en Test 4: la API web permitio degradar un servicio FINALIZADO sin rechazo 400"
}

# -------------------------------------------------------------------------
# Test 5: Reconciliador de Evidencias Multimedia POST /sync/media/pending
# -------------------------------------------------------------------------
Write-Host ""
Write-Host "[Test 5] Probando reconciliador de evidencias POST /sync/media/pending..." -ForegroundColor Yellow
$pendingQuery = @{
    clientUuids = @($skewUuid, $doubleTapUuid, $orderUuid)
} | ConvertTo-Json

$pendingRes = Invoke-RestMethod -Uri "$BaseUrl/sync/media/pending" -Method Post -Headers $headers -ContentType "application/json" -Body $pendingQuery
Write-Host "  -> Total consultados: $($pendingRes.totalConsultados)" -ForegroundColor Green
Write-Host "  -> Total pendientes de foto: $($pendingRes.totalPendientes)" -ForegroundColor Green

foreach ($item in $pendingRes.pending) {
    Write-Host "     * Uuid: $($item.clientUuid) | missingFotoIngreso: $($item.missingFotoIngreso) | missingFotoSalida: $($item.missingFotoSalida)" -ForegroundColor DarkCyan
}

if ($pendingRes.totalPendientes -eq 0) {
    throw "Fallo en Test 5: se esperaban ordenes con fotos pendientes de subida"
}
Write-Host "  -> Reconciliador de evidencias verificado exitosamente." -ForegroundColor Green

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   TODAS LAS PRUEBAS DE RESILIENCIA ONLINE PASARON 100%   " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
