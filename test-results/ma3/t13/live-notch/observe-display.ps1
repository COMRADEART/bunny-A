# Read-only display observation for the T13 LIVE evidence: monitor list (bounds and work areas) and the system DPI.
# Changes no setting. Prints one JSON object on stdout.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern int GetDpiForSystem();' -Name Observe -Namespace T13Display
$screens = @([System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
  [ordered]@{
    device = $_.DeviceName; primary = [bool]$_.Primary
    bounds = [ordered]@{ x = $_.Bounds.X; y = $_.Bounds.Y; w = $_.Bounds.Width; h = $_.Bounds.Height }
    workArea = [ordered]@{ x = $_.WorkingArea.X; y = $_.WorkingArea.Y; w = $_.WorkingArea.Width; h = $_.WorkingArea.Height }
  }
})
[ordered]@{ monitorCount = $screens.Count; monitors = $screens; systemDpi = [int][T13Display.Observe]::GetDpiForSystem() } | ConvertTo-Json -Depth 6 -Compress
