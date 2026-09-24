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
$expectedHash = '251101C3EEAC22D7E7DFCF6796603279E5D1000283EB82D8F093780F7AFC6AA9'
if ((Get-FileHash -LiteralPath $routerJar -Algorithm SHA256).Hash -ne $expectedHash) {
	throw 'Freerouting JAR checksum mismatch.'
}
$routerJava = (Get-Command java -ErrorAction SilentlyContinue).Source
if (-not $routerJava) {
	$routerJava = Get-ChildItem 'C:\Program Files\Eclipse Adoptium\jdk-*\bin\java.exe' |
		Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $routerJava) { throw 'Install Java 25 or later before routing.' }
& npm.cmd run build:placement
if ($LASTEXITCODE -ne 0) { throw 'Placement build failed.' }
& node scripts/critical-routes.mjs
if ($LASTEXITCODE -ne 0) { throw 'Critical route generation failed.' }
& node scripts/export-dsn.mjs
if ($LASTEXITCODE -ne 0) { throw 'DSN export failed.' }
Push-Location dist
try {
	& $routerJava -jar $routerJar -de lightningstrike.dsn -do lightningstrike.ses -mp 50 -mt 2 -da --gui.enabled=false --logging.file.enabled=false --router.layers.routable=true,false,true,true,false,true
	if ($LASTEXITCODE -ne 0) { throw 'Freerouting failed.' }
# Validate the imported final copper below: merging DSN and SES directly can
# duplicate protected vias at sub-grid offsets and produce false hole findings.
} finally { Pop-Location }
& node scripts/import-ses.mjs
if ($LASTEXITCODE -ne 0) { throw 'SES import failed.' }
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Routed tscircuit build failed.' }
& npm.cmd run check:routes
if ($LASTEXITCODE -ne 0) { throw 'Final copper DRC failed.' }
& node scripts/review-electrical.mjs
if ($LASTEXITCODE -ne 0) { throw 'Electrical review failed.' }
