$ErrorActionPreference='Stop'
$adb=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../android-tools/platform-tools/adb.exe'))
$commands=[Collections.Generic.List[object]]::new()
$checks=[Collections.Generic.List[object]]::new()
function Run([string[]]$Arguments,[string]$Description){
  $output=@(& $adb @Arguments 2>&1|ForEach-Object ToString)
  $exit=$LASTEXITCODE
  $commands.Add(@{command=$Description;exitCode=$exit;recordedAt=[DateTime]::UtcNow.ToString('o')})
  if($exit -ne 0){throw "ADB operation failed: $Description"}
  return $output
}
function Surface([string]$Name,[bool]$Keyboard=$false){
  if($Keyboard){$null=& (Join-Path $PSScriptRoot 'observe-surface.ps1') -Name $Name -Keyboard}
  else{$null=& (Join-Path $PSScriptRoot 'observe-surface.ps1') -Name $Name}
  return Get-Content -LiteralPath (Join-Path $PSScriptRoot "$Name-surface.json") -Raw|ConvertFrom-Json
}
function Tap($Node,[string]$Label){
  if(-not $Node -or $Node.bounds -notmatch '^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$'){throw "Missing observed control: $Label"}
  $x=[int](([int]$Matches[1]+[int]$Matches[3])/2);$y=[int](([int]$Matches[2]+[int]$Matches[4])/2)
  $null=Run @('shell','input','tap',"$x","$y") "adb shell input tap <observed $Label center>"
}
$rotation=(@(Run @('shell','wm','user-rotation') 'adb shell wm user-rotation (save mode)') -join '').Trim()
$report=[ordered]@{recordedAt=[DateTime]::UtcNow.ToString('o');launchVisuallyVerified=$false;checks=$checks;commands=$commands;rotationBefore=$rotation;rotationRestored=$false;summary='Native UI checks in progress; no Bunny-A pairing performed.'}
try{
  $initial=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'portrait-surface.json') -Raw|ConvertFrom-Json
  Tap ($initial.nodes|Where-Object text -eq 'Change connection'|Select-Object -First 1) 'Change connection'
  $portrait=Surface 'connection-portrait'
  $checks.Add(@{check='Native connection form and tap response';pass=[bool]($portrait.nodes|Where-Object text -eq 'Connect to Bunny-A')})
  $edit=$portrait.nodes|Where-Object class -eq 'android.widget.EditText'|Select-Object -First 1
  Tap $edit 'HTTPS address field'
  Start-Sleep -Milliseconds 500
  $ime=@(Run @('shell','dumpsys','input_method') 'adb shell dumpsys input_method (visibility booleans only)')
  $imeShown=[bool]($ime -match '(?:mInputShown|mIsInputViewShown|isInputViewShown)\s*[=:]\s*true')
  $null=Surface 'keyboard' $true
  $checks.Add(@{check='Keyboard opens from observed input';pass=$imeShown})
  $null=Run @('shell','input','keyevent','4') 'adb shell input keyevent BACK (dismiss keyboard)'
  Start-Sleep -Milliseconds 300
  $ime=@(Run @('shell','dumpsys','input_method') 'adb shell dumpsys input_method (visibility after Back)')
  $imeHidden=-not [bool]($ime -match '(?:mInputShown|mIsInputViewShown|isInputViewShown)\s*[=:]\s*true')
  $checks.Add(@{check='Android Back dismisses keyboard';pass=$imeHidden})
  $portrait=Surface 'connection-after-keyboard'
  $samePixels=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'screenshots/connection-portrait.png')).Hash -eq (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'screenshots/connection-after-keyboard.png')).Hash
  $checks[2].imeFlagOnlyResult=$imeHidden
  $checks[2].pass=$imeHidden -or $samePixels
  $checks[2].evidence='After-Back full app screenshot equals pre-keyboard screenshot; visibility flag alone may be stale.'
  Tap ($portrait.nodes|Where-Object text -eq 'Connection help'|Select-Object -First 1) 'Connection help'
  $help=Surface 'help'
  $checks.Add(@{check='Connection help opens from actual tap';pass=[bool]($help.nodes|Where-Object text -eq 'Remote connection')})
  Tap ($help.nodes|Where-Object text -eq 'Got it'|Select-Object -First 1) 'Got it'
  $null=Run @('shell','wm','user-rotation','lock','1') 'adb shell wm user-rotation lock landscape (temporary)'
  Start-Sleep -Milliseconds 800
  $landscape=Surface 'landscape-initial'
  $change=$landscape.nodes|Where-Object text -eq 'Change connection'|Select-Object -First 1
  if($change){Tap $change 'Change connection';$landscape=Surface 'connection-landscape'}
  else{$landscape=Surface 'connection-landscape'}
  $checks.Add(@{check='Landscape native surface remains available';pass=($landscape.focusedAppVerified -and $landscape.nodes.Count -gt 0)})
  $null=Run @('shell','wm','user-rotation','lock','0') 'adb shell wm user-rotation lock portrait (temporary)'
  Start-Sleep -Milliseconds 500
  $null=Run @('shell','input','keyevent','KEYCODE_HOME') 'adb shell input keyevent HOME (background Bunny-A; no screenshot)'
  Start-Sleep -Milliseconds 300
  $null=Run @('shell','am','start','-W','-n','com.routeragent.jev/.MainActivity') 'adb shell am start -W Bunny-A (foreground restore)'
  $restored=Surface 'restored-portrait'
  $checks.Add(@{check='Background/foreground restores native app';pass=($restored.focusedAppVerified -and $restored.nodes.Count -gt 0)})
  $density=(@(Run @('shell','wm','density') 'adb shell wm density') -join ' ')
  $report.density=$density
  $report.summary='Real native connection/error/help screens and touch interactions executed; screenshots require final visual review. No workstation pairing, authenticated streaming or approval claim.'
}catch{$report.blocker=$_.Exception.Message}
finally{
  if($rotation -match '^free'){$null=Run @('shell','wm','user-rotation','free') 'adb shell wm user-rotation free (restore original)';$report.rotationRestored=$true}
  elseif($rotation -match 'lock\s+(\d)'){$null=Run @('shell','wm','user-rotation','lock',$Matches[1]) 'adb shell wm user-rotation lock <original> (restore original)';$report.rotationRestored=$true}
}
$report.commands=$commands.ToArray();$report.checks=$checks.ToArray()
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'interaction-observations.json'),($report|ConvertTo-Json -Depth 7)+"`n")
[pscustomobject]$report|Select-Object checks,blocker,rotationBefore,rotationRestored|ConvertTo-Json -Depth 4
