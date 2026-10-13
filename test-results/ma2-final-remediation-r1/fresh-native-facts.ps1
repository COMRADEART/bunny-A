$ErrorActionPreference='Stop'
$rec=$PSScriptRoot
$all=@(Get-CimInstance Win32_Process)
$dev=@($all | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'scripts[/\\]bunny-host\.mjs' })
if($dev.Count -ne 1) {throw 'Expected one separate development entry; no process action performed'}
$owner=Invoke-CimMethod -InputObject $dev[0] -MethodName GetOwner
$chain=@();$next=$dev[0]
for($i=0;$i -lt 5 -and $next;$i++) {
 $chain+=@{pid=$next.ProcessId;parentPid=$next.ParentProcessId;createdAt=$next.CreationDate.ToUniversalTime().ToString('o');executable=$next.ExecutablePath;commandLine=$(if($i -lt 4){$next.CommandLine}else{$null})}
 $next=$all | Where-Object ProcessId -eq $next.ParentProcessId | Select-Object -First 1
}
@{recordedAt=[DateTime]::UtcNow.ToString('o');classification='LIVE VERIFIED';owner=@{domain=$owner.Domain;user=$owner.User;returnValue=$owner.ReturnValue};ancestry=$chain;mechanism='Git Bash -> npm run host -> cmd -> source scripts/bunny-host.mjs; manually invoked npm host, not installed launcher';processStopped=$false;intent='Development entry purpose established; original human launch intent and reason for leaving it live remain unknown.'} | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $rec 'development-native.json') -Encoding utf8
$config=Get-Content -LiteralPath (Join-Path $env:LOCALAPPDATA 'Bunny-A\install.json') -Raw | ConvertFrom-Json
$relevant=@($all | Where-Object { $_.ExecutablePath -and ($_.ExecutablePath.StartsWith((Join-Path $env:LOCALAPPDATA 'Bunny-A\'),[StringComparison]::OrdinalIgnoreCase) -or $_.CommandLine -match 'Bunny-A-R1-stage|scripts[/\\]bunny-host\.mjs') } | ForEach-Object { @{pid=$_.ProcessId;parentPid=$_.ParentProcessId;createdAt=$_.CreationDate.ToUniversalTime().ToString('o');executable=$_.ExecutablePath;commandLine=$_.CommandLine} })
$path=Join-Path ([Environment]::GetFolderPath('Startup')) 'Bunny-A.lnk'
$link=(New-Object -ComObject WScript.Shell).CreateShortcut($path)
@{recordedAt=[DateTime]::UtcNow.ToString('o');classification='LIVE VERIFIED';processes=$relevant;listeners=@(Get-NetTCPConnection -State Listen | Where-Object LocalPort -in @(43119,8084,43139,46129,8089) | Select-Object LocalAddress,LocalPort,OwningProcess);startup=@{path=$path;sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLower();target=$link.TargetPath;arguments=$link.Arguments;workingDirectory=$link.WorkingDirectory};productionSelectionModified=$false} | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $rec 'pre-activation\native.json') -Encoding utf8
