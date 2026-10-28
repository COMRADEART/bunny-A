package com.routeragent.jev;

import com.routeragent.jev.ChatTurn.State;
import com.routeragent.jev.HostExchange.Failure;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * MA5-S1R2: the phone's per-message chat state (ChatTurn) through a lost acknowledgment, reconciliation against the
 * Host's operation record, duplicate prevention and restore after the process ends. Compiled with HostExchangeTest for
 * its fault server. Runs without Android (scripts/build-android.ps1).
 */
public final class ChatTurnTest {
    private static int checks;
    private static void check(boolean ok, String what) { if (!ok) throw new AssertionError(what); checks++; System.out.println("  PASS " + what); }

    private static final String HOST = "host-1", EPOCH = "epoch-1";
    private static ChatTurn unknownTurn(ChatTurn.Book book) {
        ChatTurn t = book.start("hello", UUID.randomUUID().toString(), HOST, EPOCH, 1000);
        t.commandFailed(Failure.OUTCOME_UNKNOWN, HostExchange.UNCONFIRMED);
        return t;
    }
    private static boolean claimsNotRun(String text) { return text.matches("(?is).*(not sent(?! again)|nothing was sent|not executed|did not run|was not done).*"); }

    public static void main(String[] args) throws Exception {
        System.out.println("C1 real socket: the Host reads the submit, then the answer is lost");
        try (HostExchangeTest.FaultServer server = new HostExchangeTest.FaultServer()) {
            server.mode = HostExchangeTest.Mode.RESET_AFTER_BODY;
            ChatTurn.Book book = new ChatTurn.Book();
            String op = UUID.randomUUID().toString();
            ChatTurn turn = book.start("What is 2+2?", op, HOST, EPOCH, 1000);
            check(turn.state == State.PREPARING && turn.text().startsWith("Sending"), "starts as Sending with its operation id chosen before dispatch");
            HttpURLConnection c = (HttpURLConnection) new URL("http://127.0.0.1:" + server.port() + "/api/bunny-native-v1-state").openConnection();
            c.setRequestMethod("POST"); c.setConnectTimeout(2000); c.setReadTimeout(4000);
            byte[] body = ("{\"action\":\"submit\",\"operationId\":\"" + op + "\",\"data\":{\"prompt\":\"What is 2+2?\"}}").getBytes(StandardCharsets.UTF_8);
            try { HostExchange.send(c, body, op); check(false, "the lost answer must fail"); }
            catch (Failure f) { turn.commandFailed(f.kind, f.getMessage()); check(op.equals(f.operationId), "the failure carries the message's own operation id"); }
            finally { c.disconnect(); }
            check(server.received.get() == 1, "the Host received the submit exactly once");
            check(turn.state == State.OUTCOME_UNKNOWN, "R2-G1: the message leaves Sending for Outcome unknown");
            check(!turn.text().contains("Sending") && turn.label().equals("Outcome unknown"), "R2-G1: no Sending text remains on the message");
            check(!claimsNotRun(turn.text()), "uncertainty is not worded as 'not sent'");
            check(turn.operationId.equals(op) && turn.hostId.equals(HOST) && turn.epoch.equals(EPOCH), "R2-G2/G3: operation id, Host and epoch kept");
            check(book.blocking() == turn, "R2-G4: Send stays disabled while the outcome is open");
            check(turn.needsReconcile(), "R2-G5: a read-only check is due");
            check(server.received.get() == 1, "R2-G4: nothing re-sent the submit");
        }

        System.out.println("C2 reconciliation from the Host's operation record");
        ChatTurn.Book book = new ChatTurn.Book();
        ChatTurn t = unknownTurn(book);
        t.reconciled(HOST, EPOCH, "applied", "task-7", null, 5000);
        check(t.state == State.ACKNOWLEDGED && "task-7".equals(t.taskId) && t.reconciled && t.following(), "applied + task id: the phone follows that task");
        t.taskObserved("completed", "ollama", "qwen2.5-coder:7b", "4", null, 6000);
        check(t.state == State.COMPLETED && t.text().equals("4") && t.sender.contains("qwen2.5-coder:7b"), "the model's actual answer and model are shown");
        t = unknownTurn(book); t.reconciled(HOST, EPOCH, "applied", null, null, 5000);
        check(t.state == State.RECONCILED && t.taskId == null && !t.blocksSending(), "applied without a task id: confirmed, no invented task or answer");
        t = unknownTurn(book); t.reconciled(HOST, EPOCH, "refused", null, "Approval required on Windows Host.", 5000);
        check(t.state == State.REFUSED && t.text().equals("Approval required on Windows Host."), "refused: the Host's refusal is shown");
        t = unknownTurn(book); t.reconciled(HOST, EPOCH, "failed", null, "Host command failed.", 5000);
        check(t.state == State.FAILED && t.text().equals(HostExchange.PARTLY_APPLIED), "R2-G6: failed reads as 'may have partly applied'");
        t = unknownTurn(book); t.reconciled(HOST, EPOCH, "in_progress", null, null, 5000);
        check(t.state == State.OUTCOME_UNKNOWN && t.needsReconcile() && t.text().contains("still applying"), "in progress stays pending");
        t = unknownTurn(book); t.reconciled(HOST, EPOCH, "unknown", null, null, 5000);
        check(t.state == State.OUTCOME_UNKNOWN && !claimsNotRun(t.text()) && t.text().contains("does not prove it never ran"), "R2-G6: unknown stays unknown, never 'not executed'");
        t = unknownTurn(book); t.reconciled(HOST, "epoch-2", "unknown", null, null, 5000);
        check(t.state == State.OUTCOME_UNKNOWN && t.exhausted && !t.needsReconcile(), "C: another epoch's answer is not evidence and ends checking");
        t = unknownTurn(book); t.reconciled(HOST, "epoch-2", "applied", "task-x", null, 5000);
        check(t.state == State.OUTCOME_UNKNOWN && t.taskId == null, "C: even 'applied' from another epoch is not accepted");
        t = unknownTurn(book); t.reconciled("host-2", EPOCH, "applied", "task-x", null, 5000);
        check(t.state == State.OUTCOME_UNKNOWN && t.exhausted, "another Host's answer is not accepted");
        t = unknownTurn(book); t.recordGone();
        check(t.text().contains("restarted") && !claimsNotRun(t.text()), "a Host restart (HOST_EPOCH_CHANGED) leaves it unknown and says why");
        t = unknownTurn(book); t.checkFailed();
        check(t.state == State.OUTCOME_UNKNOWN && t.needsReconcile(), "a check that did not reach the Host changes nothing");

        System.out.println("C3 what each submit failure proves");
        int[][] cases = { { Failure.NETWORK, State.NOT_SENT.ordinal() }, { Failure.UNAVAILABLE, State.NOT_SENT.ordinal() }, { Failure.REFUSED, State.REFUSED.ordinal() },
                { Failure.AUTH, State.REFUSED.ordinal() }, { Failure.RATE_LIMITED, State.REFUSED.ordinal() }, { Failure.FAILED, State.FAILED.ordinal() },
                { Failure.OUTCOME_UNKNOWN, State.OUTCOME_UNKNOWN.ordinal() }, { 0, State.OUTCOME_UNKNOWN.ordinal() } };
        for (int[] c : cases) {
            ChatTurn x = book.start("p", UUID.randomUUID().toString(), HOST, EPOCH, 0);
            x.commandFailed(c[0], "m");
            check(x.state.ordinal() == c[1], "failure kind " + c[0] + " -> " + State.values()[c[1]]);
        }

        System.out.println("C4 stable identity: an answer changes only its own message, and only from a state it can follow");
        book = new ChatTurn.Book();
        ChatTurn a = book.start("first", "op-aaaaaaaa", HOST, EPOCH, 0), b = book.start("second", "op-bbbbbbbb", HOST, EPOCH, 0);
        a.commandFailed(Failure.OUTCOME_UNKNOWN, "");
        check(b.state == State.PREPARING && a.id != b.id, "a failure for one message leaves the other untouched");
        a.acknowledged("task-late", 1);
        check(a.state == State.OUTCOME_UNKNOWN && a.taskId == null, "a stray acknowledgment cannot overwrite an unknown outcome");
        b.acknowledged("task-b", 1);
        b.commandFailed(Failure.NETWORK, "Nothing was sent.");
        check(b.state == State.ACKNOWLEDGED && "task-b".equals(b.taskId), "a stray failure cannot undo an acknowledgment");
        a.taskObserved("completed", "x", "y", "wrong", null, 2);
        check(a.state == State.OUTCOME_UNKNOWN, "task updates reach only acknowledged messages");

        System.out.println("C5 duplicate prevention and deliberate new message");
        book = new ChatTurn.Book();
        ChatTurn open = unknownTurn(book);
        check(book.blocking() == open, "an unresolved message blocks Send");
        open.release();
        check(book.blocking() == null && open.state == State.OUTCOME_UNKNOWN && open.text().contains("may still have run"), "after the user's acknowledgment Send unlocks; the message stays unknown");
        ChatTurn fresh = book.start("again", UUID.randomUUID().toString(), HOST, EPOCH, 9);
        check(!fresh.operationId.equals(open.operationId) && fresh.id != open.id, "a deliberate new message is a new operation, not a replay");
        ChatTurn done = book.start("x", UUID.randomUUID().toString(), HOST, EPOCH, 0);
        done.commandFailed(Failure.NETWORK, "Nothing was sent.");
        check(!done.blocksSending(), "a provably unsent message does not trap the user");

        System.out.println("C6 restore after the process ends (and after a recreated screen)");
        book = new ChatTurn.Book();
        ChatTurn sending = book.start("secret prompt text", "op-sending-1", HOST, EPOCH, 10);
        ChatTurn unknown = unknownTurn(book);
        ChatTurn following = book.start("follow", "op-follow-1", HOST, EPOCH, 10); following.acknowledged("task-9", 11); following.approveRequested = true;
        ChatTurn completed = book.start("c", "op-complete-1", HOST, EPOCH, 10); completed.acknowledged("task-c", 11); completed.taskObserved("completed", "p", "m", "answer", null, 12);
        ChatTurn gone = unknownTurn(book); gone.recordGone();
        String stored = book.encode();
        check(!stored.contains("secret prompt text") && !stored.contains("answer") && !stored.toLowerCase().contains("token"), "storage holds no message text, answer or credential");
        check(!stored.contains("op-complete-1"), "a completed message is never stored (no persisted success)");
        ChatTurn.Book restored = ChatTurn.Book.decode(stored);
        check(restored.turns.size() == 4, "the four open messages are restored");
        ChatTurn r0 = restored.turns.get(0), r1 = restored.turns.get(1), r2 = restored.turns.get(2), r3 = restored.turns.get(3);
        check(r0.operationId.equals("op-sending-1") && r0.state == State.OUTCOME_UNKNOWN && r0.prompt == null, "R2-G8: a send cut off by the process end restores as Outcome unknown, not Sending");
        check(r1.operationId.equals(unknown.operationId) && r1.epoch.equals(EPOCH) && r1.hostId.equals(HOST) && r1.needsReconcile(), "R2-G8: an unknown outcome keeps its id, Host and epoch");
        check(r2.state == State.ACKNOWLEDGED && "task-9".equals(r2.taskId) && r2.approveRequested && r2.since == 11, "a followed task resumes without a second approve");
        check(r3.exhausted && r3.text().contains("restarted") && !r3.needsReconcile() && r3.blocksSending(), "an exhausted message stays unknown and still needs the user's acknowledgment");
        check(restored.blocking() == r0, "Send is still blocked after restore");
        ChatTurn.Book live = new ChatTurn.Book();
        ChatTurn inFlight = live.start("x", "op-inflight-1", HOST, EPOCH, 0);
        live.interrupted();
        check(inFlight.state == State.OUTCOME_UNKNOWN && inFlight.prompt != null, "a recreated screen turns its predecessor's send into Outcome unknown");
        check(ChatTurn.Book.decode("count=3\n0.op=op-damaged-1\n0.host=h\n0.state=BOGUS\n1.op=bad id\n1.host=h\n").turns.get(0).state == State.OUTCOME_UNKNOWN, "a damaged state field restores as unknown, never as done");
        check(ChatTurn.Book.decode("count=1\n0.op=op-follow-2\n0.host=h\n0.state=RUNNING\n").turns.get(0).state == State.OUTCOME_UNKNOWN, "following without a task id restores as unknown");
        check(ChatTurn.Book.decode("\u0000garbage").turns.isEmpty() && ChatTurn.Book.decode(null).turns.isEmpty(), "garbage or nothing restores empty");

        System.out.println("C7 following the task");
        ChatTurn f = new ChatTurn.Book().start("p", "op-follow-3", HOST, EPOCH, 0);
        f.acknowledged("task-1", 0);
        f.taskObserved("waiting_for_approval", "ollama", "m", "", null, 1000);
        check(f.state == State.RUNNING && f.text().contains("approval"), "waiting for approval is shown as the Host reports it");
        ChatTurn withheld = new ChatTurn.Book().start("p", "op-follow-5", HOST, EPOCH, 0);
        withheld.acknowledged("task-3", 0);
        withheld.taskObserved("completed", "ollama", "m", "", null, 1000);
        check(withheld.state == State.COMPLETED && withheld.text().equals(ChatTurn.NO_OUTPUT) && !withheld.text().contains("empty output"), "withheld output is not shown as an empty answer");
        f.taskObserved("running", "ollama", "m", "", null, 3000);
        check(f.text().startsWith("Generating"), "running");
        f.taskObserved("failed", "ollama", "m", "", "model crashed", 4000);
        check(f.state == State.ENDED && f.text().equals("Failed: model crashed") && !f.blocksSending(), "a failed task ends the message");
        ChatTurn slow = new ChatTurn.Book().start("p", "op-follow-4", HOST, EPOCH, 0);
        slow.acknowledged("task-2", 0);
        slow.taskMissing(ChatTurn.TRACK_LIMIT_MS + 1);
        check(slow.state == State.ENDED, "a task missing past the limit stops being followed");
        System.out.println("ChatTurnTest: " + checks + " checks passed.");
    }
}
