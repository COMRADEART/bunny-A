#!/bin/bash
# Lifecycle checks on the phone while one chat message is "Outcome unknown" (MA5-S1R2, reusable).
# Env: EVIDENCE_DIR (output folder), COMMANDS_LOG (fault-harness commands.log), BUNNY_ADB (default adb), ANDROID_SERIAL.
set -eu
export PYTHONIOENCODING=utf-8
: "${EVIDENCE_DIR:?set EVIDENCE_DIR}" "${COMMANDS_LOG:?set COMMANDS_LOG}"
UI="python $(dirname "$0")/ui.py"
ADB="${BUNNY_ADB:-adb}"
P=${1:-F}
E="$EVIDENCE_DIR"
mkdir -p "$E"
chk(){ $UI dump "$E/$P-$1.xml" > "$E/$P-$1.txt"; echo "$P-$1: tab=$(grep -o '\[[A-Za-z]* tab, selected\]' "$E/$P-$1.txt") unknownLabel=$(grep -c '^Outcome unknown$' "$E/$P-$1.txt") sendBlocked=$(grep -c 'Resolve above first (disabled)' "$E/$P-$1.txt") sendingText=$(grep -c 'Sending to the workstation' "$E/$P-$1.txt")"; }
submits(){ grep '"device":true' "$COMMANDS_LOG" | grep -c '"action":"submit"'; }
SUB0=$(submits)
$ADB shell am start -n com.routeragent.jev/.MainActivity >/dev/null; $UI wait "Supervised Work" 40 >/dev/null; $UI tap "Chat tab" >/dev/null; sleep 4; chk L1-process-restart
$UI tap "Tasks tab" >/dev/null; sleep 2; chk L2a-tasks-tab
$UI tap "System tab" >/dev/null; sleep 2; $UI tap "Chat tab" >/dev/null; sleep 2; chk L2-tabs-back-to-chat
$ADB shell input keyevent KEYCODE_HOME; sleep 8; $ADB shell am start -n com.routeragent.jev/.MainActivity >/dev/null 2>&1; sleep 4; chk L3-background-foreground
# Records the rotation settings first so they can be restored (S1R2 left auto-rotate off without recording it).
ROT0=$($ADB shell settings get system accelerometer_rotation | tr -d '\r')
$ADB shell settings put system accelerometer_rotation 0; $ADB shell settings put system user_rotation 1; sleep 5; chk L4-landscape; $ADB exec-out screencap -p > "$E/$P-L4-landscape.png"
$ADB shell settings put system user_rotation 0; $ADB shell settings put system accelerometer_rotation "$ROT0"; sleep 4; chk L4b-portrait-again
$ADB shell am force-stop com.routeragent.jev; sleep 2; $ADB shell am start -n com.routeragent.jev/.MainActivity >/dev/null; $UI wait "Supervised Work" 40 >/dev/null; $UI tap "Chat tab" >/dev/null; sleep 4; chk L5-force-stop-relaunch
echo "submits before=$SUB0 after=$(submits)"
