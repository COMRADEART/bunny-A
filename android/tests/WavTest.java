package com.routeragent.jev;

/** PCM to WAV framing and recording limits for on-device voice, exercised without Android. */
public final class WavTest {
    private static int checks;
    private static void check(boolean ok, String what) { if (!ok) throw new AssertionError(what); checks++; }
    private static int le16(byte[] b, int at) { return (b[at] & 255) | (b[at + 1] & 255) << 8; }
    private static int le32(byte[] b, int at) { return le16(b, at) | le16(b, at + 2) << 16; }

    public static void main(String[] args) throws Exception {
        byte[] wav = Wav.wrap(new byte[32_000]);
        check(wav.length == 32_044, "44-byte header");
        check(new String(wav, 0, 4, "US-ASCII").equals("RIFF") && new String(wav, 8, 4, "US-ASCII").equals("WAVE"), "RIFF/WAVE");
        check(new String(wav, 12, 4, "US-ASCII").equals("fmt ") && new String(wav, 36, 4, "US-ASCII").equals("data"), "fmt and data chunks");
        check(le32(wav, 4) == 32_036, "RIFF size = data + 36");
        check(le32(wav, 16) == 16, "fmt chunk is 16 bytes");
        check(le16(wav, 20) == 1 && le16(wav, 22) == 1, "PCM, mono");
        check(le32(wav, 24) == 16_000 && le32(wav, 28) == 32_000 && le16(wav, 34) == 16, "16 kHz, 16-bit");
        check(le16(wav, 32) == 2, "block align");
        check(le32(wav, 40) == 32_000, "data size");
        byte[] pcm = {1, 2, 3, 4};
        byte[] small = Wav.wrap(pcm);
        check(small[44] == 1 && small[47] == 4, "samples follow the header unchanged");
        check(Wav.tooShort(15_999) && !Wav.tooShort(16_000), "tooShort: under half a second");
        check(Wav.MAX_PCM_BYTES == 960_000 && Wav.MAX_SECONDS == 30 && Wav.SAMPLE_RATE == 16_000 && Wav.MIN_PCM_BYTES == 16_000, "30 s cap");
        System.out.println("WavTest: " + checks + " checks passed");
    }
}
