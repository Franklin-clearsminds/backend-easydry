# ==============================================================================
# EasyDry Enterprise - Suite de Validacion Sincronizacion 100% "Papelito"
# Verifica los 6 Puntos Criticos: Causal Ordering, Tombstones, DLQ Replay,
# Limite de Chunking, No-Block Overdraft en Kardex, y OCC Smart Merge.
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
Write-Host "PASO 0: Autenticacion de Usuarios Demo" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$loginOp = Invoke-RestMethod -Uri "$baseUrl/auth/login" -Method POST `
    -Headers @{ "Content-Type" = "application/json" } `
    -Body '{"email":"operador.bahia01@easydry.com","password":"Admin123*"}'
$opToken = $loginOp.accessToken
$opAgenciaId = $loginOp.user.agenciaId

$loginAdmin = Invoke-RestMethod -Uri "$baseUrl/auth/login" -Method POST `
    -Headers @{ "Content-Type" = "application/json" } `
    -Body '{"email":"admin@easydry.com","password":"Admin123*"}'
$adminToken = $loginAdmin.accessToken

Assert-Condition ($opToken -ne $null) "Token de Operador obtenido"
Assert-Condition ($adminToken -ne $null) "Token de Administrador obtenido"

# Obtener bahias y catalogo con receta de la agencia
$bootstrap = Invoke-RestMethod -Uri "$baseUrl/sync/bootstrap" -Method POST `
    -Headers @{ "Authorization" = "Bearer $opToken"; "Content-Type" = "application/json" } `
    -Body '{}'
$bahiaId = $bootstrap.bahias[0].id

$catConReceta = $bootstrap.catalogos | Where-Object { $_.recetas.Count -gt 0 } | Select-Object -First 1
if ($catConReceta) {
    $catalogoId = $catConReceta.id
    Write-Host "Catalogo seleccionado con receta: $($catConReceta.nombre) (ID: $catalogoId)"
} else {
    $catalogoId = $bootstrap.catalogos[0].id
}
Assert-Condition ($bahiaId -ne $null) "Bahia valida disponible: $bahiaId"

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "PUNTO 1: Ordenamiento Causal en Lote (Causal Ordering)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
# Se envia un lote con orden deliberadamente invertido:
# Primero COMPLETE (timestamp 2000) y Segundo CREATE (timestamp 1000)
$causalUuid = "causal-" + [guid]::NewGuid().ToString()

$loteInvertido = @{
    deviceId = "device-causal-test"
    mutations = @(
        @{
            mutationId = "mut_child_complete_" + [guid]::NewGuid().ToString()
            clientUuid = $causalUuid
            entity = "servicio_lavado"
            action = "COMPLETE"
            timestamp = 2000000000
            data = @{
                id = $causalUuid
                estado = "FINALIZADO"
                fotoSalidaUrl = "https://storage.easydry.com/fotos/causal_out.jpg"
                observaciones = "Lavado causal completado exitosamente"
            }
        },
        @{
            mutationId = "mut_parent_create_" + [guid]::NewGuid().ToString()
            clientUuid = $causalUuid
            entity = "servicio_lavado"
            action = "CREATE"
            timestamp = 1000000000
            data = @{
                placa = "CAU-" + (Get-Random -Minimum 1000 -Maximum 9999)
                modelo = "Mazda CX-30"
                color = "Rojo Causal"
                servicioCatalogoId = $catalogoId
                bahiaId = $bahiaId
                estado = "EN_PROCESO"
                horaIngreso = (Get-Date).ToString("o")
            }
        }
    )
} | ConvertTo-Json -Depth 6

$resCausal = Invoke-RestMethod -Uri "$baseUrl/sync/push" -Method POST `
    -Headers @{ "Authorization" = "Bearer $opToken"; "Content-Type" = "application/json" } `
    -Body $loteInvertido

Assert-Condition ($resCausal.processed -eq 2) "Lote causal de 2 mutaciones procesado"
Assert-Condition ($resCausal.results[0].status -eq "APPLIED") "Mutacion padre ejecutada primero (Status APPLIED)"
Assert-Condition ($resCausal.results[1].status -eq "APPLIED") "Mutacion hija ejecutada segundo (Status APPLIED)"

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "PUNTO 4: Limite Estricto de Chunking en Backend (Max 50)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
# Crear lote excesivo de 51 mutaciones para verificar rechazo
$mutationsExcesivas = @()
for ($i = 1; $i -le 51; $i++) {
    $mutationsExcesivas += @{
        mutationId = "dummy_$i"
        clientUuid = "dummy_uuid_$i"
        entity = "servicio_lavado"
        action = "CREATE"
        timestamp = 1000 + $i
        data = @{
            placa = "DUM-0000"
            modelo = "Test"
            servicioCatalogoId = $catalogoId
            bahiaId = $bahiaId
        }
    }
}

$payloadExcesivo = @{
    deviceId = "device-chunk-test"
    mutations = $mutationsExcesivas
} | ConvertTo-Json -Depth 6

$chunkRechazado = $false
try {
    Invoke-RestMethod -Uri "$baseUrl/sync/push" -Method POST `
        -Headers @{ "Authorization" = "Bearer $opToken"; "Content-Type" = "application/json" } `
        -Body $payloadExcesivo
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($statusCode -eq 400) {
        $chunkRechazado = $true
    }
}
Assert-Condition ($chunkRechazado -eq $true) "Peticion con 51 mutaciones rechazada con 400 Bad Request por chunk limit"

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "PUNTO 2: Tombstones en /sync/pull (_deleted: true)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
# 1. Crear servicio
$tombUuid = "tomb-" + [guid]::NewGuid().ToString()
$crearServ = Invoke-RestMethod -Uri "$baseUrl/operaciones/servicios/create" -Method POST `
    -Headers @{ "Authorization" = "Bearer $opToken"; "Content-Type" = "application/json" } `
    -Body (@{
        placa = "TMB-" + (Get-Random -Minimum 1000 -Maximum 9999)
        modelo = "Hyundai Tucson"
        servicioCatalogoId = $catalogoId
        bahiaId = $bahiaId
        clientUuid = $tombUuid
    } | ConvertTo-Json)
$servId = $crearServ.id
Assert-Condition ($servId -ne $null) "Servicio para Tombstone creado: $servId"

# 2. Eliminarlo (Soft delete con deletedAt)
$delResult = Invoke-RestMethod -Uri "$baseUrl/operaciones/servicios/delete" -Method POST `
    -Headers @{ "Authorization" = "Bearer $adminToken"; "Content-Type" = "application/json" } `
    -Body (@{ id = $servId; motivo = "Vehiculo salio de bahia sin servicio" } | ConvertTo-Json)
Assert-Condition ($delResult.deletedAt -ne $null) "Servicio marcado con deletedAt no-nulo"
Assert-Condition ($delResult.estado -eq "CANCELADO") "Servicio en estado CANCELADO"

# 3. Pull incremental: debe entregar _deleted = true
$pullResult = Invoke-RestMethod -Uri "$baseUrl/sync/pull" -Method POST `
    -Headers @{ "Authorization" = "Bearer $opToken"; "Content-Type" = "application/json" } `
    -Body (@{ limit = 50 } | ConvertTo-Json)

$tombItem = $pullResult.items | Where-Object { $_.id -eq $servId }
Assert-Condition ($tombItem -ne $null) "Servicio borrado retornado en el pull"
Assert-Condition ($tombItem._deleted -eq $true) "Bandera _deleted es TRUE (SQLite eliminara registro zombi)"

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "PUNTO 5: No-Block Overdraft Policy en Kardex" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
# Un servicio completado offline debe finalizar y descontar stock incluso si queda negativo
$overdraftUuid = "noblock-" + [guid]::NewGuid().ToString()
$mutacionOverdraft = @{
    deviceId = "device-overdraft-test"
    mutations = @(
        @{
            mutationId = "mut_ob_" + [guid]::NewGuid().ToString()
            clientUuid = $overdraftUuid
            entity = "servicio_lavado"
            action = "CREATE"
            timestamp = 1000
            data = @{
                placa = "OB-" + (Get-Random -Minimum 1000 -Maximum 9999)
                modelo = "Chevrolet D-Max"
                servicioCatalogoId = $catalogoId
                bahiaId = $bahiaId
                estado = "FINALIZADO"
                fotoSalidaUrl = "https://storage.easydry.com/fotos/ob_out.jpg"
                observaciones = "Lavado completado en campo bajo No-Block Policy"
            }
        }
    )
} | ConvertTo-Json -Depth 6

$resOverdraft = Invoke-RestMethod -Uri "$baseUrl/sync/push" -Method POST `
    -Headers @{ "Authorization" = "Bearer $opToken"; "Content-Type" = "application/json" } `
    -Body $mutacionOverdraft

Assert-Condition ($resOverdraft.results[0].status -eq "APPLIED") "Servicio offline finalizado sin bloqueo de stock"

# Verificar Kardex con DataGrid
$kardexList = Invoke-RestMethod -Uri "$baseUrl/inventario/kardex/list" -Method POST `
    -Headers @{ "Authorization" = "Bearer $adminToken"; "Content-Type" = "application/json" } `
    -Body (@{ page = 1; pageSize = 20 } | ConvertTo-Json)

$itemsList = if ($kardexList.items) { $kardexList.items } else { $kardexList.data }
$kardexItem = $itemsList | Where-Object { $_.referenciaId -eq $resOverdraft.results[0].serverAssignedId }
Assert-Condition ($kardexItem -ne $null) "Movimiento de Kardex registrado para el servicio finalizado"
Assert-Condition ($kardexItem.tipoMovimiento -like "CONSUMO_SERVICIO*") "Tipo de movimiento auditado en Kardex: $($kardexItem.tipoMovimiento)"

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "PUNTO 6: Control de Versiones Optimista (OCC) y Merge Inteligente" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
# 1. Crear una orden base
$occUuid = "occ-" + [guid]::NewGuid().ToString()
$crearOcc = Invoke-RestMethod -Uri "$baseUrl/operaciones/servicios/create" -Method POST `
    -Headers @{ "Authorization" = "Bearer $opToken"; "Content-Type" = "application/json" } `
    -Body (@{
        placa = "OCC-" + (Get-Random -Minimum 1000 -Maximum 9999)
        modelo = "Nissan Qashqai"
        servicioCatalogoId = $catalogoId
        bahiaId = $bahiaId
        clientUuid = $occUuid
        observaciones = "Ingreso inicial"
    } | ConvertTo-Json)
$occServId = $crearOcc.id

# 2. Supervisor en Panel Web actualiza la orden (version pasa de 1 a 2)
$updateWeb = Invoke-RestMethod -Uri "$baseUrl/operaciones/servicios/update" -Method POST `
    -Headers @{ "Authorization" = "Bearer $adminToken"; "Content-Type" = "application/json" } `
    -Body (@{
        id = $occServId
        observaciones = "Nota agregada por supervisor en el Panel Web"
    } | ConvertTo-Json)
Assert-Condition ($updateWeb.version -ge 2) "Version del servidor incrementada en web a: $($updateWeb.version)"

# 3. El movil sin internet completa la orden basandose en version: 1
$loteOcc = @{
    deviceId = "device-occ-mobile"
    mutations = @(
        @{
            mutationId = "mut_occ_complete_" + [guid]::NewGuid().ToString()
            clientUuid = $occUuid
            entity = "servicio_lavado"
            action = "COMPLETE"
            timestamp = (Get-Date).ToFileTimeUtc()
            data = @{
                id = $occServId
                version = 1
                estado = "FINALIZADO"
                fotoSalidaUrl = "https://storage.easydry.com/fotos/occ_out.jpg"
                observaciones = "Detalle de limpieza profunda por operador movil"
            }
        }
    )
} | ConvertTo-Json -Depth 6

$resOcc = Invoke-RestMethod -Uri "$baseUrl/sync/push" -Method POST `
    -Headers @{ "Authorization" = "Bearer $opToken"; "Content-Type" = "application/json" } `
    -Body $loteOcc

Assert-Condition ($resOcc.results[0].status -eq "APPLIED") "Mutacion con OCC aplicada"

# 4. Verificar que se realizo el merge inteligente de observaciones
$detailOcc = Invoke-RestMethod -Uri "$baseUrl/operaciones/servicios/detail" -Method POST `
    -Headers @{ "Authorization" = "Bearer $adminToken"; "Content-Type" = "application/json" } `
    -Body (@{ id = $occServId } | ConvertTo-Json)

Assert-Condition ($detailOcc.observaciones -like "*supervisor en el Panel Web*") "Notas web preservadas en el merge"
Assert-Condition ($detailOcc.observaciones -like "*operador movil*") "Notas moviles adjuntadas en el merge"
Assert-Condition ($detailOcc.version -ge 3) "Version incrementada tras merge OCC a: $($detailOcc.version)"

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "PUNTO 3: Replay y Reingreso de Mutaciones en DLQ (/sync/dlq/replay)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
# 1. Aislar intencionalmente una mutacion en DLQ enviando attempts = 5
$dlqClientUuid = "dlq-poison-" + [guid]::NewGuid().ToString()
$mutacionVeneno = @{
    deviceId = "device-dlq-test"
    mutations = @(
        @{
            mutationId = "mut_dlq_poison_" + [guid]::NewGuid().ToString()
            clientUuid = $dlqClientUuid
            entity = "servicio_lavado"
            action = "UPDATE"
            attempts = 5
            timestamp = 1000
            data = @{
                id = "id-inexistente-para-forzar-error"
                observaciones = "Fallo provocado para DLQ"
            }
        }
    )
} | ConvertTo-Json -Depth 6

$resPoison = Invoke-RestMethod -Uri "$baseUrl/sync/push" -Method POST `
    -Headers @{ "Authorization" = "Bearer $opToken"; "Content-Type" = "application/json" } `
    -Body $mutacionVeneno

Assert-Condition ($resPoison.results[0].status -eq "DEAD_LETTER") "Mutacion aislada con status DEAD_LETTER"

# 2. Consultar la DLQ
$dlqItems = Invoke-RestMethod -Uri "$baseUrl/sync/dlq/list" -Method POST `
    -Headers @{ "Authorization" = "Bearer $adminToken"; "Content-Type" = "application/json" } `
    -Body '{"resuelto":false}'

$itemEnDlq = $dlqItems.items | Where-Object { $_.clientUuid -eq $dlqClientUuid }
Assert-Condition ($itemEnDlq -ne $null) "Mutacion encontrada en SyncDeadLetterQueue"

# 3. Administrador ejecuta Replay corrigiendo los datos a un CREATE valido
$replayPayload = @{
    dlqId = $itemEnDlq.id
    payloadCorregido = @{
        action = "CREATE"
        placa = "RPL-" + (Get-Random -Minimum 1000 -Maximum 9999)
        modelo = "Toyota Yaris Corregido"
        servicioCatalogoId = $catalogoId
        bahiaId = $bahiaId
        estado = "EN_PROCESO"
        observaciones = "Corregido y reinyectado por Administrador"
    }
} | ConvertTo-Json -Depth 6

$resReplay = Invoke-RestMethod -Uri "$baseUrl/sync/dlq/replay" -Method POST `
    -Headers @{ "Authorization" = "Bearer $adminToken"; "Content-Type" = "application/json" } `
    -Body $replayPayload

Assert-Condition ($resReplay.success -eq $true) "Replay de DLQ respondio con success: true"
Assert-Condition ($resReplay.replayed -eq $true) "Mutacion reinyectada y aplicada correctamente"
Assert-Condition ($resReplay.resuelto -eq $true) "Registro DLQ marcado como resuelto: true"

Write-Host "`n============================================================" -ForegroundColor Green
Write-Host "RESULTADO: LOS 6 PUNTOS 'PAPELITO' VERIFICADOS EXITOSAMENTE (100% OK)" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
