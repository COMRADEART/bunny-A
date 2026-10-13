# M-A-3 T13 LIVE docking wrapper: runs the real install\Bunny-Island.ps1 in -SmokeTest against a REAL disposable Host that
# live-dock.mjs started (t11-mission-worker on 43870). The hook file is run inside the Island's own dispatcher tick.
# The repository root is found from this folder (test-results\ma3\t13\live-notch), so no absolute path is baked in.
param([Parameter(Mandatory = $true)][string]$HookFile, [Parameter(Mandatory = $true)][string]$Pref, [Parameter(Mandatory = $true)][string]$Shots, [Parameter(Mandatory = $true)][string]$Cred, [Parameter(Mandatory = $true)][string]$Deploy)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..\..')).Path
$island = Join-Path $repo 'install\Bunny-Island.ps1'
$hook = [scriptblock]::Create((Get-Content -LiteralPath $HookFile -Raw))
& $island -SmokeTest -CredentialPath $Cred -DeploymentPath $Deploy -PreferencePath $Pref -ScreenshotDirectory $Shots -TestHook $hook
exit $LASTEXITCODE
