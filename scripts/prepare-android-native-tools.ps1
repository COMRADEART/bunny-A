$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$lock = Get-Content -LiteralPath (Join-Path $workspace 'android/native-preview-toolchain.json') -Raw | ConvertFrom-Json
if ($lock.schema -ne 'bunny-android-preview-toolchain.v1') { throw 'Unexpected Android toolchain lock schema.' }
$scratch = Join-Path $workspace ('test-results/android-tool-download-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $scratch -Force | Out-Null
function Get-Verified([string]$Url,[string]$Name,[string]$Expected) {
  $path=Join-Path $scratch $Name
  Invoke-WebRequest -Uri $Url -OutFile $path
  $actual=(Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
  if ($actual -ne $Expected) { throw ('Downloaded tool hash mismatch: '+$Name) }
  return $path
}
$aaptArchive=Get-Verified 'https://dl.google.com/dl/android/maven2/com/android/tools/build/aapt2/9.4.1-15978811/aapt2-9.4.1-15978811-windows.jar' 'aapt2.jar' $lock.sha256.aapt2Archive
$apksig=Get-Verified 'https://dl.google.com/dl/android/maven2/com/android/tools/build/apksig/9.4.1/apksig-9.4.1.jar' 'apksig.jar' $lock.sha256.apksigJar
$r8=Get-Verified 'https://dl.google.com/dl/android/maven2/com/android/tools/r8/9.4.28/r8-9.4.28.jar' 'r8.jar' $lock.sha256.r8Jar
$androidText=Join-Path $scratch 'android-35.base64'
Invoke-WebRequest -Uri 'https://android.googlesource.com/platform/prebuilts/sdk/+/3af7c93524be6f51e092b87b17f009f13ee98b43/35/public/android.jar?format=TEXT' -OutFile $androidText
$androidJar=Join-Path $scratch 'android.jar'
[IO.File]::WriteAllBytes($androidJar,[Convert]::FromBase64String([IO.File]::ReadAllText($androidText)))
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $androidJar).Hash.ToLowerInvariant() -ne $lock.sha256.androidJar) { throw 'Android platform jar hash mismatch.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[IO.Compression.ZipFile]::OpenRead($aaptArchive)
try {
  $entry=$zip.GetEntry('aapt2.exe'); if (-not $entry) { throw 'The verified AAPT2 archive has no executable.' }
  $aapt=Join-Path $scratch 'aapt2.exe'; $source=$entry.Open(); $destination=[IO.File]::Create($aapt)
  try { $source.CopyTo($destination) } finally { $destination.Dispose(); $source.Dispose() }
} finally { $zip.Dispose() }
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $aapt).Hash.ToLowerInvariant() -ne $lock.sha256.aapt2Exe) { throw 'Extracted AAPT2 hash mismatch.' }
$tools=Join-Path $workspace 'test-results/android-tools'
$items=@(
  @{source=$androidJar; destination=(Join-Path $tools 'android.jar'); hash=$lock.sha256.androidJar},
  @{source=$apksig; destination=(Join-Path $tools 'apksig.jar'); hash=$lock.sha256.apksigJar},
  @{source=$r8; destination=(Join-Path $tools 'r8.jar'); hash=$lock.sha256.r8Jar},
  @{source=$aapt; destination=(Join-Path $tools 'aapt2/aapt2.exe'); hash=$lock.sha256.aapt2Exe}
)
foreach($item in $items) {
  if ((Test-Path -LiteralPath $item.destination) -and (Get-FileHash -Algorithm SHA256 -LiteralPath $item.destination).Hash.ToLowerInvariant() -ne $item.hash) {
    throw ('Existing Android tool differs from lock; left unchanged: '+$item.destination)
  }
}
New-Item -ItemType Directory -Force -Path $tools,(Join-Path $tools 'aapt2') | Out-Null
foreach($item in $items) { if(-not (Test-Path -LiteralPath $item.destination)) { Copy-Item -LiteralPath $item.source -Destination $item.destination } }
Write-Output 'Verified Android preview build tools are staged. Download files remain in the isolated test-results directory.'
