package com.routeragent.jev;

import com.routeragent.jev.VoiceSession.Mode;
import com.routeragent.jev.VoiceSession.State;

/** The on-device voice state machine, exercised without Android. */
public final class VoiceSessionTest {
    private static int checks;
    private static void check(boolean ok, String what) { if (!ok) throw new AssertionError(what); checks++; }

    /** A session placed in the given state through its public transitions. */
    static VoiceSession at(State st) {
        VoiceSession s = new VoiceSession();
        if (st == State.IDLE) return s;
        s.start(Mode.TALK);
        if (st == State.RECORDING) return s;
        s.stopRecording(64_000);
        s.partial("so far");
        if (st == State.THINKING) return s;
        s.answered("An answer.");
        return s;
    }

    public static void main(String[] args) {
        VoiceSession s = new VoiceSession();
        check(s.state == State.IDLE && s.start(Mode.TALK) && s.state == State.RECORDING, "start");
        check(!s.start(Mode.DICTATE), "no second start while recording");
        check(!s.stopRecording(15_999) && s.state == State.IDLE && "I didn't catch anything. Try again.".equals(s.notice), "shortRecordingSkipsModel");
        s.start(Mode.TALK); check(s.notice == null && s.stopRecording(64_000) && s.state == State.THINKING, "thinking");
        s.partial("Fo"); check("Fo".equals(s.text), "partial shown");
        check("Four.".equals(s.answered("**Four.**")) && s.state == State.SPEAKING, "talk speaks cleaned text");
        s.spoken(); check(s.state == State.IDLE, "spoken");
        s.start(Mode.DICTATE); s.stopRecording(64_000);
        check("check the build".equals(s.answered(" check the build ")) && s.state == State.IDLE && "Transcribed on this phone. Review it, then tap Send.".equals(s.notice), "dictation ends idle");
        s.start(Mode.DICTATE); s.stopRecording(64_000);
        check("".equals(s.answered("  ")) && "I didn't catch anything. Try again.".equals(s.notice), "emptyDictationKeepsDraft");
        s.start(Mode.TALK); s.stopRecording(64_000);
        check("".equals(s.answered("")) && s.state == State.IDLE && "I didn't catch anything. Try again.".equals(s.notice), "an empty spoken answer is not spoken");
        for (State st : State.values()) { VoiceSession c = at(st); check(c.state == st, "helper reaches " + st); c.cancel(); check(c.state == State.IDLE && c.text == null && c.notice == null, "cancelFromEveryState " + st); }
        VoiceSession f = at(State.THINKING); f.failed("The voice model stopped."); check(f.state == State.IDLE && "The voice model stopped.".equals(f.notice), "failure is shown");
        VoiceSession late = new VoiceSession(); late.partial("x"); check(late.text == null, "late partial after cancel is ignored");
        check(late.answered("x").isEmpty() && late.state == State.IDLE, "late answer after cancel is ignored");
        check(!late.stopRecording(64_000) && late.state == State.IDLE, "stop without a recording does nothing");
        VoiceSession sp = at(State.SPEAKING); sp.spoken(); check(sp.state == State.IDLE, "speaking ends idle");
        VoiceSession sig = new VoiceSession(); String idle = sig.signature(); sig.start(Mode.DICTATE);
        check(!idle.equals(sig.signature()) && sig.signature().startsWith("RECORDING|DICTATE|"), "signature follows state and mode");
        System.out.println("VoiceSessionTest: " + checks + " checks passed");
    }
}
