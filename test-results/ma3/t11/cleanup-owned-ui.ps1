$ErrorActionPreference = 'Stop'
# One-time cleanup receipt for the final-pinned live harness. Its npm parent
# exited on Windows, leaving this exact test-only wrapper/Vite tree alive.
$t11Pid = 27444
$t11Before = Get-CimInstance Win32_Process -Filter "ProcessId=$t11Pid"
if (-not $t11Before -or
    $t11Before.CommandLine -notlike '*scripts/with-app-env.mjs*--port 8096 --strictPort*' -or
    $t11Before.CreationDate.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss') -ne '2026-10-12T00:43:28') {
    throw 'Exact T11 test UI identity did not match; no process stopped.'
}
$t11Vite = Get-CimInstance Win32_Process -Filter 'ProcessId=43464'
if (-not $t11Vite -or $t11Vite.ParentProcessId -ne $t11Pid -or
    $t11Vite.CommandLine -notlike '*vite/bin/vite.js*--port 8096 --strictPort*') {
    throw 'Exact T11 test Vite child did not match; no process stopped.'
}
& taskkill.exe /PID $t11Pid /T /F | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Test-owned UI tree cleanup failed.' }
Start-Sleep -Milliseconds 500
$t11After = @(Get-NetTCPConnection -State Listen -LocalPort 8096 -ErrorAction SilentlyContinue)
$t11Receipt = [ordered]@{
    classification = 'LIVE exact PID/start-time/command-line cleanup of T11 harness UI, outside Host provider containment'
    sourcePin = '032954fad7c0d66097a1e6efe502eda21a66c3ce'
    at = [DateTime]::UtcNow.ToString('o')
    reason = 'Windows npm parent termination left its test-only UI child tree; final acceptance cleanup identified and closed that tree.'
    wrapperPid = $t11Pid
    wrapperStartedAt = $t11Before.CreationDate.ToUniversalTime().ToString('o')
    vitePid = 43464
    testPort = 8096
    testListenerClosed = $t11After.Count -eq 0
    protectedPortsUntouched = @(8080, 8084, 43119, 43145)
    result = $(if ($t11After.Count -eq 0) { 'PASS' } else { 'FAIL' })
}
$t11Receipt | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath 'test-results/ma3/t11/test-ui-cleanup.json' -Encoding utf8
$t11Receipt | ConvertTo-Json -Depth 4
if ($t11After.Count) { throw 'Test listener remained open.' }
