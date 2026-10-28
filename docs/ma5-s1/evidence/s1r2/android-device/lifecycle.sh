#!/bin/bash
# S1R2 lifecycle checks on the phone while one chat message is "Outcome unknown". Scratch only.
export PYTHONIOENCODING=utf-8
S="C:/Users/allam/AppData/Local/Temp/claude/C--Users-allam-Documents-new-bun-router/d993f863-98ab-4039-b808-bed29f2fb790/scratchpad"
UI="python $S/harness/ui.py"
ADB="/c/Users/allam/Documents/new/bun-router/test-results/android-tools/platform-tools/adb.exe -s R3GL1025V4J"
P=${1:-F}
chk(){ $UI dump $S/ev/$P-$1.xml > $S/ev/$P-$1.txt; echo "$P-$1: tab=$(grep -o '\[[A-Za-z]* tab, selected\]' $S/ev/$P-$1.txt) unknownLabel=$(grep -c '^Outcome unknown$' $S/ev/$P-$1.txt) sendBlocked=$(grep -c 'Resolve above first (disabled)' $S/ev/$P-$1.txt) sendingText=$(grep -c 'Sending to the workstation' $S/ev/$P-$1.txt)"; }
submits(){ grep '"device":true' $S/r2state/commands.log | grep -c '"action":"submit"'; }
SUB0=$(submits)
$ADB shell am start -n com.routeragent.jev/.MainActivity >/dev/null; $UI wait "Supervised Work" 40 >/dev/null; $UI tap "Chat tab" >/dev/null; sleep 4; chk L1-process-restart
$UI tap "Tasks tab" >/dev/null; sleep 2; chk L2a-tasks-tab
$UI tap "System tab" >/dev/null; sleep 2; $UI tap "Chat tab" >/dev/null; sleep 2; chk L2-tabs-back-to-chat
$ADB shell input keyevent KEYCODE_HOME; sleep 8; $ADB shell am start -n com.routeragent.jev/.MainActivity >/dev/null 2>&1; sleep 4; chk L3-background-foreground
$ADB shell settings put system accelerometer_rotation 0; $ADB shell settings put system user_rotation 1; sleep 5; chk L4-landscape; $ADB exec-out screencap -p > $S/ev/$P-L4-landscape.png
$ADB shell settings put system user_rotation 0; sleep 4; chk L4b-portrait-again
$ADB shell am force-stop com.routeragent.jev; sleep 2; $ADB shell am start -n com.routeragent.jev/.MainActivity >/dev/null; $UI wait "Supervised Work" 40 >/dev/null; $UI tap "Chat tab" >/dev/null; sleep 4; chk L5-force-stop-relaunch
echo "submits before=$SUB0 after=$(submits)"
