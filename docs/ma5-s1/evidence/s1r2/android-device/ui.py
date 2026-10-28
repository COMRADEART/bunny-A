"""adb UI helper for the S1R2 device run (scratch only).
ui.py dump [out.xml]       -> prints app node texts/descs (and saves the filtered XML)
ui.py tap <substring>      -> taps the first app node whose text or content-desc contains it
ui.py type <text>          -> types text into the focused field
ui.py wait <substring> [s] -> waits until a node contains it
"""
import re, subprocess, sys, time, xml.etree.ElementTree as ET
ADB = r"C:\Users\allam\Documents\new\bun-router\test-results\android-tools\platform-tools\adb.exe"
SERIAL = "R3GL1025V4J"
PKG = "com.routeragent.jev"

def adb(*args, check=True):
    return subprocess.run([ADB, "-s", SERIAL, *args], capture_output=True, text=True, encoding="utf-8", errors="replace", check=check).stdout

def nodes():
    for _ in range(3):
        adb("shell", "uiautomator", "dump", "/sdcard/s1r2.xml", check=False)
        raw = adb("exec-out", "cat", "/sdcard/s1r2.xml", check=False)
        if raw.strip().startswith("<?xml"):
            root = ET.fromstring(raw[raw.index("<?xml"):])
            adb("shell", "rm", "-f", "/sdcard/s1r2.xml", check=False)
            return [n for n in root.iter("node") if n.get("package") == PKG], root
        time.sleep(1)
    raise SystemExit("ui dump failed")

def label(n):
    return (n.get("text") or "") + (" [" + n.get("content-desc") + "]" if n.get("content-desc") else "") + (" (disabled)" if n.get("enabled") == "false" else "")

def find(sub):
    found, _ = nodes()
    if sub.startswith("="):  # exact text match
        return next((n for n in found if (n.get("text") or "") == sub[1:]), None)
    for n in found:
        if sub in (n.get("text") or "") or sub in (n.get("content-desc") or ""):
            return n
    return None

cmd = sys.argv[1]
if cmd == "dump":
    found, root = nodes()
    for n in found:
        if label(n).strip():
            print(label(n))
    if len(sys.argv) > 2:
        for parent in list(root.iter()):
            for child in list(parent):
                if child.tag == "node" and child.get("package") not in (PKG, None):
                    parent.remove(child)
        ET.ElementTree(root).write(sys.argv[2], encoding="utf-8")
elif cmd == "tap":
    n = find(sys.argv[2])
    if n is None:
        raise SystemExit("not found: " + sys.argv[2])
    x1, y1, x2, y2 = map(int, re.findall(r"\d+", n.get("bounds")))
    adb("shell", "input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2))
    print("tapped", label(n))
elif cmd == "type":
    adb("shell", "input", "text", sys.argv[2].replace(" ", "%s"))
elif cmd == "wait":
    deadline = time.time() + float(sys.argv[3] if len(sys.argv) > 3 else 30)
    while time.time() < deadline:
        if find(sys.argv[2]) is not None:
            print("found", sys.argv[2]); break
        time.sleep(1.5)
    else:
        raise SystemExit("timeout waiting for " + sys.argv[2])
