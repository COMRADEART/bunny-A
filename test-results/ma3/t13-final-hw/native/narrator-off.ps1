# Toggles Narrator off via Win+Ctrl+Enter (taskkill cannot stop it).
Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);' -Name T13KB -Namespace T13Narr
$VK_LWIN = 0x5B
$VK_CONTROL = 0x11
$VK_RETURN = 0x0D
$KEYDOWN = 0
$KEYUP = 2
$Z = [UIntPtr]::Zero
[T13Narr.T13KB]::keybd_event($VK_LWIN, 0, $KEYDOWN, $Z)
[T13Narr.T13KB]::keybd_event($VK_CONTROL, 0, $KEYDOWN, $Z)
[T13Narr.T13KB]::keybd_event($VK_RETURN, 0, $KEYDOWN, $Z)
[T13Narr.T13KB]::keybd_event($VK_RETURN, 0, $KEYUP, $Z)
[T13Narr.T13KB]::keybd_event($VK_CONTROL, 0, $KEYUP, $Z)
[T13Narr.T13KB]::keybd_event($VK_LWIN, 0, $KEYUP, $Z)
Write-Output "chord sent"
