$ErrorActionPreference='Stop'
$out = Join-Path (Get-Location).Path 'test-results/ma2-final-remediation-r1/baseline'
$productionRoot=Join-Path $env:LOCALAPPDATA 'Bunny-A'
$all=@(Get-CimInstance Win32_Process)
$relevant=@($all | Where-Object { $_.ExecutablePath -match '\\Bunny-A(?:-(?:T.*|R1)-stage)?\\' -or $_.Name -match '^(Calculator|CalculatorApp|calc|cloudflared)\.exe$' -or ($_.CommandLine -match 'bun-router' -and $_.Name -notmatch 'powershell|pwsh|tail') } | ForEach-Object {
 $p=$_; [ordered]@{pid=$p.ProcessId;parentPid=$p.ParentProcessId;createdAt=$p.CreationDate.ToUniversalTime().ToString('o');executable=$p.ExecutablePath;commandLine=$p.CommandLine;session=$p.SessionId;parentExecutable=($all | Where-Object ProcessId -eq $p.ParentProcessId | Select-Object -First 1).ExecutablePath}
})
[ordered]@{recordedAt=[DateTime]::UtcNow.ToString('o');classification='FRESH LIVE VERIFIED';processes=$relevant;listeners=@(Get-NetTCPConnection -State Listen | Where-Object LocalPort -in @(43119,8084,43139,46129,8089) | Select-Object LocalAddress,LocalPort,OwningProcess)} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $out 'processes.json') -Encoding utf8
$wsh=New-Object -ComObject WScript.Shell
$shortcuts=@()
foreach($folder in @((Join-Path $env:APPDATA 'Microsoft/Windows/Start Menu/Programs/Startup'),'C:/ProgramData/Microsoft/Windows/Start Menu/Programs/Startup')){
 foreach($f in @(Get-ChildItem -LiteralPath $folder -Filter '*.lnk' -ErrorAction SilentlyContinue)){$s=$wsh.CreateShortcut($f.FullName);$shortcuts+=[ordered]@{path=$f.FullName;target=$s.TargetPath;arguments=$s.Arguments;workingDirectory=$s.WorkingDirectory;sha256=(Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLower();classification=$(if($f.Name -match 'Bunny'){'ACTIVE'}else{'UNRELATED'})}}
}
$runEntries=@();foreach($key in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Run','HKLM:\Software\Microsoft\Windows\CurrentVersion\Run')){if(Test-Path $key){$obj=Get-ItemProperty -LiteralPath $key;foreach($p in $obj.PSObject.Properties){if($p.Name -notmatch '^PS' -and ($p.Name -match 'bunny' -or $p.Value -match 'bunny')){$runEntries+=[ordered]@{key=$key;name=$p.Name;value=$p.Value}}}}}
$scheduled=@();$scheduledError=$null;try{$scheduled=@(Get-ScheduledTask | Where-Object { $_.TaskName -match 'bunny' -or ($_.Actions.Execute -join ' ') -match 'bunny' } | Select-Object TaskName,TaskPath,State,Actions,Triggers)}catch{$scheduledError=$_.Exception.Message}
[ordered]@{recordedAt=[DateTime]::UtcNow.ToString('o');classification='FRESH LIVE VERIFIED';shortcuts=$shortcuts;bunnyRunEntries=$runEntries;bunnyScheduledTasks=$scheduled;scheduledTaskInspectionError=$scheduledError;modified=$false} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $out 'startup.json') -Encoding utf8
& ./test-results/ma2-gate10/calculator-inventory.ps1 -OutputPath (Join-Path $out 'calculator.json')
Write-Output 'Read-only native identity, Startup and Calculator inventory recorded.'
