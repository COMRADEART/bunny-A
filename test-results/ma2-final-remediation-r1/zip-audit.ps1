$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$name='Bunny-A-Windows-v26-MA2-R1'
$folder=Join-Path (Get-Location).Path ('releases\'+$name)
$manifest=Get-Content -LiteralPath (Join-Path $folder 'release-manifest.json') -Raw | ConvertFrom-Json
$expected=@{};foreach($f in $manifest.files){$expected[$f.path]=@{sha256=$f.sha256;bytes=$f.bytes}}
$expected['release-manifest.json']=@{sha256=(Get-FileHash -LiteralPath (Join-Path $folder 'release-manifest.json') -Algorithm SHA256).Hash.ToLower();bytes=(Get-Item -LiteralPath (Join-Path $folder 'release-manifest.json')).Length}
$zip=[IO.Compression.ZipFile]::OpenRead($folder+'.zip')
$rows=@();$seen=@{}
try {foreach($entry in $zip.Entries){if(-not $entry.Name){continue};$path=$entry.FullName.Replace('\','/');if(-not $path.StartsWith($name+'/',[StringComparison]::Ordinal)){throw 'ZIP root prefix differs'};$path=$path.Substring($name.Length+1);if($seen.ContainsKey($path)-or -not $expected.ContainsKey($path)) {throw 'Duplicate or unlisted ZIP entry'};$seen[$path]=$true;$stream=$entry.Open();$hash=[Security.Cryptography.SHA256]::Create();try{$digest=[BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-','').ToLower()}finally{$hash.Dispose();$stream.Dispose()};if($digest -ne $expected[$path].sha256 -or $entry.Length -ne $expected[$path].bytes){throw 'ZIP byte mismatch'};$rows+=@{path=$path;bytes=$entry.Length;sha256=$digest}}}finally{$zip.Dispose()}
if($seen.Count -ne $expected.Count) {throw 'ZIP missing entries'}
@{recordedAt=[DateTime]::UtcNow.ToString('o');classification='STATIC VERIFIED';zip=(Get-FileHash -LiteralPath ($folder+'.zip') -Algorithm SHA256).Hash.ToLower();entries=$rows;checked=$seen.Count;manifestAndAllCoveredFilesMatch=$true;separatorNormalization='Exact release root prefix stripped and ZIP backslashes normalized to manifest forward slashes; directory placeholders excluded; no extraction performed'} | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $PSScriptRoot 'zip-audit.json') -Encoding utf8
