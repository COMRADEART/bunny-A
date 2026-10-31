# MA5-S2 Sprint 2 notch persistence evidence wrapper: launches the real WPF Island in -SmokeTest with
# -TestHook converted from a hook file (the same pattern as test-results/ma3/t13/notch/wrapper.ps1), so
# the hook runs inside the Island process with the placement helpers in scope. The Sprint 2 hooks never
# read fixture-Host data; the Island's own presence poll only ever talks to the disposable host named in
# -Cred (ports 43800-43899), never production on 43119 / 8084.
param(
  [Parameter(Mandatory = $true)][string]$HookFile,
  [Parameter(Mandatory = $true)][string]$Pref,
  [Parameter(Mandatory = $true)][string]$Shots,
  [Parameter(Mandatory = $true)][string]$Cred,
  [Parameter(Mandatory = $true)][string]$Deploy
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$island = Join-Path $repo 'install\Bunny-Island.ps1'
$hook = [scriptblock]::Create((Get-Content -LiteralPath $HookFile -Raw))
& $island -SmokeTest -CredentialPath $Cred -DeploymentPath $Deploy -PreferencePath $Pref -ScreenshotDirectory $Shots -TestHook $hook
exit $LASTEXITCODE
