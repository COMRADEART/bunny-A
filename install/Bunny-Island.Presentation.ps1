# T5: read-only native presentation of canonical Host records. No scheduler, state or authorization here.
function Get-BunnyTaskPresentation($Task) {
  $projected=@($bunnySnapshot.presentation.tasks | Where-Object id -eq $Task.id) | Select-Object -First 1
  if($projected) {return $projected}
  # Older Host rollback: state labels only; never fall back to untyped provider details.
  return @{label=(Get-BunnyStateInfo $Task.state).Label;activity=(Get-BunnyStateInfo $Task.state).Label;verification='Not independently verified';detail='Activity details unavailable from this Host.'}
}
function Update-BunnyPresentation {
  Update-BunnyAgentPresentation
  $bunnyControls.CompactHealth.Visibility='Collapsed'
  if($bunnySnapshot.health -and $bunnySnapshot.health.operationalState -ne 'healthy') {
    $bunnyControls.CompactHealth.Visibility='Visible'
    $bunnyControls.CompactHealth.Text=if($bunnySnapshot.health.operationalState -eq 'degraded') {'Host degraded - '+$(if($bunnySnapshot.health.unavailableSubsystems -contains 'browser') {'Browser unavailable'}else{'Recovery required'})}else {'Host shutting down - recovery required'}
    $bunnyControls.Presence.Text='Host '+$bunnySnapshot.health.operationalState+' - dependent execution unavailable'
    $bunnyControls.Presence.ToolTip='Recovery required. See Host operational status in the application.'
    Set-BunnyRef $bunnyControls.PresenceDot ([Windows.Shapes.Shape]::FillProperty) 'BunnyWarning'
  }
  $mission=@($bunnySnapshot.missions.missions | Where-Object state -in @('waiting_for_approval','waiting_for_user','running','verifying','planning','ready')) | Select-Object -First 1
  if(-not $mission) {
    $now=[DateTimeOffset]::Now.ToUnixTimeMilliseconds()
    $mission=@($bunnySnapshot.missions.missions | Where-Object {$_.state -eq 'completed' -and $_.finishedAt -and $now-$_.finishedAt -ge 0 -and $now-$_.finishedAt -lt 8000}) | Select-Object -First 1
  }
  $bunnyControls.CompactMission.Visibility=if($mission -and $bunnyView -eq 'idle' -and -not $bunnyCurrentAgentId) {'Visible'} else {'Collapsed'}
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

# T8: native controls project the same durable Agent authority as the desktop workspace.
$bunnyCurrentAgentId=$null
$bunnyStopConfirmation=$null
function Update-BunnyAgentPresentation {
  $agent=@($bunnySnapshot.agents.agents | Sort-Object @{Expression={if($_.authorization.state -eq 'WAITING_FOR_USER' -or $_.state -in @('WAITING_FOR_USER','INTERRUPTED')){0}elseif($_.state -notin @('COMPLETED','FAILED','STOPPED')){1}else{2}}},@{Expression='updatedAt';Descending=$true}) | Select-Object -First 1
  if($bunnyCurrentAgentId -ne $agent.id) {$script:bunnyStopConfirmation=$null}
  $script:bunnyCurrentAgentId=if($agent){$agent.id}else{$null}
  $bunnyControls.CompactAgent.Visibility=if($agent -and $bunnyView -eq 'idle'){'Visible'}else{'Collapsed'}
  if(-not $agent) {return}
  $bunnyControls.AgentName.Text=$agent.name
  $label=([string]$agent.state).Replace('_',' ').ToLower()
  $bunnyControls.AgentState.Text=if(-not $bunnyOnline){'Host disconnected - last known: '+$label}else{$label+' - authorization: '+$(if($agent.authorization){([string]$agent.authorization.state).Replace('_',' ').ToLower()}else{'not granted'})}
  $bunnyControls.AgentBoundary.Text=if($bunnyStopConfirmation -eq $agent.id){'Stop future admissions? Already admitted effects are not undone. Press Stop now to confirm.'}elseif($agent.activity.verification -eq 'Verified'){'Project result independently verified.'}elseif($agent.authorization.state -eq 'WAITING_FOR_USER'){'Agent waiting for authorization.'}else{'Closing this Bar keeps Host-owned work running.'}
  $bunnyControls.AgentPause.IsEnabled=$bunnyOnline -and -not $bunnyPending -and (-not $agent.authorization -or $agent.authorization.state -eq 'ACTIVE') -and $agent.state -in @('CREATED','PLANNING','RUNNING','WAITING_FOR_USER','WAITING_FOR_DEPENDENCY','VERIFYING')
  $bunnyControls.AgentResume.IsEnabled=$bunnyOnline -and -not $bunnyPending -and $agent.state -eq 'PAUSED'
  $bunnyControls.AgentStop.IsEnabled=$bunnyOnline -and -not $bunnyPending -and $agent.state -notin @('COMPLETED','FAILED','STOPPED')
  $bunnyControls.AgentStop.Content=if($bunnyStopConfirmation -eq $agent.id){'Stop now'}else{'Stop'}
  $bunnyControls.AgentReview.Visibility=if($agent.authorization -and ($agent.authorization.state -eq 'WAITING_FOR_USER' -or @($agent.authorization.pending | Where-Object {$_}).Count -gt 0)){'Visible'}else{'Collapsed'}
  $bunnyControls.AgentReview.IsEnabled=$bunnyOnline
}
$bunnyControls.AgentOpen.Add_Click({Open-BunnyDashboard ('?view=agentic&agent='+[Uri]::EscapeDataString([string]$bunnyCurrentAgentId))})
$bunnyControls.AgentReview.Add_Click({Open-BunnyDashboard ('?view=agentic&agent='+[Uri]::EscapeDataString([string]$bunnyCurrentAgentId))})
$bunnyControls.AgentPause.Add_Click({Begin-BunnyCommand 'agent.pause' @{id=$bunnyCurrentAgentId};Update-BunnyAgentPresentation})
$bunnyControls.AgentResume.Add_Click({Begin-BunnyCommand 'agent.resume' @{id=$bunnyCurrentAgentId};Update-BunnyAgentPresentation})
$bunnyControls.AgentStop.Add_Click({if($bunnyStopConfirmation -eq $bunnyCurrentAgentId){Begin-BunnyCommand 'agent.stop' @{id=$bunnyCurrentAgentId};$script:bunnyStopConfirmation=$null}else{$script:bunnyStopConfirmation=$bunnyCurrentAgentId};Update-BunnyAgentPresentation})
