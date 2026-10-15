# Visual Experience 2.0: copied from t13-3/nc-retry/run-final-regression.ps1; only the checkout folder prefix and the repo-root depth differ.
# M-A-3 T13.3 N-C: copied from gate-j/run-final-regression.ps1; only the checkout folder prefix differs.
# M-A-3 T13.3 Gate I: full regression of the exact final source in a fresh detached worktree (never the working tree).
# The checkout reuses the workspace's installed node_modules and the pin-verified staged whisper vendor folder through
# junctions, and gets a copy of the Node runtime license notice the packager requires; all three are gitignored build
# inputs, the same ones the accepted T13.2 regression used. As in T13.2, each `&&` part of `npm test` runs as its own
# step so one failing suite never hides the others. Logs are UTF-8.
# Usage: powershell -NoProfile -File run-final-regression.ps1 -Commit <sha> -Out <folder>
param([Parameter(Mandatory)][string]$Commit, [Parameter(Mandatory)][string]$Out)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$sha = (git -C $repo rev-parse --verify ($Commit + '^{commit}')).Trim()
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$Out = (Resolve-Path $Out).Path
$checkout = Join-Path ([IO.Path]::GetTempPath()) ('bunny-ve2-' + $sha.Substring(0, 12))
if (Test-Path -LiteralPath $checkout) { throw "Checkout folder exists: $checkout" }
git -C $repo worktree add --detach $checkout $sha | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'worktree add failed' }
try {
  New-Item -ItemType Junction -Path (Join-Path $checkout 'node_modules') -Target (Join-Path $repo 'node_modules') | Out-Null
  New-Item -ItemType Junction -Path (Join-Path $checkout 'native\voice\vendor') -Target (Join-Path $repo 'native\voice\vendor') | Out-Null
  $license = 'releases\installed\JEV-Windows-v1\runtime\LICENSE'
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent (Join-Path $checkout $license)) | Out-Null
  Copy-Item -LiteralPath (Join-Path $repo $license) -Destination (Join-Path $checkout $license)
  $status = @(git -C $checkout status --porcelain --untracked-files=no)
  @($sha, "checkout $checkout", $(if ($status.Count -eq 0) { 'clean tracked tree at start' } else { 'DIRTY tracked tree at start' })) | Set-Content -Encoding ascii (Join-Path $Out 'source.txt')
  $parts = ((Get-Content -Raw (Join-Path $checkout 'package.json') | ConvertFrom-Json).scripts.test) -split ' && '
  if ($parts.Count -ne 3) { throw "Expected 3 parts in the npm test script, found $($parts.Count)." }
  $steps = [ordered]@{
    typecheck = 'npm run typecheck'
    lint      = 'npm run lint'
    build     = 'npm run build'
    pretest   = 'npm run pretest'
    scripts   = $parts[0]
    library   = $parts[1]
    agent     = $parts[2]
    ui        = 'npm run test:ui'
  }
  $exits = @()
  foreach ($name in $steps.Keys) {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    cmd /c "cd /d `"$checkout`" && $($steps[$name]) > `"$Out\$name.log`" 2>&1"
    $code = $LASTEXITCODE
    $exits += "$name exit=$code ms=$($watch.ElapsedMilliseconds)"
  }
  $exits | Set-Content -Encoding ascii (Join-Path $Out 'exits.txt')
  $after = @(git -C $checkout status --porcelain --untracked-files=no | Where-Object { $_ -notmatch ' test-results/' })
  @("tracked source files changed by the run (outside test-results): $($after.Count)") + $after | Add-Content -Encoding ascii (Join-Path $Out 'source.txt')
  $exits
} finally {
  # rmdir removes a junction itself and never its target; the worktree is removed only once both links are gone.
  $links = @((Join-Path $checkout 'node_modules'), (Join-Path $checkout 'native\voice\vendor'))
  foreach ($link in $links) { if (Test-Path -LiteralPath $link) { cmd /c "rmdir `"$link`"" | Out-Null } }
  if (@($links | Where-Object { Test-Path -LiteralPath $_ }).Count -eq 0) { git -C $repo worktree remove --force $checkout | Out-Null }
  else { Write-Warning "Junctions still present; worktree left in place: $checkout" }
}
