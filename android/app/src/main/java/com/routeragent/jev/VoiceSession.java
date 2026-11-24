package com.routeragent.jev;

/**
 * On-device voice: one push-to-talk exchange at a time. Calls that arrive in the wrong state (a late model answer after Cancel,
 * a second start while recording) are ignored, so a cancelled request can never change what the card shows.
 */
final class VoiceSession {
    enum State { IDLE, RECORDING, THINKING, SPEAKING }
    enum Mode { TALK, DICTATE }

    static final String NOTHING_HEARD = "I didn't catch anything. Try again.";
    static final String TRANSCRIBED = "Transcribed on this phone. Review it, then tap Send.";

    State state = State.IDLE;
    Mode mode = Mode.TALK;
    /** Streamed or final model text. */
    String text;
    /** One line for the card, or null. */
    String notice;

    boolean start(Mode m) {
        if (state != State.IDLE) return false;
        state = State.RECORDING;
        mode = m;
        text = null;
        notice = null;
        return true;
    }

    /** False means the recording was too short and the model must not be called. */
    boolean stopRecording(int pcmBytes) {
        if (state != State.RECORDING) return false;
        if (Wav.tooShort(pcmBytes)) {
            state = State.IDLE;
            notice = NOTHING_HEARD;
            return false;
        }
        state = State.THINKING;
        return true;
    }

    void partial(String soFar) { if (state == State.THINKING) text = soFar; }

    /** The cleaned text to speak (TALK) or to place in the message box (DICTATE); empty when there is nothing to use. */
    String answered(String full) {
        if (state != State.THINKING) return "";
        String cleaned = VoicePrompt.clean(full);
        text = cleaned;
        if (cleaned.isEmpty()) {
            state = State.IDLE;
            notice = NOTHING_HEARD;
            return "";
        }
        if (mode == Mode.TALK) {
            state = State.SPEAKING;
        } else {
            state = State.IDLE;
            notice = TRANSCRIBED;
        }
        return cleaned;
    }

    void spoken() { if (state == State.SPEAKING) state = State.IDLE; }

    void failed(String message) {
        state = State.IDLE;
        notice = message;
    }

    void cancel() {
        state = State.IDLE;
        text = null;
        notice = null;
    }

    String signature() { return state + "|" + mode + "|" + notice + "|" + (text == null ? 0 : text.hashCode()); }
}
