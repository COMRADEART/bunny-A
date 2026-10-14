$ErrorActionPreference = 'Continue'
$out = Join-Path $PSScriptRoot 'results.txt'
'' | Set-Content -Encoding utf8 $out

function Mask([string]$s) {
  if ($null -eq $s) { return '' }
  # emails: keep first 2 chars of local part + domain
  $s = [regex]::Replace($s, '([A-Za-z0-9._%+\-]{1,2})[A-Za-z0-9._%+\-]*@([A-Za-z0-9.\-]+\.[A-Za-z]{2,})', '$1***@$2')
  # known token prefixes
  $s = [regex]::Replace($s, '\b(sk-[A-Za-z0-9_\-]{8,}|sk_[A-Za-z0-9_\-]{8,}|gh[opusr]_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|xai-[A-Za-z0-9_\-]{8,}|AIza[0-9A-Za-z_\-]{20,}|key_[A-Za-z0-9]{16,}|eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-\.]+)', '[REDACTED]')
  # UUIDs (account / org ids)
  $s = [regex]::Replace($s, '\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b', '[REDACTED-UUID]')
  # long opaque mixed alnum strings (>=32 chars, contains both letters and digits), skip paths
  $s = [regex]::Replace($s, '(?<![\\/\w])(?=[A-Za-z0-9_\-]*[0-9])(?=[A-Za-z0-9_\-]*[A-Za-z])[A-Za-z0-9_\-]{32,}(?![\\/\w])', '[REDACTED]')
  # Token: lines (gh prints "Token: gho_****")
  $s = [regex]::Replace($s, '(?im)^(\s*-?\s*Token:\s*).*$', '$1[REDACTED]')
  # gh account names
  $s = [regex]::Replace($s, '(account\s+)([A-Za-z0-9\-_]{1,2})[A-Za-z0-9\-_]*', '$1$2***')
  return $s
}

function W([string]$t) { Add-Content -Encoding utf8 $out $t }

function Run([string]$label, [string]$exe, [string]$cmdArgs, [int]$timeoutSec = 15, [switch]$Unicode) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  if ($exe -match '\.(cmd|bat)$') { $psi.FileName = "$env:ComSpec"; $psi.Arguments = "/d /c `"`"$exe`" $cmdArgs`"" }
  else { $psi.FileName = $exe; $psi.Arguments = $cmdArgs }
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.RedirectStandardInput = $true
  $psi.CreateNoWindow = $true
  if ($Unicode) { $psi.StandardOutputEncoding = [Text.Encoding]::Unicode; $psi.StandardErrorEncoding = [Text.Encoding]::Unicode }
  else { $psi.StandardOutputEncoding = [Text.Encoding]::UTF8; $psi.StandardErrorEncoding = [Text.Encoding]::UTF8 }
  $psi.EnvironmentVariables['NO_COLOR'] = '1'
  $psi.EnvironmentVariables['BROWSER'] = 'none'
  $psi.EnvironmentVariables['GH_NO_UPDATE_NOTIFIER'] = '1'
  $psi.EnvironmentVariables['GH_PROMPT_DISABLED'] = '1'
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $p = New-Object System.Diagnostics.Process; $p.StartInfo = $psi
  try { [void]$p.Start() } catch { W "### $label`nCMD: $exe $cmdArgs`nSTART-ERROR: $($_.Exception.Message)`n"; return }
  $p.StandardInput.Close()
  $to = $p.StandardOutput.ReadToEndAsync(); $te = $p.StandardError.ReadToEndAsync()
  $done = $p.WaitForExit($timeoutSec * 1000)
  $timedOut = $false
  if (-not $done) { $timedOut = $true; & taskkill.exe /T /F /PID $p.Id 2>&1 | Out-Null; [void]$p.WaitForExit(5000) }
  [void]$to.Wait(5000); [void]$te.Wait(5000)
  $ms = $sw.ElapsedMilliseconds
  $code = if ($timedOut) { 'TIMEOUT' } else { $p.ExitCode }
  $o = if ($to.IsCompleted) { $to.Result } else { '' }
  $e = if ($te.IsCompleted) { $te.Result } else { '' }
  $o = ($o -replace "\x1b\[[0-9;?]*[A-Za-z]", '') ; $e = ($e -replace "\x1b\[[0-9;?]*[A-Za-z]", '')
  W "### $label"
  W "CMD: $exe $cmdArgs"
  W "EXIT: $code   ELAPSED_MS: $ms"
  W "STDOUT:"; W (Mask $o).TrimEnd()
  W "STDERR:"; W (Mask $e).TrimEnd()
  W ""
}

W "RUN_AT: $(Get-Date -Format o)"
$env:WSL_UTF8 = '1'

# version probes
$ver = @(
  @('claude', 'C:\Users\allam\.local\bin\claude.exe'),
  @('codex', 'C:\Users\allam\AppData\Local\Programs\OpenAI\Codex\bin\codex.exe'),
  @('cursor-agent', 'C:\Users\allam\AppData\Local\cursor-agent\cursor-agent.cmd'),
  @('agent(PATH-first=grok)', 'C:\Users\allam\.grok\bin\agent.exe'),
  @('agent(cursor)', 'C:\Users\allam\AppData\Local\cursor-agent\agent.cmd'),
  @('cline', 'C:\Users\allam\AppData\Roaming\npm\cline.cmd'),
  @('opencode', 'C:\Users\allam\AppData\Roaming\npm\opencode.cmd'),
  @('gemini', 'C:\Users\allam\AppData\Roaming\npm\gemini.cmd'),
  @('gh', 'C:\Program Files\GitHub CLI\gh.exe'),
  @('ollama', 'C:\Users\allam\AppData\Local\Programs\Ollama\ollama.exe'),
  @('grok', 'C:\Users\allam\.grok\bin\grok.exe')
)
foreach ($v in $ver) { Run "$($v[0]) --version" $v[1] '--version' 15 }
Run 'wsl --version' 'C:\Windows\System32\wsl.exe' '--version' 15

# status probes (documented read-only)
Run 'codex login status' 'C:\Users\allam\AppData\Local\Programs\OpenAI\Codex\bin\codex.exe' 'login status' 15
Run 'claude auth status' 'C:\Users\allam\.local\bin\claude.exe' 'auth status' 15
Run 'cursor-agent status' 'C:\Users\allam\AppData\Local\cursor-agent\cursor-agent.cmd' 'status' 20
Run 'agent status (cursor agent.cmd)' 'C:\Users\allam\AppData\Local\cursor-agent\agent.cmd' 'status' 20
Run 'cline --help' 'C:\Users\allam\AppData\Roaming\npm\cline.cmd' '--help' 15
Run 'opencode auth list' 'C:\Users\allam\AppData\Roaming\npm\opencode.cmd' 'auth list' 20
Run 'gh auth status' 'C:\Program Files\GitHub CLI\gh.exe' 'auth status' 15
Run 'gh extension list' 'C:\Program Files\GitHub CLI\gh.exe' 'extension list' 15
Run 'ollama list' 'C:\Users\allam\AppData\Local\Programs\Ollama\ollama.exe' 'list' 15

# presence-only path checks
W "### PATH EXISTENCE (Test-Path only, contents never read)"
$paths = @(
  "$env:USERPROFILE\.codex\auth.json", "$env:USERPROFILE\.codex\config.toml", "$env:USERPROFILE\.codex",
  "$env:USERPROFILE\.claude\.credentials.json", "$env:USERPROFILE\.claude", "$env:USERPROFILE\.claude.json",
  "$env:USERPROFILE\.cursor", "$env:USERPROFILE\.cursor\cli-config.json",
  "$env:APPDATA\GitHub CLI\hosts.yml", "$env:USERPROFILE\.config\gh\hosts.yml",
  "$env:USERPROFILE\.local\share\opencode\auth.json", "$env:LOCALAPPDATA\opencode\auth.json", "$env:USERPROFILE\.config\opencode",
  "$env:USERPROFILE\.ollama", "$env:USERPROFILE\.ollama\id_ed25519", "$env:USERPROFILE\.ollama\id_ed25519.pub",
  "$env:USERPROFILE\.gemini", "$env:USERPROFILE\.gemini\oauth_creds.json", "$env:USERPROFILE\.gemini\settings.json",
  "$env:USERPROFILE\.cline", "$env:USERPROFILE\.grok", "$env:USERPROFILE\.grok\auth.json",
  "$env:USERPROFILE\.copilot", "$env:LOCALAPPDATA\github-copilot"
)
foreach ($pth in $paths) { $ex = Test-Path -LiteralPath $pth; $kind = if ($ex) { if (Test-Path -LiteralPath $pth -PathType Container) { 'dir' } else { 'file' } } else { '-' }; W ("{0,-6} {1,-5} {2}" -f $ex, $kind, $pth) }
W ""

# env var presence only
W "### ENV VAR PRESENCE (value never printed; length only)"
$vars = 'ANTHROPIC_API_KEY','OPENAI_API_KEY','CURSOR_API_KEY','XAI_API_KEY','GEMINI_API_KEY','GOOGLE_API_KEY','OPENROUTER_API_KEY','CLAUDE_CODE_OAUTH_TOKEN','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL','GH_TOKEN','GITHUB_TOKEN','OLLAMA_HOST','CLINE_API_KEY'
foreach ($vn in $vars) {
  $r = foreach ($scope in 'Process','User','Machine') { $val = [Environment]::GetEnvironmentVariable($vn, $scope); if ([string]::IsNullOrEmpty($val)) { "${scope}=unset" } else { "${scope}=SET(len=$($val.Length))" } }
  W ("{0,-26} {1}" -f $vn, ($r -join '  '))
}
W "END"
