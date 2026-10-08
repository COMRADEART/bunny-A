param([string]$Mode='review')
$ErrorActionPreference='Stop'
$bunnyEvidence=Join-Path (Get-Location) 'test-results/ma3/t8'
$fixture=Get-Content (Join-Path $bunnyEvidence 'ui-fixture.json') -Raw | ConvertFrom-Json
$package=Join-Path $bunnyEvidence 'package/Bunny-A-Windows-v27-MA3-T8-R4-TEST'
$global:t8NativeResult=@{classification='DISPOSABLE LIVE VERIFIED';mode=$Mode;sourceCommit='987afeace77520b9f4ef49e27b137dd01fb3fee8';physicalKeyboard='NOT TESTED';secondaryMonitorDpi='NOT TESTED';openNavigation='SIMULATED: event handler recorded URL without launching production gateway'}
$global:t8NativeMode=$Mode
$global:t8NativeEvidence=$bunnyEvidence
$hook={
 function Wait-T8Command {
  $until=[DateTime]::UtcNow.AddSeconds(15)
  while($bunnyPending -and [DateTime]::UtcNow -lt $until){
   $frame=[Windows.Threading.DispatcherFrame]::new();$tick=[Windows.Threading.DispatcherTimer]::new();$tick.Interval=[TimeSpan]::FromMilliseconds(100);$tick.Add_Tick({$tick.Stop();$frame.Continue=$false});$tick.Start();[Windows.Threading.Dispatcher]::PushFrame($frame)
  }
  if($bunnyPending){throw 'Native command acknowledgment timed out'}
  Update-Bunny
 }
 function Open-BunnyDashboard([string]$Query='') {$global:t8NativeResult.navigation=$Query}
 Update-Bunny
 if($global:t8NativeMode -eq 'offline') {
  if($bunnyOnline){throw 'Native Host unexpectedly online'}
  $global:t8NativeResult.offline=$bunnyControls.Presence.Text
  if($bunnyControls.CompactHealth.Visibility -ne 'Visible'){throw 'Collapsed Bar hides disconnection'}
  $global:t8NativeResult.compactHealthVisible=[string]$bunnyControls.CompactHealth.Visibility
  $global:t8NativeResult.compactHealthText=$bunnyControls.CompactHealth.Text
  $global:t8NativeResult.closedWindowOnly=$true
  [void](Save-BunnyScreenshot 'native-offline')
  $script:bunnyLastError=$null
  $global:t8NativeResult | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $global:t8NativeEvidence 'native-offline.json') -Encoding utf8
  return
 }
 if(-not $bunnyOnline){throw 'Native Bar did not connect'}
 $global:t8NativeResult.agentId=$bunnyCurrentAgentId
 $global:t8NativeResult.state=$bunnyControls.AgentState.Text
 $global:t8NativeResult.reviewVisible=[string]$bunnyControls.AgentReview.Visibility
 Invoke-BunnyClick $bunnyControls.AgentOpen
 if($global:t8NativeMode -eq 'review'){
  if($bunnyControls.AgentReview.Visibility -ne 'Visible'){throw 'Pending review not shown'}
  if($bunnyControls.AgentPause.IsEnabled){throw 'Pause incorrectly enabled for ungranted consent'}
  [void](Save-BunnyScreenshot 'native-pending')
 }elseif($global:t8NativeMode -eq 'stop'){
  Invoke-BunnyClick $bunnyControls.AgentStop
  $global:t8NativeResult.stopConfirmation=$bunnyControls.AgentBoundary.Text
  [void](Save-BunnyScreenshot 'native-stop-confirm')
  Invoke-BunnyClick $bunnyControls.AgentStop;Wait-T8Command
  $agent=@($bunnySnapshot.agents.agents | Where-Object id -eq $global:t8NativeResult.agentId)[0]
  if($agent.state -ne 'STOPPED'){throw 'Native stop not persisted'}
  $global:t8NativeResult.stopped=$agent.state
  [void](Save-BunnyScreenshot 'native-stopped')
 }elseif($global:t8NativeMode -eq 'pause'){
  Invoke-BunnyClick $bunnyControls.AgentPause;Wait-T8Command
  $agent=@($bunnySnapshot.agents.agents | Where-Object id -eq $global:t8NativeResult.agentId)[0]
  if($agent.state -ne 'PAUSED'){throw 'Native pause not persisted'}
  $global:t8NativeResult.paused=$agent.state
  Invoke-BunnyClick $bunnyControls.AgentResume;Wait-T8Command
  $agent=@($bunnySnapshot.agents.agents | Where-Object id -eq $global:t8NativeResult.agentId)[0]
  if($agent.state -ne 'PAUSED'){throw 'Resume bypassed missing canonical consent'}
  $global:t8NativeResult.resumeRefusedWithoutConsent=$true
  $global:t8NativeResult.resumeNotice=$bunnyControls.Notice.Text
  [void](Save-BunnyScreenshot 'native-paused')
 }
 $bunnyWindow.WindowState='Minimized';$bunnyWindow.WindowState='Normal';Update-Bunny
 $global:t8NativeResult.minimizeRestore='LIVE VERIFIED: WPF window-state API; no physical OS input'
 $global:t8NativeResult.closedWindowOnly=$true
 $global:t8NativeResult | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $global:t8NativeEvidence ('native-'+$global:t8NativeMode+'.json')) -Encoding utf8
}
& (Join-Path $package 'Bunny-Island.ps1') -Root $package -CredentialPath (Join-Path $fixture.data 'credentials.json') -DeploymentPath (Join-Path $fixture.parent 't8-deployment.json') -PreferencePath (Join-Path $fixture.parent 't8-native-preferences.json') -SmokeTest -ScreenshotDirectory (Join-Path $bunnyEvidence 'light-dark-screenshots') -TestHook $hook
