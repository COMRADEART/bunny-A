$ErrorActionPreference='Stop'
$env:PSModulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules'
$refusal=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'preflight-refusal.json') -Raw | ConvertFrom-Json
$all=@(Get-CimInstance Win32_Process -ErrorAction Stop)
$rolePids=@($refusal.roles | ForEach-Object ProcessId)
$expectedConsole=Join-Path $env:WINDIR 'System32\conhost.exe'
$signature=Get-AuthenticodeSignature -LiteralPath $expectedConsole
$records=@()
foreach($child in @($all | Where-Object { $_.ParentProcessId -in $rolePids -and $_.ProcessId -notin $rolePids })) {
 $parent=$all | Where-Object ProcessId -eq $child.ParentProcessId
 $records+=@{pid=$child.ProcessId;parentPid=$child.ParentProcessId;executable=$child.ExecutablePath;createdAt=$child.CreationDate.ToUniversalTime().ToString('o');millisecondsAfterParentCreation=($child.CreationDate.ToUniversalTime()-$parent.CreationDate.ToUniversalTime()).TotalMilliseconds;matchesSystemConsoleHost=[String]::Equals($child.ExecutablePath,$expectedConsole,[StringComparison]::OrdinalIgnoreCase);terminationAttempted=$false}
}
$dev=Invoke-RestMethod 'http://127.0.0.1:43139/health' -TimeoutSec 5
$calculator=@($all | Where-Object { $_.Name -in @('CalculatorApp.exe','Calculator.exe') } | Select-Object ProcessId,ParentProcessId,ExecutablePath,@{Name='createdAt';Expression={$_.CreationDate.ToUniversalTime().ToString('o')}})
$out=[ordered]@{recordedAt=[DateTime]::UtcNow.ToString('o');classification='LIVE VERIFIED diagnostic only';refusalAt=$refusal.recordedAt;controllerLine=57;failure='Unexpected owned-role descendants';diagnostic='The five-role controller did not model Windows console-support descendants. Read-only follow-up found four System32 conhost.exe children born 9-20 milliseconds after their respective corroborated Node/cloudflared parents.';systemConsolePath=$expectedConsole;systemConsoleSha256=(Get-FileHash -LiteralPath $expectedConsole -Algorithm SHA256).Hash.ToLower();signatureStatus=[string]$signature.Status;signerSubject=$signature.SignerCertificate.Subject;descendants=$records;noKillAuthorityInferredFromDiagnosis=$true;anyStopOrSelectionRetryAfterRefusal=$false;developmentHealth=$dev;calculatorProcesses=$calculator;newProductionQaDevicesCreated=0;candidateAltered=$false;activationAuthorized=$true;activationPerformed=$false;nextAttemptRequirements='Model and corroborate expected console-support descendants without name-based cleanup or automatic expanded kill authority; then perform an entirely fresh preflight and backup. Current attempt is stopped under the user failure rule.'}
$out | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'refusal-diagnosis.json') -Encoding utf8
$out | ConvertTo-Json -Depth 10
