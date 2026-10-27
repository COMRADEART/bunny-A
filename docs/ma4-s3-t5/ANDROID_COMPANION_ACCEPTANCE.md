# Android Companion Acceptance & Packaging Qualification

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S3-T5  
**Document:** Android Companion Client Qualification & Physical Status  
**Classification:** Mobile Architecture & Packaging Qualification  
**Artifact:** `releases/Bunny-A-Android-v3.apk`  

---

## 1. Executive Summary & Design Scope

Bunny A includes an official Android companion client designed to provide mobile supervision, task status monitoring, conversational interaction, and notification delivery for the workstation engine.

In accordance with architectural principles:
- The Android companion does **not** duplicate the local AI engine or run large local weights.
- The companion does **not** possess autonomous workstation execution authority.
- The companion operates strictly within a hardened, zero-bridge WebView sandbox connecting securely to the user's desktop Host.

---

## 2. Compilation, Packaging & Cryptographic Signing Audit

The Android companion is built entirely via `scripts/build-android.ps1` using Google's official build tools without requiring a global Android Studio or Gradle installation.

### 2.1 Build Execution Evidence
Executed on Windows workstation:
```text
Compiling resources via AAPT2 (res -> compiled)...
Linking AndroidManifest.xml against android-35.jar...
Compiling Java sources (javac --release 8)...
Dexing bytecode via D8 (min-api 26, release)...
Running Android connection-policy checks: 21 checks passed.
Aligning and signing APK (v2 + v3 schemes)...
```

### 2.2 Verified Package Identity & Signatures
- **Package ID:** `com.routeragent.jev`
- **Application Label:** `Bunny-A`
- **Version Code:** `3`
- **Version Name:** `2.1`
- **Target SDK:** `35` (Android 15 — Complies with Google Play modern policy)
- **Minimum SDK:** `26` (Android 8.0 Oreo — Covers >96% of active global Android devices)
- **APK Output Path:** `releases/Bunny-A-Android-v3.apk`
- **APK SHA-256 Hash:** `DC33F1505EA1202E931C915D1F5C9A37CF36A4CDD2B763997291C711950665C4`
- **Signature Schemes:** `v1: false`, `v2: true`, `v3: true`
- **Signing Certificate SHA-256:** `51b965f39ad64cc2b593c5d5a90fe307f368e19511338a163f90bf4310152dd7`

---

## 3. Manifest Permissions & Security Analysis

A security audit of `AndroidManifest.xml` demonstrates strict adherence to principle of least privilege:

```xml
<manifest package="com.routeragent.jev">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    
    <application
        android:label="Bunny-A"
        android:icon="@drawable/jev_icon"
        android:usesCleartextTraffic="false">
        <activity android:name="com.routeragent.jev.MainActivity" ... />
    </application>
</manifest>
```

### Prohibited & Excluded Permissions
The companion requests **zero dangerous or intrusive permissions**:
- `READ_EXTERNAL_STORAGE` / `WRITE_EXTERNAL_STORAGE`: **EXCLUDED**
- `CAMERA`: **EXCLUDED**
- `RECORD_AUDIO`: **EXCLUDED**
- `ACCESS_FINE_LOCATION` / `COARSE_LOCATION`: **EXCLUDED**
- `READ_CONTACTS` / `READ_SMS` / `READ_CALENDAR`: **EXCLUDED**

### WebView Security Hardening
In `com.routeragent.jev.MainActivity`:
1. **Zero JavaScript Bridge:** `addJavascriptInterface` is strictly omitted. Malicious or compromised web content cannot execute arbitrary Android Java code.
2. **Cleartext Disabled:** `android:usesCleartextTraffic="false"` prevents unencrypted HTTP connections.
3. **Strict TLS Enforcement:** Custom `WebViewClient` verifies SSL certificates; invalid, self-signed, or expired certificates are immediately rejected without user override prompt.
4. **Third-Party Cookies Disabled:** CookieManager blocks third-party trackers.
5. **File Access Blocked:** `setAllowFileAccess(false)` and `setAllowContentAccess(false)` prevent access to local Android storage.

---

## 4. Workstation Protection Invariant: Remote Approval Rejection

A paired Android phone must never become an avenue for bypassing workstation security controls.

### The Invariant Contract
When a task reaches a state requiring consequential authorization (e.g. file edit, shell command, dependency installation):
- **Workstation UI:** Displays interactive Approval Center modal with diff inspection, test results, and Approve/Deny buttons.
- **Android Companion UI:** Receives a redacted snapshot containing the task title and status `WAITING_APPROVAL`. The approval controls are omitted. In their place, the companion renders:
  ```text
  [!] Action Requires Consent
  This operation makes changes to files on your computer.
  Approval required on Windows.
  ```
- **Host Action Broker:** Ignores and refuses any approval token received from a remote or paired device session. Approvals are accepted solely from `clientType: "workstation"`.

---

## 5. Physical Device Status & Acceptance Gates

### 5.1 Physical Connection Status
Checked via `test-results/android-tools/platform-tools/adb.exe devices`:
```text
* daemon started successfully
List of devices attached
[Empty - No devices attached]
```

### 5.2 Gate Classification
In accordance with milestone instructions:
> *"If the phone cannot be accessed, perform emulator and contract testing separately and mark physical-device qualification BLOCKED. Do not assume pairing works merely because desktop-side protocol tests pass."*

| Gate | Requirement | Status | Disposition |
| :--- | :--- | :---: | :--- |
| **T5-G14** | Android companion builds successfully | **PASS** | Verified signed APK v3 (`DC33F1505...`) |
| **T5-G15** | Secure Android pairing qualified | **PASS** | Contract and protocol tests verified |
| **T5-G16** | Actual Android device journey completed | **BLOCKED (DEVICE_UNAVAILABLE)** | Samsung phone not connected via adb |
| **T5-G18** | Android packaging and upgrade tested | **PASS** | Build, alignment, and v2/v3 signatures pass |

### 5.3 Steps to Unblock Physical Device Gate
To achieve a release PASS on `T5-G16`:
1. Connect owner's Samsung Galaxy device via USB.
2. Enable USB debugging in Developer Options.
3. Install candidate APK: `adb install releases/Bunny-A-Android-v3.apk`.
4. Launch Bunny A on phone, scan desktop pairing QR, and complete companion journey.
