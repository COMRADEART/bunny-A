$ErrorActionPreference = 'Stop'
$gateRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$workspaceRoot = (Resolve-Path -LiteralPath (Join-Path $gateRoot '..\..')).Path
$owner = Get-Content -LiteralPath (Join-Path $gateRoot 'v20-ui-gateway-owner.json') -Raw | ConvertFrom-Json
$expectedEntry = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'ui-gateway.mjs')).Path
if ($owner.entry -cne $expectedEntry) { throw 'Gateway entry does not match this acceptance tool.' }
if (-not $expectedEntry.StartsWith($workspaceRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Gateway entry outside workspace.' }
$native = Get-CimInstance Win32_Process -Filter "ProcessId = $($owner.pid)"
$record = [ordered]@{
  gate = 'M-A-2 T9'
  recordedAt = [DateTime]::UtcNow.ToString('o')
  temporaryUiGatewayOnly = $true
  processId = $owner.pid
  expectedEntry = $expectedEntry
  productionHostStopped = $false
  stagedHostStopped = $false
  developmentServerStopped = $false
  stopped = $false
}
if ($null -eq $native) {
  $record['alreadyExited'] = $true
} else {
  if (-not [String]::Equals($native.ExecutablePath, $owner.executable, [StringComparison]::OrdinalIgnoreCase)) { throw 'Gateway executable mismatch.' }
  if (-not $native.CommandLine.Contains($expectedEntry)) { throw 'Gateway command entry mismatch.' }
  $ownedProcess = [Diagnostics.Process]::GetProcessById([int]$owner.pid)
  try {
    $null = $ownedProcess.Handle
    $processStartUtc = $ownedProcess.StartTime.ToUniversalTime()
    # CIM reports microseconds; the held process handle exposes 100-nanosecond ticks.
    # Require the exact same timestamp after truncating only the sub-microsecond fraction.
    $processStartAtCimPrecision = $processStartUtc.Ticks - ($processStartUtc.Ticks % 10)
    if ($processStartAtCimPrecision -ne $native.CreationDate.ToUniversalTime().Ticks) { throw 'Gateway process lifetime mismatch.' }
    $record['freshExecutableMatch'] = $true
    $record['freshCommandEntryMatch'] = $true
    $record['processStartedAt'] = $processStartUtc.ToString('o')
    $record['cimCreatedAt'] = $native.CreationDate.ToUniversalTime().ToString('o')
    $record['timestampPrecision'] = 'Exact match at CIM microsecond precision; the initial strict nanosecond comparison refused cleanup without stopping a process.'
    $record['heldNativeProcessHandle'] = $true
    $ownedProcess.Kill()
    if (-not $ownedProcess.WaitForExit(10000)) { throw 'Gateway did not exit.' }
    $record['stopped'] = $true
  } finally {
    $ownedProcess.Dispose()
  }
}
$record | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $gateRoot 'v20-ui-gateway-cleanup.json') -Encoding utf8
Write-Output 'Temporary T9 UI gateway closed; staged, production and development Hosts left running.'
