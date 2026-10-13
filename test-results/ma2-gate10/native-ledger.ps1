$ErrorActionPreference='Stop'
$root=Join-Path $PSScriptRoot 'baseline'
New-Item -ItemType Directory -Path $root -Force | Out-Null
$installRoot=Join-Path $env:LOCALAPPDATA 'Bunny-A'
$config=Get-Content -LiteralPath (Join-Path $installRoot 'install.json') -Raw | ConvertFrom-Json
$node=Join-Path $config.currentRelease.folder 'runtime\node.exe'
$inventory=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and ($_.ExecutablePath.StartsWith($installRoot+'\',[StringComparison]::OrdinalIgnoreCase)) } | ForEach-Object {
  $role='other installed process'
  if($_.CommandLine -and $_.CommandLine.Contains('Bunny-Host.mjs')) {$role='Host'}
  elseif($_.CommandLine -and $_.CommandLine.Contains('Bunny-Server.mjs')) {$role='gateway'}
  elseif($_.CommandLine -and $_.CommandLine -match 'bunny-tunnel\.mjs') {$role='tunnel worker'}
  elseif($_.Name -eq 'cloudflared.exe') {$role='cloudflared'}
  elseif($_.Name -eq 'Bunny-A.exe') {$role='app/Island'}
  [ordered]@{role=$role;pid=$_.ProcessId;parentPid=$_.ParentProcessId;executable=$_.ExecutablePath;createdAt=$_.CreationDate.ToUniversalTime().ToString('o');stateRoot=$config.stateRoot;commandArgumentsOmitted=$true}
})
$startup=[Environment]::GetFolderPath('Startup')
$shortcut=Join-Path $startup 'Bunny-A.lnk'
$link=(New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
$startupFiles=@(Get-ChildItem -LiteralPath $startup -File | ForEach-Object { @{name=$_.Name;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()} })
$registry=@()
foreach($path in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Run','HKLM:\Software\Microsoft\Windows\CurrentVersion\Run')) {
  if(Test-Path -LiteralPath $path) { $item=Get-ItemProperty -LiteralPath $path; foreach($prop in $item.PSObject.Properties){if($prop.Name -notlike 'PS*' -and ([string]$prop.Value -match 'Bunny|bun-router')) {$registry+=@{path=$path;name=$prop.Name;sha256=[BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes([string]$prop.Value))).Replace('-','').ToLowerInvariant()}}} }
}
$scheduled=@(Get-ScheduledTask -ErrorAction Stop | Where-Object { $_.TaskName -match 'Bunny' -or $_.Actions.Execute -match 'Bunny|bun-router' -or $_.Actions.Arguments -match 'Bunny|bun-router' } | Select-Object TaskName,TaskPath,State)
@{gate='M-A-2 T10';recordedAt=[DateTime]::UtcNow.ToString('o');classification='LIVE SAFE';processes=$inventory;shortcut=@{path=$shortcut;target=$link.TargetPath;arguments=$link.Arguments;workingDirectory=$link.WorkingDirectory;sha256=(Get-FileHash -LiteralPath $shortcut -Algorithm SHA256).Hash.ToLowerInvariant()};startupFiles=$startupFiles;matchingRunRegistry=$registry;matchingScheduledTasks=$scheduled;noMutation=$true} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $root 'native-ledger.json') -Encoding utf8
Write-Output 'Native release/process/startup ledger captured read-only; command arguments omitted.'
