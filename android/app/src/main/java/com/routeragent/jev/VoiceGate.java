package com.routeragent.jev;

/** On-device voice: whether this phone can run the voice model, and if not, the plain reason shown on the card. */
final class VoiceGate {
    /** Phones sold with 8 GB report a little over 7 GB of total memory. */
    static final long MIN_TOTAL_MEM = 7_000_000_000L;

    private VoiceGate() {}

    /** Null when voice may run. ABI is checked first, then the Android version, then memory. */
    static String blockedReason(int sdkInt, int librarySdk, String[] abis, long totalMemBytes) {
        boolean arm64 = false;
        if (abis != null) for (String abi : abis) arm64 |= "arm64-v8a".equals(abi);
        if (!arm64) return "Voice needs a 64-bit ARM phone.";
        if (sdkInt < librarySdk) return "Voice needs a newer version of Android.";
        if (totalMemBytes < MIN_TOTAL_MEM) return "Voice needs a phone with at least 8 GB of memory.";
        return null;
    }
}
