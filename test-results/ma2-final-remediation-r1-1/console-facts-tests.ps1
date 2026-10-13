$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'console-ownership.ps1')
$fixture=[ordered]@{freshInspection=$true;parentOwned=$true;parentHeldAlive=$true;childHeldAlive=$true;parentRole='host';parentPid=101;childPid=102;actualParentPid=101;parentBirth='100000';childBirth='100100';freshParentBirth='100000';freshChildBirth='100100';parentImageMatches=$true;childImageMatches=$true;ownerSid='fixture-user';parentOwnerSid='fixture-user';sessionId=2;parentSessionId=2;executable='C:\Windows\System32\conhost.exe';expectedSystemConsole='C:\Windows\System32\conhost.exe';signatureStatus='Valid';signer='CN=Microsoft Windows, O=Microsoft Corporation, L=Redmond, S=Washington, C=US';consoleQuerySucceeded=$true;parentConsoleHostPid=102}
$cases=@(
 @{name='faithful legitimate console';patch=@{};expected=$true},
 @{name='same-name foreign';patch=@{parentOwned=$false};expected=$false},
 @{name='System32 foreign parent';patch=@{actualParentPid=999};expected=$false},
 @{name='signed stale parent';patch=@{freshParentBirth='200000'};expected=$false},
 @{name='child earlier than parent';patch=@{childBirth='99999';freshChildBirth='99999'};expected=$false},
 @{name='parent PID reused';patch=@{parentHeldAlive=$false;freshParentBirth='400000'};expected=$false},
 @{name='child PID reused';patch=@{freshChildBirth='500000'};expected=$false},
 @{name='inspection unavailable';patch=@{freshInspection=$false};expected=$false},
 @{name='foreign session';patch=@{sessionId=3};expected=$false},
 @{name='foreign user';patch=@{ownerSid='other-user'};expected=$false},
 @{name='parent exit race';patch=@{parentHeldAlive=$false};expected=$false},
 @{name='child exit race';patch=@{childHeldAlive=$false};expected=$false},
 @{name='unrelated named executable';patch=@{executable='C:\fixture\System32\conhost.exe'};expected=$false},
 @{name='similar signer';patch=@{signer='Microsoft-like fixture'};expected=$false},
 @{name='kernel console association foreign';patch=@{parentConsoleHostPid=999};expected=$false},
 @{name='kernel query unavailable';patch=@{consoleQuerySucceeded=$false};expected=$false},
 @{name='held image changed';patch=@{childImageMatches=$false};expected=$false},
 @{name='native GUI bootstrap not console role';patch=@{parentRole='application'};expected=$false}
)
$results=@()
foreach($case in $cases){$facts=@{};foreach($key in $fixture.Keys){$facts[$key]=$fixture[$key]};foreach($key in $case.patch.Keys){$facts[$key]=$case.patch[$key]};$actual=Test-R11ConsoleSupportFacts ([pscustomobject]$facts);if($actual -ne $case.expected){throw ('Unexpected result: '+$case.name)};$results+=@{name=$case.name;expected=$case.expected;actual=$actual;passed=$true;classification='SIMULATED faithful facts through actual controller rule';destructionAttempted=$false}}
@{recordedAt=[DateTime]::UtcNow.ToString('o');classification='SIMULATED adversarial controller invariants';tests=$results;passed=$results.Count;failed=0;skipped=0;noTerminationInClassifier=$true} | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'focused-facts.json') -Encoding utf8
Write-Output ('R11 facts '+$results.Count+' passed; 0 failed, 0 skipped.')
