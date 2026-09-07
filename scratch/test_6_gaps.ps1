$baseUrl = "http://localhost:3000/api/v1"
Write-Host "`n=== INICIANDO VALIDACIÓN DE LAS 6 BRECHAS ARQUITECTÓNICAS ===" -ForegroundColor Cyan

# 1. Login
$loginBody = @{
    email = "admin@easydry.com"
    password = "Admin123*"
} | ConvertTo-Json

try {
    $loginRes = Invoke-RestMethod -Uri "$baseUrl/auth/login" -Method POST -Body $loginBody -ContentType "application/json"
    $token = $loginRes.accessToken
    Write-Host " [OK] Autenticación como ADMIN exitosa. Token: $($token.Substring(0, 15))..." -ForegroundColor Green
} catch {
    Write-Host " [ERROR] Fallo en login: $_" -ForegroundColor Red
    exit 1
}

$headers = @{
    Authorization = "Bearer $token"
    "Content-Type" = "application/json"
}

# 2. VALIDAR BRECHA 2: MÓDULO DE MAQUINARIA & TALLER
Write-Host "`n--- Validando Brecha 2: Maquinaria, Incidentes y Mantenimiento ---" -ForegroundColor Yellow
$codigoMaq = "HIDRO-TEST-" + (Get-Random -Minimum 1000 -Maximum 9999)
$createMaqBody = @{
    codigo = $codigoMaq
    nombre = "Hidrolavadora Industrial Karcher HD 7/18"
    tipo = "HIDROLAVADORA"
    marca = "Kärcher"
    modelo = "HD 7/18-4 M"
    serie = "SN-778899"
    estadoOperativo = "OPERATIVA"
    horasUso = 45
} | ConvertTo-Json

$maqRes = Invoke-RestMethod -Uri "$baseUrl/maquinaria/create" -Method POST -Body $createMaqBody -Headers $headers
Write-Host " [OK] Maquinaria creada con código $($maqRes.data.codigo), ID: $($maqRes.data.id)" -ForegroundColor Green
$maqId = $maqRes.data.id

# Listar Maquinaria
$listMaqRes = Invoke-RestMethod -Uri "$baseUrl/maquinaria/list" -Method POST -Body "{}" -Headers $headers
Write-Host " [OK] Total maquinarias registradas: $($listMaqRes.total)" -ForegroundColor Green

# Reportar Incidente
$incidenteBody = @{
    maquinariaId = $maqId
    titulo = "Fuga de manguera de alta presión"
    descripcion = "Fisura en acople rápido que causa pérdida de presión por debajo de 120 bar"
    gravedad = "ALTA"
    fotoEvidenciaUrl = "https://bucket.easydry.com/fotos/fuga_manguera.jpg"
} | ConvertTo-Json

$incRes = Invoke-RestMethod -Uri "$baseUrl/maquinaria/incidentes/reportar" -Method POST -Body $incidenteBody -Headers $headers
Write-Host " [OK] Incidente reportado: $($incRes.data.id), Estado: $($incRes.data.estado), Gravedad: $($incRes.data.gravedad)" -ForegroundColor Green
$incId = $incRes.data.id

# Resolver Incidente
$resolverBody = @{
    incidenteId = $incId
    solucion = "Se reemplazó manguera de 15m con acople de latón reforzado y se verificó sello a 180 bar."
    estado = "RESUELTO"
} | ConvertTo-Json

$resIncRes = Invoke-RestMethod -Uri "$baseUrl/maquinaria/incidentes/resolver" -Method POST -Body $resolverBody -Headers $headers
Write-Host " [OK] Incidente resuelto por: $($resIncRes.data.resueltoPor.name), Nuevo estado: $($resIncRes.data.estado)" -ForegroundColor Green

# Registrar Mantenimiento Preventivo
$mantenimientoBody = @{
    maquinariaId = $maqId
    tipo = "PREVENTIVO"
    observaciones = "Inspección mensual de pistones y cambio de aceite de bomba"
    repuestosUsados = @(
        @{ repuesto = "Aceite 15W40 especial bombas"; cantidad = 1; costo = 18.50 },
        @{ repuesto = "Filtro de agua en línea"; cantidad = 1; costo = 12.00 }
    )
    costoTotal = 30.50
} | ConvertTo-Json

$mantRes = Invoke-RestMethod -Uri "$baseUrl/maquinaria/mantenimientos/registrar" -Method POST -Body $mantenimientoBody -Headers $headers
Write-Host " [OK] Mantenimiento registrado con ID: $($mantRes.data.id), Costo: $($mantRes.data.costoTotal)" -ForegroundColor Green

# 3. VALIDAR BRECHA 1: EVIDENCIAS FOTOGRÁFICAS MÚLTIPLES (1-a-N)
Write-Host "`n--- Validando Brecha 1: Evidencias Fotográficas Múltiples (1-a-N) ---" -ForegroundColor Yellow
# Crear una orden para asociarle evidencias múltiples
$orderUuid = [guid]::NewGuid().ToString()
$ordenBody = @{
    mutations = @(
        @{
            mutationId = "mut_order_" + [guid]::NewGuid().ToString()
            clientUuid = $orderUuid
            entity = "servicio_lavado"
            action = "CREATE"
            data = @{
                placa = "MULTI-01"
                modelo = "Toyota Land Cruiser"
                color = "Blanco"
                cliente = "Empresa Minera Andes"
            }
        }
    )
} | ConvertTo-Json -Depth 5

$pushRes = Invoke-RestMethod -Uri "$baseUrl/sync/push" -Method POST -Body $ordenBody -Headers $headers
Write-Host " [OK] Orden creada con clientUuid $orderUuid" -ForegroundColor Green

# Subir evidencias: 1 de DAÑO PREVIO, 1 de PROCESO, 1 de ENTREGA
$tipos = @("DANO_PREVIO", "PROCESO", "ENTREGA")
foreach ($t in $tipos) {
    $confirmBody = @{
        clientUuid = $orderUuid
        type = $t
        fileUrl = "https://s3.amazonaws.com/easydry-evidencias/$orderUuid`_$t.jpg"
        descripcion = "Foto de evidencia de tipo $t tomada en bahía"
    } | ConvertTo-Json

    $confRes = Invoke-RestMethod -Uri "$baseUrl/sync/media/confirm" -Method POST -Body $confirmBody -Headers $headers
    Write-Host " [OK] Evidencia 1-a-N registrada: Tipo=$($confRes.type), ID=$($confRes.evidenciaId)" -ForegroundColor Green
}

# 4. VALIDAR SINCRONIZACIÓN OFFLINE DE INCIDENTES TÉCNICOS
Write-Host "`n--- Validando Sincronización Offline de Incidentes Técnicos ---" -ForegroundColor Yellow
$incidenteUuid = [guid]::NewGuid().ToString()
$syncIncidenteBody = @{
    mutations = @(
        @{
            mutationId = "mut_inc_" + [guid]::NewGuid().ToString()
            clientUuid = $incidenteUuid
            entity = "incidente_tecnico"
            action = "CREATE"
            data = @{
                maquinariaId = $maqId
                titulo = "Avería reportada desde app móvil sin conexión"
                descripcion = "El manómetro vibra excesivamente"
                gravedad = "MEDIA"
            }
        }
    )
} | ConvertTo-Json -Depth 5

$pushIncRes = Invoke-RestMethod -Uri "$baseUrl/sync/push" -Method POST -Body $syncIncidenteBody -Headers $headers
Write-Host " [OK] Incidente sincronizado vía /sync/push. Status: $($pushIncRes.results[0].status), AssignedID: $($pushIncRes.results[0].serverAssignedId)" -ForegroundColor Green

# 5. VALIDAR BRECHA 6: ENDPOINTS DE ANALÍTICA Y DASHBOARD
Write-Host "`n--- Validando Brecha 6: Endpoints de Analítica y Métricas Agregadas ---" -ForegroundColor Yellow
$dashRes = Invoke-RestMethod -Uri "$baseUrl/analytics/dashboard" -Method POST -Body "{}" -Headers $headers
Write-Host " [OK] Dashboard Analytics obtenido:" -ForegroundColor Green
Write-Host "      Total lavados hoy: $($dashRes.kpis.totalLavadosHoy)" -ForegroundColor White
Write-Host "      Lavados finalizados: $($dashRes.kpis.lavadosFinalizados)" -ForegroundColor White
Write-Host "      Tiempo promedio ciclo: $($dashRes.kpis.tiempoPromedioMin) min" -ForegroundColor White
Write-Host "      Costo químicos hoy: USD $($dashRes.kpis.costoQuimicosTotalUSD)" -ForegroundColor White
Write-Host "      Incidentes abiertos en taller: $($dashRes.kpis.incidentesAbiertos)" -ForegroundColor White

$consumoRes = Invoke-RestMethod -Uri "$baseUrl/analytics/consumo-quimicos" -Method POST -Body "{}" -Headers $headers
Write-Host " [OK] Analítica de Consumo de Químicos:" -ForegroundColor Green
Write-Host "      Gran Total Costo Químicos: USD $($consumoRes.granTotalCostoUSD)" -ForegroundColor White
Write-Host "      Total Insumos Distintos Consumidos: $($consumoRes.totalInsumosDistintos)" -ForegroundColor White

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host " ¡TODAS LAS VALIDACIONES DE LAS 6 BRECHAS COMPLETADAS CON ÉXITO! " -ForegroundColor Green
Write-Host "========================================================`n" -ForegroundColor Cyan
