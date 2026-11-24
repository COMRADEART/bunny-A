package com.routeragent.jev;

import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Handler;
import android.os.Looper;
import java.util.Arrays;

/**
 * On-device voice: push-to-talk capture of 16 kHz mono 16-bit PCM. Samples are held in memory only, never written to storage and
 * never handed to network code. Capture stops by itself at Wav.MAX_SECONDS and then calls onLimit on the main thread.
 */
final class VoiceRecorder {
    private final Runnable onLimit;
    private final Handler main = new Handler(Looper.getMainLooper());
    private AudioRecord record;
    private Thread reader;
    private volatile boolean running;
    private byte[] samples;
    private int length;

    VoiceRecorder(Runnable onLimit) { this.onLimit = onLimit; }

    /** False when the microphone cannot be opened (no permission, busy, or no microphone). */
    boolean start() {
        if (record != null) return false;
        int minimum = AudioRecord.getMinBufferSize(Wav.SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        if (minimum <= 0) return false;
        final AudioRecord r;
        try {
            r = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, Wav.SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT, Math.max(minimum, Wav.SAMPLE_RATE * 2));
        } catch (RuntimeException e) {
            return false;
        }
        if (r.getState() != AudioRecord.STATE_INITIALIZED) { r.release(); return false; }
        try {
            r.startRecording();
        } catch (RuntimeException e) {
            r.release();
            return false;
        }
        if (r.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) { r.release(); return false; }
        synchronized (this) { samples = new byte[Wav.MAX_PCM_BYTES]; length = 0; }
        record = r;
        running = true;
        reader = new Thread(() -> read(r), "bunny-voice-recorder");
        reader.start();
        return true;
    }

    private void read(AudioRecord r) {
        byte[] chunk = new byte[3200];  // 100 ms
        while (running) {
            int n = r.read(chunk, 0, chunk.length);
            if (n < 0) break;
            synchronized (this) {
                if (samples == null) break;
                int take = Math.min(n, samples.length - length);
                System.arraycopy(chunk, 0, samples, length, take);
                length += take;
                if (length >= samples.length) {
                    running = false;
                    main.post(onLimit);
                }
            }
        }
        Arrays.fill(chunk, (byte) 0);
    }

    /** Raw PCM captured so far (at most Wav.MAX_PCM_BYTES); the recorder is released. */
    byte[] stop() {
        halt();
        synchronized (this) {
            byte[] out = samples == null ? new byte[0] : Arrays.copyOf(samples, length);
            clear();
            return out;
        }
    }

    /** Drops the recording; the microphone is released. */
    void discard() {
        halt();
        synchronized (this) { clear(); }
    }

    synchronized int seconds() { return length / (Wav.SAMPLE_RATE * 2); }

    private void halt() {
        running = false;
        AudioRecord r = record;
        record = null;
        if (r == null) return;
        try { r.stop(); } catch (RuntimeException ignored) { /* never started */ }
        Thread t = reader;
        reader = null;
        if (t != null) {
            try { t.join(500); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        }
        r.release();
    }

    private void clear() {
        if (samples != null) Arrays.fill(samples, (byte) 0);
        samples = null;
        length = 0;
    }
}
