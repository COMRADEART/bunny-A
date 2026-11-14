package com.routeragent.jev;

/** Which phones may run on-device voice, and the reason shown when not; exercised without Android. */
public final class VoiceGateTest {
    private static int checks;
    private static void check(boolean ok, String what) { if (!ok) throw new AssertionError(what); checks++; }

    public static void main(String[] args) {
        String[] arm = {"arm64-v8a", "armeabi-v7a"};
        check(VoiceGate.blockedReason(36, 26, arm, 11_500_000_000L) == null, "capable phone");
        check("Voice needs a 64-bit ARM phone.".equals(VoiceGate.blockedReason(36, 26, new String[]{"x86_64"}, 11_500_000_000L)), "abi");
        check("Voice needs a phone with at least 8 GB of memory.".equals(VoiceGate.blockedReason(36, 26, arm, 5_600_000_000L)), "memory");
        check("Voice needs a newer version of Android.".equals(VoiceGate.blockedReason(26, 31, arm, 11_500_000_000L)), "library sdk floor");
        check(VoiceGate.blockedReason(36, 26, arm, 7_000_000_000L) == null, "boundary is allowed");
        check("Voice needs a 64-bit ARM phone.".equals(VoiceGate.blockedReason(26, 31, new String[]{"armeabi-v7a"}, 1L)), "ABI is checked first");
        check("Voice needs a newer version of Android.".equals(VoiceGate.blockedReason(26, 31, arm, 1L)), "SDK is checked before memory");
        check("Voice needs a 64-bit ARM phone.".equals(VoiceGate.blockedReason(36, 26, new String[0], 11_500_000_000L)) && "Voice needs a 64-bit ARM phone.".equals(VoiceGate.blockedReason(36, 26, null, 11_500_000_000L)), "no ABI list");
        System.out.println("VoiceGateTest: " + checks + " checks passed");
    }
}
