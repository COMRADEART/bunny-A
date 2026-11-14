package com.routeragent.jev;

/** On-device voice: recording limits and PCM to WAV framing (the format LiteRT-LM's Content.AudioBytes was proven with). */
final class Wav {
    static final int SAMPLE_RATE = 16_000;
    static final int MAX_SECONDS = 30;
    static final int MAX_PCM_BYTES = 960_000;   // 30 s of 16 kHz mono 16-bit
    static final int MIN_PCM_BYTES = 16_000;    // 0.5 s

    private Wav() {}

    /** A 44-byte RIFF/WAVE header (PCM, mono, 16-bit, 16 kHz) followed by the samples. */
    static byte[] wrap(byte[] pcm16le) {
        int n = pcm16le.length;
        byte[] out = new byte[44 + n];
        ascii(out, 0, "RIFF"); le32(out, 4, 36 + n); ascii(out, 8, "WAVE");
        ascii(out, 12, "fmt "); le32(out, 16, 16); le16(out, 20, 1); le16(out, 22, 1);
        le32(out, 24, SAMPLE_RATE); le32(out, 28, SAMPLE_RATE * 2); le16(out, 32, 2); le16(out, 34, 16);
        ascii(out, 36, "data"); le32(out, 40, n);
        System.arraycopy(pcm16le, 0, out, 44, n);
        return out;
    }

    static boolean tooShort(int pcmBytes) { return pcmBytes < MIN_PCM_BYTES; }

    private static void ascii(byte[] b, int at, String s) { for (int i = 0; i < 4; i++) b[at + i] = (byte) s.charAt(i); }
    private static void le16(byte[] b, int at, int v) { b[at] = (byte) v; b[at + 1] = (byte) (v >> 8); }
    private static void le32(byte[] b, int at, int v) { le16(b, at, v); le16(b, at + 2, v >> 16); }
}
