$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$adb = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../android-tools/platform-tools/adb.exe'))
$form = New-Object Windows.Forms.Form
$form.Text = 'Bunny-A: authorize Android wireless debugging'
$form.Size = New-Object Drawing.Size(570,390)
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true
$intro = New-Object Windows.Forms.Label
$intro.Text = 'Use your intended test phone on the same trusted network. Open Wireless debugging, then Pair device with pairing code. Secrets stay in memory only.'
$intro.Location = New-Object Drawing.Point(20,15)
$intro.Size = New-Object Drawing.Size(520,55)
$form.Controls.Add($intro)
$inputs = @{}
$row = 0
foreach ($field in @('Phone IP address','Pairing port','Pairing code','Connection port')) {
  $label = New-Object Windows.Forms.Label
  $label.Text = $field
  $label.Location = New-Object Drawing.Point(20,(85 + $row * 43))
  $label.Size = New-Object Drawing.Size(180,25)
  $box = New-Object Windows.Forms.TextBox
  $box.Location = New-Object Drawing.Point(205,(82 + $row * 43))
  $box.Size = New-Object Drawing.Size(310,25)
  if ($field -eq 'Pairing code') { $box.UseSystemPasswordChar = $true }
  $inputs[$field] = $box
  $form.Controls.Add($label)
  $form.Controls.Add($box)
  $row++
}
$note = New-Object Windows.Forms.Label
$note.Text = 'Connection port is shown on the MAIN Wireless debugging screen; it differs from the pairing port. Do not send the pairing code in chat.'
$note.Location = New-Object Drawing.Point(20,260)
$note.Size = New-Object Drawing.Size(520,40)
$form.Controls.Add($note)
$button = New-Object Windows.Forms.Button
$button.Text = 'Pair and connect'
$button.Location = New-Object Drawing.Point(205,308)
$button.Size = New-Object Drawing.Size(160,30)
$form.Controls.Add($button)
$form.AcceptButton = $button
$result = [ordered]@{ recordedAt = [DateTime]::UtcNow.ToString('o'); status = 'cancelled'; codeRetained = $false; addressRetained = $false; adbPairExit = $null; adbConnectExit = $null }
function Invoke-AdbPrivate([string[]]$AdbArguments, [string]$Secret) {
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = $adb
  $psi.Arguments = $AdbArguments -join ' '
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $psi
  [void]$process.Start()
  if ($Secret) { $process.StandardInput.WriteLine($Secret) }
  $process.StandardInput.Close()
  $stdout = $process.StandardOutput.ReadToEndAsync()
  $stderr = $process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit(20000)) { $process.Kill(); throw 'ADB operation timed out. Check the phone and try a fresh pairing code.' }
  $output = $stdout.Result + $stderr.Result
  return @{ exit = $process.ExitCode; paired = $output -match 'Successfully paired'; connected = $output -match '(?:already )?connected to' }
}
$button.Add_Click({
  try {
    $ip = $null
    if (-not [Net.IPAddress]::TryParse($inputs['Phone IP address'].Text.Trim(), [ref]$ip) -or $ip.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { throw 'Enter a valid IPv4 address shown by the intended phone.' }
    $bytes = $ip.GetAddressBytes()
    if (-not ($bytes[0] -eq 10 -or ($bytes[0] -eq 192 -and $bytes[1] -eq 168) -or ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31))) { throw 'Use the phone address on your private local network.' }
    $pairPort = 0; $connectPort = 0
    if (-not [int]::TryParse($inputs['Pairing port'].Text, [ref]$pairPort) -or $pairPort -lt 1 -or $pairPort -gt 65535) { throw 'Enter the pairing port shown by Android.' }
    if (-not [int]::TryParse($inputs['Connection port'].Text, [ref]$connectPort) -or $connectPort -lt 1 -or $connectPort -gt 65535) { throw 'Enter the connection port shown on the main Wireless debugging screen.' }
    if ($inputs['Pairing code'].Text -notmatch '^\d{6}$') { throw 'Enter the current six-digit Android wireless pairing code.' }
    $button.Enabled = $false
    $paired = Invoke-AdbPrivate @('pair', ($ip.ToString() + ':' + $pairPort)) $inputs['Pairing code'].Text
    $inputs['Pairing code'].Clear()
    $result.adbPairExit = $paired.exit
    if ($paired.exit -ne 0 -or -not $paired.paired) { throw 'Android wireless pairing did not succeed. Open a fresh pairing code on the phone and try again.' }
    $connected = Invoke-AdbPrivate @('connect', ($ip.ToString() + ':' + $connectPort)) ''
    $result.adbConnectExit = $connected.exit
    $result.status = if ($connected.exit -eq 0 -and $connected.connected) { 'paired-and-connected' } else { 'paired-connection-pending' }
    [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'wireless-pairing.json'), ($result | ConvertTo-Json) + "`n")
    [void][Windows.Forms.MessageBox]::Show('Android debugging authorization: ' + $result.status + '. Return to Codex. No pairing code or phone address was saved.', 'Bunny-A')
    $form.Close()
  } catch {
    $inputs['Pairing code'].Clear()
    [void][Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Bunny-A: pairing needs attention')
    $button.Enabled = $true
  }
})
[void]$form.ShowDialog()
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'wireless-pairing.json'), ($result | ConvertTo-Json) + "`n")
$form.Dispose()
