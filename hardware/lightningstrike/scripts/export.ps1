$env:PSModulePath = "$PSHOME\Modules;" + $env:PSModulePath
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path $PSScriptRoot -Parent)
$env:PATH = "$PWD\node_modules\.bin;$env:PATH"
foreach ($item in @(
	@('gerbers', 'lightningstrike-gerbers.zip'),
	@('readable-netlist', 'netlist.txt'),
	@('glb', 'lightningstrike.glb')
)) {
	& tsci.cmd export dist/index/circuit.json -f $item[0] -o "$PWD/dist/$($item[1])"
	if ($LASTEXITCODE -ne 0) { throw "Export failed: $($item[0])" }
}
foreach ($side in @('top', 'bottom')) {
	& tsci.cmd export dist/index/circuit.json -f assembly-svg --layer $side -o "$PWD/dist/assembly-$side.svg"
	if ($LASTEXITCODE -ne 0) { throw "Assembly drawing failed: $side" }
}
& node scripts/export-assembly.mjs
if ($LASTEXITCODE -ne 0) { throw 'Assembly export failed.' }
& node scripts/render-3d.mjs
if ($LASTEXITCODE -ne 0) { throw '3D rendering failed.' }
& node scripts/review-gerbers.mjs
if ($LASTEXITCODE -ne 0) { throw 'Gerber review failed.' }
& node scripts/package.mjs
if ($LASTEXITCODE -ne 0) { throw 'Package validation failed.' }
