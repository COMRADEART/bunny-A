param([string]$Repository, [string]$Out)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase
$tokens=$null;$parseErrors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $Repository 'install/Bunny-Island.Weapons.ps1'),[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw 'Product source does not parse.'}
$factory=$ast.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'New-BunnyCharacterButton'},$true)
if($factory.Count -ne 1){throw 'Cannot uniquely locate the real Button factory.'}
. ([scriptblock]::Create($factory[0].Extent.Text))
$rows=foreach($weapon in @('Gada','Spear','Vishnu Chakra','Sword')) {
  $button=New-BunnyCharacterButton 12
  [Windows.Automation.AutomationProperties]::SetName($button,($weapon+', Ready to start. Open Personal Agent details.'))
  $peer=[Windows.Automation.Peers.UIElementAutomationPeer]::CreatePeerForElement($button)
  $row=[ordered]@{weapon=$weapon;type=$button.GetType().FullName;controlType=[string]$peer.GetAutomationControlType();name=$peer.GetName();focusable=$button.Focusable;tabStop=$button.IsTabStop;invokePattern=($null -ne $peer.GetPattern([Windows.Automation.Peers.PatternInterface]::Invoke))}
  if($row.controlType -ne 'Button' -or -not $row.focusable -or -not $row.tabStop -or -not $row.invokePattern -or -not $row.name.StartsWith($weapon)){throw 'Character control lacks its expected automation peer.'}
  [pscustomobject]$row
}
$result=[ordered]@{classification='SOFTWARE UNIT: real product Button factory and WPF automation peers, no visible window or keyboard input';result='PASS';rows=@($rows);notTested='Actual Tab/Enter/Space in the final floating Notch; standard WPF input behavior was not replayed through a visible desktop target.'}
[IO.File]::WriteAllText($Out,($result|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
