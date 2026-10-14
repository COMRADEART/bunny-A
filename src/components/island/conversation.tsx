import { useState } from "react";
import { useIsland } from "@/store/use-island";
import { WEAPON_LABEL } from "@/lib/bunny-host/personal-agents";
import { CONTEXT_LIMITS, type ConversationIdentity } from "@/lib/bunny-host/personal-agent-context";

/** Host states in which an owned Agent is actually doing work; "not started" or "paused" never reads as working. */
const WORKING = new Set(["PLANNING", "RUNNING", "VERIFYING", "WAITING_FOR_DEPENDENCY"]);

/**
 * M-A-3 T13.3: choose who answers (Bunny or one Personal Agent) and talk to that Agent directly. Choosing a speaker never
 * pauses, stops or moves anyone's work; replies are the Host's own facts about the Agent's owned Missions.
 */
export function AgentConversation() {
  const store = useIsland();
  const context = store.personalAgentContext;
  const slots = store.personalAgents?.slots ?? [];
  const [text, setText] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  if (!context) {
    return (
      <section className="t8-section" aria-labelledby="talk-title">
        <h2 id="talk-title">Talk to your Agents</h2>
        <p className="caption">Conversations with your Personal Agents stay on your Windows PC.</p>
      </section>
    );
  }
  const speaker = context.foreground;
  const nameOf = (slot: number) => {
    const row = slots.find((item) => item.slot === slot);
    return row ? row.displayName || WEAPON_LABEL[row.weapon] : `Agent ${slot}`;
  };
  const working = (slot: number) => context.slots.find((row) => row.slot === slot)?.owned.filter((row) => WORKING.has(row.state)).length ?? 0;
  const choose = async (identity: ConversationIdentity) => {
    setRefusal(null);
    if (identity !== speaker) setText("");
    await store.personalAgentCommand("personal_agent.foreground", { identity }, setRefusal);
  };
  const own = speaker === "bunny" ? null : context.slots.find((row) => row.slot === speaker) ?? null;
  const send = async () => {
    if (speaker === "bunny" || !text.trim() || sending) return;
    setSending(true);
    setRefusal(null);
    if (await store.personalAgentCommand("personal_agent.converse", { slot: speaker, text }, setRefusal)) setText("");
    setSending(false);
  };
  return (
    <section className="t8-section" aria-labelledby="talk-title">
      <div className="section-heading">
        <h2 id="talk-title">Talk to your Agents</h2>
        <span className="caption">Switching who answers never stops anyone's work.</span>
      </div>
      <div className="t8-surface" style={{ padding: 16 }}>
        <div className="st-tags" role="radiogroup" aria-label="Who answers">
          {(["bunny", 1, 2, 3, 4] as const).map((identity) => {
            const busy = identity === "bunny" ? 0 : working(identity);
            return (
              <button
                key={identity}
                type="button"
                role="radio"
                aria-checked={speaker === identity}
                className="st-tag"
                aria-pressed={speaker === identity}
                disabled={!store.canAct()}
                onClick={() => void choose(identity)}
              >
                {identity === "bunny" ? "Bunny" : nameOf(identity)}
                {busy > 0 && <small className="cx-muted"> · {busy} working</small>}
              </button>
            );
          })}
        </div>
        {!own && <p className="caption">Bunny is answering. Choose a Personal Agent to ask it about its own Missions.</p>}
        {own && (
          <>
            <p className="caption">
              {nameOf(own.slot)} owns {own.owned.length} {own.owned.length === 1 ? "Mission" : "Missions"}. Answers come from the Host's records, not guesses.
            </p>
            <ol aria-label={`Conversation with ${nameOf(own.slot)}`} style={{ listStyle: "none", padding: 0, margin: "8px 0", display: "grid", gap: 6 }}>
              {own.turns.map((turn) => (
                <li key={turn.id}>
                  <strong>{turn.role === "user" ? "You" : nameOf(own.slot)}:</strong> {turn.text}
                </li>
              ))}
              {!own.turns.length && <li className="cx-muted">No conversation yet.</li>}
            </ol>
            <form
              className="ap-actions"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <label style={{ flex: 1 }}>
                <span className="cx-muted">Message {nameOf(own.slot)}</span>
                <input value={text} maxLength={CONTEXT_LIMITS.turn} onChange={(event) => setText(event.target.value)} style={{ width: "100%" }} />
              </label>
              <button className="btn primary" type="submit" disabled={!text.trim() || sending || !store.canAct()}>
                {sending ? "Sending…" : "Send"}
              </button>
            </form>
          </>
        )}
        {refusal && (
          <p className="st-error" role="alert">
            {refusal}
          </p>
        )}
      </div>
    </section>
  );
}
