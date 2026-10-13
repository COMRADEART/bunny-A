param([string]$OutputName='operational-diagnostic-identity.json')
$ErrorActionPreference='Stop'
$env:PSModulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules'
$source=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'capture-identity.ps1') -Raw
$needle=". (Join-Path `$PSScriptRoot 'console-ownership.ps1')"
$diagnostic=@'
. (Join-Path $PSScriptRoot 'console-ownership.ps1')
$script:originalSupportGetter=(Get-Command Get-R11ConsoleSupport).ScriptBlock
function Get-R11ConsoleSupport($Child,$Parent) {
 try { & $script:originalSupportGetter $Child $Parent }
 catch {
  @{recordedAt=[DateTime]::UtcNow.ToString('o');classification='LIVE VERIFIED read-only ownership refusal';child=@{pid=$Child.ProcessId;parentPid=$Child.ParentProcessId;createdAt=$Child.CreationDate.ToUniversalTime().ToString('o');executable=$Child.ExecutablePath;commandLine=$Child.CommandLine};parent=@{role=$Parent.role;pid=$Parent.pid;birthTicks=$Parent.ticks;executable=$Parent.executable};reason=$_.Exception.Message;noStopAttempted=$true;noAuthorityAdded=$true}|ConvertTo-Json -Depth 8|Set-Content (Join-Path $PSScriptRoot 'operational-refusal-detail.json') -Encoding utf8
  throw
 }
}
'@
if(-not $source.Contains($needle)){throw 'Diagnostic hook location changed'}
# Same trusted read-only identity controller; add logging only around its refusal.
$derived=Join-Path $PSScriptRoot 'diagnostic-capture.ps1'
[IO.File]::WriteAllText($derived,$source.Replace($needle,$diagnostic),(New-Object Text.UTF8Encoding($false)))
& $derived -OutputName $OutputName
