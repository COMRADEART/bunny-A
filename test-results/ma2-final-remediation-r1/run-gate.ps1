param([ValidateSet('test','test:ui','typecheck','lint','build')][string]$Gate)
$ErrorActionPreference='Stop'
Get-ChildItem Env: | Where-Object { $_.Name -match '^(DATABASE_URL|BUNNY_.*|HOST_TOKEN|JEV_.*)$' } | ForEach-Object { Remove-Item -LiteralPath ('Env:'+$_.Name) }
$env:PSModulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules'
$label=@{'test'='full-tests';'test:ui'='ui-tests';'typecheck'='typecheck';'lint'='lint';'build'='build'}[$Gate]
$start=[DateTime]::UtcNow.ToString('o')
if($Gate -eq 'test') { & npm.cmd test *> (Join-Path $PSScriptRoot ($label+'.log')) }
else { & npm.cmd run $Gate *> (Join-Path $PSScriptRoot ($label+'.log')) }
$code=$LASTEXITCODE
[ordered]@{gate=$Gate;startedAt=$start;finishedAt=[DateTime]::UtcNow.ToString('o');exitCode=$code;productionEnvironmentRemoved=$true} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot ($label+'-exit.json')) -Encoding utf8
Get-Content -LiteralPath (Join-Path $PSScriptRoot ($label+'.log')) -Tail 16
exit $code
