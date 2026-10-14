# M-A-3 T13.3 Gate H native Notch evidence wrapper: runs the Island in -SmokeTest against a disposable fixture Host
# (fake-host-styles.mjs). The hook file is a per-run script written by run-styles.ps1; it records the receipt.
# The repository root is found from this folder (test-results\ma3\t13-3\gate-h\notch), so no absolute path is baked in.
param([Parameter(Mandatory = $true)][string]$HookFile, [Parameter(Mandatory = $true)][string]$Pref, [Parameter(Mandatory = $true)][string]$Shots, [Parameter(Mandatory = $true)][string]$Cred, [Parameter(Mandatory = $true)][string]$Deploy)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..\..\..')).Path
$island = Join-Path $repo 'install\Bunny-Island.ps1'
$hook = [scriptblock]::Create((Get-Content -LiteralPath $HookFile -Raw))
& $island -SmokeTest -CredentialPath $Cred -DeploymentPath $Deploy -PreferencePath $Pref -ScreenshotDirectory $Shots -TestHook $hook
exit $LASTEXITCODE
