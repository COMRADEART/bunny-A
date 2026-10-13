# M-A-3 T10 notch evidence wrapper: runs the Island in -SmokeTest against the disposable fake Host (fake-host.mjs).
# The hook file is a per-run script written by run-notch.ps1; it takes the screenshot and the placement receipt.
param([Parameter(Mandatory = $true)][string]$HookFile, [Parameter(Mandatory = $true)][string]$Pref, [Parameter(Mandatory = $true)][string]$Shots, [Parameter(Mandatory = $true)][string]$Cred, [Parameter(Mandatory = $true)][string]$Deploy)
$ErrorActionPreference = 'Stop'
$hook = [scriptblock]::Create((Get-Content -LiteralPath $HookFile -Raw))
& 'C:/Users/allam/Documents/new/bun-router/install/Bunny-Island.ps1' -SmokeTest -CredentialPath $Cred -DeploymentPath $Deploy -PreferencePath $Pref -ScreenshotDirectory $Shots -TestHook $hook
exit $LASTEXITCODE
