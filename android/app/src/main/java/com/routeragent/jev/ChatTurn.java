package com.routeragent.jev;

import com.routeragent.jev.HostExchange.Failure;
import java.io.IOException;
import java.io.StringReader;
import java.io.StringWriter;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;

/**
 * MA5-S1R2: one phone chat message and what the workstation has been shown to do with it. Each answer is applied to the
 * message object that sent it, and only from the state that answer can follow, so a late or out-of-order event never
 * changes another message. Kept free of android.* and org.json for plain JVM tests (android/tests/ChatTurnTest).
 */
final class ChatTurn {
    enum State { PREPARING, ACKNOWLEDGED, RUNNING, COMPLETED, ENDED, REFUSED, NOT_SENT, FAILED, OUTCOME_UNKNOWN, RECONCILED }

    static final long TRACK_LIMIT_MS = 10 * 60_000;
    static final String GONE_TEXT = "The workstation restarted or changed after this message, so its outcome can no longer be confirmed from the phone. Check Tasks here or on Windows.";
    /** The Host's device projection (publicTask) withholds model output, so an empty field is not an empty answer. */
    static final String NO_OUTPUT = "Completed on the workstation. No answer text reached this phone: the Host does not send model output to paired devices. Read the answer on Windows.";
    static final String UNKNOWN_TEXT = "This message may have reached the workstation and may be running. It was not sent again. Check the workstation before sending it again.";

    final long id;
    /** Null after a restart: the message text is never written to storage. */
    final String prompt;
    final String operationId, hostId, epoch;
    final long sentAt;
    State state = State.PREPARING;
    String taskId, sender = "Bunny", detail;
    long since;
    /** reconciled: the state came from the Host's operation record. exhausted: that record can no longer be read. */
    boolean reconciled, released, exhausted, approveRequested;
    /** A read-only check of the Host's record is in flight. Not stored. */
    boolean checking;

    ChatTurn(long id, String prompt, String operationId, String hostId, String epoch, long sentAt) {
        this.id = id; this.prompt = prompt; this.operationId = operationId; this.hostId = hostId; this.epoch = epoch; this.sentAt = sentAt;
    }

    /** A Send stays disabled while this message's outcome is open, unless the user chose to move on. */
    boolean blocksSending() {
        return state == State.PREPARING || following() || (state == State.OUTCOME_UNKNOWN && !released);
    }
    boolean following() { return state == State.ACKNOWLEDGED || state == State.RUNNING; }
    boolean needsReconcile() { return state == State.OUTCOME_UNKNOWN && !exhausted; }

    /** The Host answered the submit: it created this task (or, unexpectedly, none). */
    void acknowledged(String task, long now) {
        if (state != State.PREPARING) return;
        if (task == null || task.isEmpty()) { state = State.ENDED; detail = "The workstation did not create a task for this message."; return; }
        taskId = task; since = now; state = State.ACKNOWLEDGED; detail = "Accepted by the workstation. Waiting for it to start…";
    }

    /** The submit did not get a usable answer. Only what the failure proves is claimed. */
    void commandFailed(int kind, String message) {
        if (state != State.PREPARING) return;
        if (kind == Failure.OUTCOME_UNKNOWN || kind == 0) { state = State.OUTCOME_UNKNOWN; detail = null; } // 0: unclassified, so not provably unsent
        else if (kind == Failure.FAILED) { state = State.FAILED; detail = message; }
        else if (kind == Failure.NETWORK || kind == Failure.UNAVAILABLE) { state = State.NOT_SENT; detail = message; }
        else { state = State.REFUSED; detail = message; }
    }

    /**
     * The Host's operation record for this message. Accepted only from the Host and epoch the message was sent to: the
     * ledger is per epoch, so another epoch's "unknown" says nothing about this message.
     */
    void reconciled(String seenHostId, String seenEpoch, String opState, String task, String error, long now) {
        if (state != State.OUTCOME_UNKNOWN) return;
        if (epoch == null || !hostId.equals(seenHostId) || !epoch.equals(seenEpoch)) { recordGone(); return; }
        if ("applied".equals(opState)) {
            reconciled = true;
            if (task == null || task.isEmpty()) { state = State.RECONCILED; detail = null; }
            else { state = State.ACKNOWLEDGED; taskId = task; since = now; detail = "The workstation confirms it received this message. Following its task…"; }
        } else if ("refused".equals(opState)) {
            reconciled = true; state = State.REFUSED; detail = error == null || error.isEmpty() ? "The workstation refused this message. Nothing ran." : error;
        } else if ("failed".equals(opState)) {
            reconciled = true; state = State.FAILED; detail = HostExchange.PARTLY_APPLIED;
        } else if ("in_progress".equals(opState)) {
            detail = "The workstation reports it is still applying this message.";
        } else {
            detail = "The workstation has no record of this message: it may not have arrived, or its record expired. That does not prove it never ran.";
        }
    }

    /** The Host restarted or changed since the message: its record of the message is gone for good. */
    void recordGone() {
        if (state != State.OUTCOME_UNKNOWN) return;
        exhausted = true;
        detail = GONE_TEXT;
    }

    /** A check that did not reach the Host changes nothing about the message. */
    void checkFailed() {
        if (state != State.OUTCOME_UNKNOWN) return;
        detail = "Could not reach the workstation to check. Bunny A checks again when the connection returns.";
    }

    /** The user acknowledged the original may already have run and chose to send something new. */
    void release() { if (state == State.OUTCOME_UNKNOWN) released = true; }

    /** The followed task as the polled snapshot shows it. */
    void taskObserved(String hostState, String provider, String model, String output, String error, long now) {
        if (!following()) return;
        sender = "Bunny (" + provider + " · " + model + ")";
        long elapsed = (now - since) / 1000;
        if ("completed".equals(hostState)) { state = State.COMPLETED; detail = output == null || output.isEmpty() ? NO_OUTPUT : output; }
        else if ("failed".equals(hostState)) { state = State.ENDED; detail = "Failed: " + (error == null || error.isEmpty() ? "the task failed." : error); }
        else if ("stopped".equals(hostState)) { state = State.ENDED; detail = "Stopped."; }
        else if (now - since > TRACK_LIMIT_MS) { state = State.ENDED; detail = "No result after " + elapsed + " s. It is still on the workstation and was not stopped."; }
        else if ("waiting_for_approval".equals(hostState)) { state = State.RUNNING; detail = "Waiting for approval on Windows."; }
        else if ("running".equals(hostState)) { state = State.RUNNING; detail = "Generating (" + elapsed + " s)…"; }
        else { state = State.RUNNING; detail = "Workstation state: " + hostState.replace('_', ' ') + "…"; }
    }

    void taskMissing(long now) {
        if (following() && now - since > TRACK_LIMIT_MS) { state = State.ENDED; detail = "The workstation no longer lists this chat."; }
    }

    String label() {
        switch (state) {
            case PREPARING: return "Sending";
            case ACKNOWLEDGED: return reconciled ? "Accepted (confirmed after reconnecting)" : "Accepted";
            case RUNNING: return "Running";
            case COMPLETED: return "Completed";
            case ENDED: return "Ended";
            case REFUSED: return reconciled ? "Refused (confirmed by the workstation)" : "Refused, not done";
            case NOT_SENT: return "Not sent";
            case FAILED: return "Failed, may have partly applied";
            case OUTCOME_UNKNOWN: return "Outcome unknown";
            default: return "Applied (confirmed by the workstation)";
        }
    }

    String text() {
        switch (state) {
            case PREPARING: return "Sending to the workstation…";
            case OUTCOME_UNKNOWN:
                return UNKNOWN_TEXT + (detail == null ? "" : "\n" + detail)
                        + (released ? "\nYou chose to continue without confirmation; this message may still have run." : "");
            case RECONCILED: return "The workstation confirms it applied this message but did not identify its task, so no answer is shown. Check Tasks here or on Windows.";
            default: return detail == null ? "" : detail;
        }
    }

    /** Process-wide list of this phone's chat messages, newest last. */
    static final class Book {
        final List<ChatTurn> turns = new ArrayList<>();
        private long nextId = 1;

        ChatTurn start(String prompt, String operationId, String hostId, String epoch, long now) {
            ChatTurn turn = new ChatTurn(nextId++, prompt, operationId, hostId, epoch, now);
            turns.add(turn);
            return turn;
        }
        ChatTurn blocking() { for (ChatTurn t : turns) if (t.blocksSending()) return t; return null; }
        boolean following() { for (ChatTurn t : turns) if (t.following()) return true; return false; }
        String signature() {
            StringBuilder s = new StringBuilder();
            for (ChatTurn t : turns) s.append(t.id).append(t.state).append(t.released).append(t.checking).append(t.sender).append(t.detail).append('|');
            return s.toString();
        }

        /** A send whose screen went away can no longer report its answer here, so it is no longer "sending". */
        void interrupted() {
            for (ChatTurn t : turns) if (t.state == State.PREPARING) {
                t.state = State.OUTCOME_UNKNOWN;
                t.detail = "Bunny A closed or restarted before the workstation answered.";
            }
        }

        /** Only open messages are kept, without their text: ids, the Host they went to, and what is proven. Never a success. */
        String encode() {
            Properties p = new Properties();
            int n = 0;
            for (ChatTurn t : turns) {
                if (!t.blocksSending() && !t.needsReconcile()) continue;
                String k = n++ + ".";
                p.setProperty(k + "op", t.operationId);
                p.setProperty(k + "host", t.hostId);
                if (t.epoch != null) p.setProperty(k + "epoch", t.epoch);
                p.setProperty(k + "state", t.state.name());
                if (t.taskId != null) p.setProperty(k + "task", t.taskId);
                p.setProperty(k + "sentAt", Long.toString(t.sentAt));
                p.setProperty(k + "since", Long.toString(t.since));
                p.setProperty(k + "flags", (t.reconciled ? "r" : "") + (t.released ? "l" : "") + (t.exhausted ? "x" : "") + (t.approveRequested ? "a" : ""));
            }
            p.setProperty("count", Integer.toString(n));
            StringWriter out = new StringWriter();
            try { p.store(out, null); } catch (IOException e) { throw new IllegalStateException(e); }
            return out.toString();
        }

        static Book decode(String saved) {
            Book book = new Book();
            if (saved == null) return book;
            Properties p = new Properties();
            try { p.load(new StringReader(saved)); } catch (IOException | IllegalArgumentException e) { return book; }
            int count;
            try { count = Math.min(50, Integer.parseInt(p.getProperty("count", "0"))); } catch (NumberFormatException e) { count = 0; }
            for (int i = 0; i < count; i++) {
                String k = i + ".";
                String op = p.getProperty(k + "op", ""), host = p.getProperty(k + "host", "");
                if (!op.matches("[A-Za-z0-9-]{8,64}") || host.isEmpty()) continue;
                ChatTurn t = book.start(null, op, host, p.getProperty(k + "epoch"), number(p.getProperty(k + "sentAt")));
                // A damaged state field reads as unknown: never as done, never as unsent.
                try { t.state = State.valueOf(p.getProperty(k + "state", "")); } catch (IllegalArgumentException e) { t.state = State.OUTCOME_UNKNOWN; }
                t.taskId = p.getProperty(k + "task");
                t.since = number(p.getProperty(k + "since"));
                String flags = p.getProperty(k + "flags", "");
                t.reconciled = flags.contains("r"); t.released = flags.contains("l"); t.exhausted = flags.contains("x"); t.approveRequested = flags.contains("a");
                if (t.following() && t.taskId == null) t.state = State.OUTCOME_UNKNOWN;
                if (t.state == State.OUTCOME_UNKNOWN && t.exhausted) t.detail = GONE_TEXT;
            }
            book.interrupted();
            return book;
        }
        private static long number(String value) { try { return Long.parseLong(value); } catch (NumberFormatException e) { return 0; } }
    }
}
