# T5: read-only native presentation of canonical Host records. No scheduler, state or authorization here.
function Get-BunnyTaskPresentation($Task) {
  $projected=@($bunnySnapshot.presentation.tasks | Where-Object id -eq $Task.id) | Select-Object -First 1
  if($projected) {return $projected}
  # Older Host rollback: state labels only; never fall back to untyped provider details.
  return @{label=(Get-BunnyStateInfo $Task.state).Label;activity=(Get-BunnyStateInfo $Task.state).Label;verification='Not independently verified';detail='Activity details unavailable from this Host.'}
}
function Update-BunnyPresentation {
  if($bunnySnapshot.health -and $bunnySnapshot.health.operationalState -ne 'healthy') {
    $bunnyControls.Presence.Text='Host '+$bunnySnapshot.health.operationalState+' - dependent execution unavailable'
    $bunnyControls.Presence.ToolTip='Recovery required. See Host operational status in the application.'
    Set-BunnyRef $bunnyControls.PresenceDot ([Windows.Shapes.Shape]::FillProperty) 'BunnyWarning'
  }
  $mission=@($bunnySnapshot.missions.missions | Where-Object state -in @('waiting_for_approval','waiting_for_user','running','verifying','planning','ready')) | Select-Object -First 1
  if(-not $mission) {
    $now=[DateTimeOffset]::Now.ToUnixTimeMilliseconds()
    $mission=@($bunnySnapshot.missions.missions | Where-Object {$_.state -eq 'completed' -and $_.finishedAt -and $now-$_.finishedAt -ge 0 -and $now-$_.finishedAt -lt 8000}) | Select-Object -First 1
  }
  $bunnyControls.CompactMission.Visibility=if($mission -and $bunnyView -eq 'idle') {'Visible'} else {'Collapsed'}
  if($mission) {
    $bunnyControls.CompactMission.Tag=$mission.id
    $bunnyControls.MissionTitle.Text=$mission.title
    $states=@{completed=[string][char]0x2713;running=[string][char]0x25CF;verifying=[string][char]0x25CF;pending=[string][char]0x25CB;ready=[string][char]0x25CB;waiting_for_approval='!';failed='!';blocked='!';stopped=[string][char]0x25A0;skipped='-'}
    $workers=@($mission.steps | Sort-Object @{Expression={if($_.state -eq 'waiting_for_approval'){0}elseif($_.state -in @('running','verifying')){1}else{2}}},index)
    $line=(@($workers | Select-Object -First 3 | ForEach-Object {$_.role+' '+$states[$_.state]}) -join '  ')
    if($workers.Count -gt 3) {$line+='  +'+($workers.Count-3)}
    $bunnyControls.MissionWorkers.Text=if($mission.state -eq 'completed') {[string][char]0x2713+' Mission completed'} elseif($mission.state -eq 'waiting_for_approval') {'Approval required '+$bunnyDot+' '+$line} elseif($mission.state -eq 'verifying') {'Bunny verifying '+$bunnyDot+' '+$line} else {$line}
    $bunnyControls.CompactMission.ToolTip='Open Mission Control for scope, approval, verification and Stop.'
  }
}
$bunnyControls.CompactMission.Add_Click({Open-BunnyDashboard ('?view=missions&mission='+[Uri]::EscapeDataString([string]$this.Tag))})
