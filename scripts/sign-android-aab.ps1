param(
  [string]$AabPath,
  [string]$OutputAab,
  [string]$KeystorePath,
  [string]$StorePassFile,
  [string]$StorePass,
  [string]$KeyAlias,
  [string]$KeyPassFile,
  [string]$KeyPass,
  [switch]$AllowTestKey,
  [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$tools = Join-Path $workspace 'test-results/android-tools'
$bundletool = Join-Path $tools 'bundletool.jar'

# 1. Locate Java and jarsigner
$previousErrorPreference = $ErrorActionPreference
try {
  $ErrorActionPreference = 'Continue'
  $javaReport = & java -XshowSettings:properties -version 2>&1
  $javaExit = $LASTEXITCODE
} finally { $ErrorActionPreference = $previousErrorPreference }
if ($javaExit -ne 0) { throw 'Java runtime probe failed.' }

$javaHomeLine = $javaReport | Select-String '^\s*java.home\s*='
$jdkRoot = ($javaHomeLine.ToString() -split '=',2)[1].Trim()
$jarsigner = Join-Path $jdkRoot 'bin/jarsigner.exe'

if (-not (Test-Path -LiteralPath $jarsigner)) {
  throw ("jarsigner.exe not found in JDK: " + $jarsigner)
}
if (-not (Test-Path -LiteralPath $bundletool)) {
  throw ("bundletool.jar not found at: " + $bundletool)
}

# 2. Determine target AAB path if not supplied
if (-not $AabPath) {
  $sourceDirectory = Join-Path $workspace 'android/app/src/main'
  $manifestFile = Join-Path $sourceDirectory 'AndroidManifest.xml'
  if (-not (Test-Path -LiteralPath $manifestFile)) {
    throw 'AndroidManifest.xml not found to infer AAB version.'
  }
  [xml]$manifest = Get-Content -LiteralPath $manifestFile -Raw
  $apkVersionCode = $manifest.manifest.GetAttribute('versionCode', 'http://schemas.android.com/apk/res/android')
  $AabPath = Join-Path $workspace ("releases/Bunny-A-Android-v$apkVersionCode.aab")
}

if (-not (Test-Path -LiteralPath $AabPath)) {
  throw ("Target AAB file does not exist: " + $AabPath)
}

# 3. Handle -VerifyOnly mode
if ($VerifyOnly) {
  Write-Output ("Verifying AAB: " + $AabPath)
  $verifyOutput = & $jarsigner -verify -verbose -certs $AabPath 2>&1
  $isSigned = ($verifyOutput | Select-String "jar verified\.") -ne $null
  if ($isSigned) {
    Write-Output "AAB Signature Status: SIGNED (jar verified)"
    $signerLines = $verifyOutput | Select-String "\[certificate is valid"
    Write-Output ($signerLines -join "`n")
  } else {
    Write-Output "AAB Signature Status: UNSIGNED"
  }

  Write-Output "Validating App Bundle structure with bundletool..."
  & java -jar $bundletool validate --bundle=$AabPath
  if ($LASTEXITCODE -ne 0) { throw "bundletool validate failed on $AabPath" }
  Write-Output "bundletool validate: PASSED"

  $hash = (Get-FileHash -LiteralPath $AabPath -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-Output ("AAB SHA-256: " + $hash)
  return [pscustomobject]@{
    AabPath = $AabPath
    Signed = $isSigned
    Sha256 = $hash
  }
}

# 4. Release signing stage requires an explicitly owner-approved upload key
if (-not $KeystorePath -and -not $AllowTestKey) {
  throw @"
RELEASE-SIGNING GATE REFUSAL:
No owner-approved upload key provided.
Release signing requires an explicitly owner-approved upload key (-KeystorePath, -KeyAlias, etc.)
or the explicit -AllowTestKey switch for local staging/development validation.
Production signing credentials must NEVER be created, rotated, or exposed without explicit owner approval.
"@
}

if ($AllowTestKey -and -not $KeystorePath) {
  $KeystorePath = Join-Path $tools 'signing/jev.p12'
  $StorePassFile = Join-Path $tools 'signing/password.txt'
  $KeyAlias = 'jev'
  Write-Warning "Using local test/development keystore (jev.p12). This is NOT a production upload key."
}

if (-not (Test-Path -LiteralPath $KeystorePath)) {
  throw ("Specified keystore does not exist: " + $KeystorePath)
}

if (-not $KeyAlias) {
  throw "Key alias must be specified via -KeyAlias."
}

# 5. Prepare target file for signing
$targetAab = if ($OutputAab) {
  Copy-Item -LiteralPath $AabPath -Destination $OutputAab -Force
  $OutputAab
} else {
  $AabPath
}

# Build jarsigner arguments
$signerArgs = @('-sigalg', 'SHA256withRSA', '-digestalg', 'SHA-256', '-keystore', $KeystorePath)
if ($StorePassFile) {
  $signerArgs += @('-storepass:file', $StorePassFile)
} elseif ($StorePass) {
  $signerArgs += @('-storepass', $StorePass)
} else {
  throw "Keystore password must be provided via -StorePass or -StorePassFile."
}

if ($KeyPassFile) {
  $signerArgs += @('-keypass:file', $KeyPassFile)
} elseif ($KeyPass) {
  $signerArgs += @('-keypass', $KeyPass)
} elseif ($StorePassFile) {
  $signerArgs += @('-keypass:file', $StorePassFile)
} elseif ($StorePass) {
  $signerArgs += @('-keypass', $StorePass)
}

$signerArgs += @($targetAab, $KeyAlias)

Write-Output ("Signing AAB with jarsigner: " + $targetAab)
& $jarsigner @signerArgs
if ($LASTEXITCODE -ne 0) { throw ("jarsigner failed to sign " + $targetAab) }

# 6. Verify signature
Write-Output "Verifying AAB signature..."
$verifyOutput = & $jarsigner -verify -verbose -certs $targetAab 2>&1
if ($LASTEXITCODE -ne 0 -or -not ($verifyOutput | Select-String "jar verified\.")) {
  throw ("Signature verification failed for " + $targetAab)
}
Write-Output "AAB signature verified: jar verified."

# 7. Validate bundletool on signed AAB
Write-Output "Validating signed App Bundle structure with bundletool..."
& java -jar $bundletool validate --bundle=$targetAab
if ($LASTEXITCODE -ne 0) { throw "bundletool validate failed on signed AAB" }
Write-Output "bundletool validate: PASSED"

# 8. Test split APK generation from signed AAB
$stagingApks = Join-Path $tools ('splits-verify-' + [Guid]::NewGuid().ToString('N') + '.apks')
try {
  $buildApksArgs = @('-jar', $bundletool, 'build-apks', ("--bundle=" + $targetAab), ("--output=" + $stagingApks), ("--ks=" + $KeystorePath), ("--ks-key-alias=" + $KeyAlias), '--overwrite')
  if ($StorePassFile) {
    $buildApksArgs += @("--ks-pass=file:$StorePassFile", "--key-pass=file:$StorePassFile")
  } else {
    $buildApksArgs += @("--ks-pass=pass:$StorePass", "--key-pass=pass:$StorePass")
  }
  & java @buildApksArgs
  if ($LASTEXITCODE -ne 0) { throw "bundletool build-apks failed with signed AAB" }
  Write-Output "bundletool build-apks split generation: PASSED"
} finally {
  Remove-Item -LiteralPath $stagingApks -Force -ErrorAction SilentlyContinue
}

$finalHash = (Get-FileHash -LiteralPath $targetAab -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText($targetAab + '.sha256', ($finalHash + '  ' + (Split-Path -Leaf $targetAab) + "`n"))

Write-Output ("Signed AAB: " + $targetAab)
Write-Output ("Signed AAB SHA-256: " + $finalHash)

[pscustomobject]@{
  Aab = $targetAab
  Sha256 = $finalHash
  Signed = $true
}
