$env:PSModulePath = "$PSHOME\Modules;" + $env:PSModulePath
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $project
$toolDirectory = Join-Path $project '.tools'
New-Item -ItemType Directory -Path $toolDirectory -Force | Out-Null
$routerJar = Join-Path $toolDirectory 'freerouting-2.4.1.jar'
if (-not (Test-Path -LiteralPath $routerJar)) {
	Invoke-WebRequest 'https://github.com/freerouting/freerouting/releases/download/v2.4.1/freerouting-2.4.1.jar' -OutFile $routerJar
}
if ((Get-FileHash -LiteralPath $routerJar -Algorithm SHA256).Hash -ne '251101C3EEAC22D7E7DFCF6796603279E5D1000283EB82D8F093780F7AFC6AA9') {
	throw 'Freerouting JAR checksum mismatch.'
}
$routerJava = (Get-Command java -ErrorAction SilentlyContinue).Source
if (-not $routerJava) {
	$routerJava = Get-ChildItem 'C:\Program Files\Eclipse Adoptium\jdk-*\bin\java.exe' |
		Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $routerJava) { throw 'Install Java 25 or later before checking routes.' }
& node scripts/export-dsn.mjs dist/index/circuit.json dist/lightningstrike-final.dsn --routed
if ($LASTEXITCODE -ne 0) { throw 'Final copper export failed.' }
Push-Location dist
try {
	& $routerJava -jar $routerJar -de lightningstrike-final.dsn -drc final-drc.json -da --gui.enabled=false --logging.file.enabled=false
	if ($LASTEXITCODE -ne 0) { throw 'Independent DRC failed.' }
	$report = Get-Content final-drc.json -Raw | ConvertFrom-Json
	if ($report.unconnectedItems.Count -gt 0 -or $report.violations.Count -gt 0) { throw 'Independent DRC has findings.' }
	$hash = (Get-FileHash -LiteralPath index/circuit.json -Algorithm SHA256).Hash
	Set-Content -LiteralPath validated-circuit.sha256 -Value $hash -Encoding ascii
} finally { Pop-Location }
Write-Output 'Final copper: zero unconnected items and zero clearance violations.'
