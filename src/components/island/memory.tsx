import { useState } from "react";
import { useIsland } from "@/store/use-island";
import { LOTUS_LIMITS, type LotusLayer, type LotusMemory, type LotusTrust } from "@/lib/bunny-host/lotus";
import type { SlotId } from "@/lib/bunny-host/personal-agents";

const LAYER: Record<LotusLayer, string> = { central: "Core fact", inner: "Project knowledge", outer: "Recent context", bud: "Raw evidence" };
const TRUST: Record<LotusTrust, string> = { user: "You said", host: "Host record", model: "Model note, unverified", untrusted: "Outside text, untrusted" };

/**
 * M-A-3 T13.3 Gate C: one Personal Agent's Lotus memory, as the Host projects it (its own scope and its Projects). Every
 * change is a Host command; nothing here decides what an Agent may read.
 */
export function AgentMemory({ slot, name, memories }: { slot: SlotId; name: string; memories: LotusMemory[] }) {
  const store = useIsland();
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [origin, setOrigin] = useState<"user" | "web" | "repository">("user");
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (action: string, data: Record<string, unknown>) => {
    setBusy(true);
    setRefusal(null);
    const result = await store.personalAgentCommand(action, data, setRefusal);
    setBusy(false);
    return result;
  };
  const exportMemory = async () => {
    const result = await act("lotus.export", { scope: `agent:${slot}` });
    if (!result?.data) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name.replace(/[^\p{L}\p{N}]+/gu, "-")}-memory.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const disabled = busy || !store.canAct();
  return (
    <div style={{ marginTop: 16 }}>
      <div className="section-heading">
        <h3 id={`memory-${slot}`}>{name}'s memory</h3>
        <button type="button" className="btn" onClick={() => void exportMemory()} disabled={busy}>
          Export
        </button>
      </div>
      <p className="caption">Only you can make a model's note or pasted outside text a lasting fact. Credentials are never kept.</p>
      <ul aria-labelledby={`memory-${slot}`} style={{ listStyle: "none", padding: 0, margin: "8px 0", display: "grid", gap: 8 }}>
        {memories.map((memory) => (
          <li key={memory.id} className="ap-row" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
            <span style={{ flex: "1 1 240px", minWidth: 0 }}>
              <strong>{memory.key}</strong>
              <small className="cx-muted">
                {" "}
                · {LAYER[memory.layer]} · {TRUST[memory.trust]}
                {memory.scope.startsWith("project:") ? " · Project note" : ""}
                {memory.revision > 1 ? ` · revision ${memory.revision}` : ""}
              </small>
              {editing?.id === memory.id ? (
                <form
                  className="ap-actions"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (await act("lotus.correct", { id: memory.id, value: editing.value })) setEditing(null);
                  }}
                >
                  <label style={{ flex: 1 }}>
                    <span className="cx-muted">Correct {memory.key}</span>
                    <input value={editing.value} maxLength={LOTUS_LIMITS.value} onChange={(event) => setEditing({ id: memory.id, value: event.target.value })} style={{ width: "100%" }} />
                  </label>
                  <button type="submit" className="btn primary" disabled={disabled || !editing.value.trim()}>
                    Save
                  </button>
                  <button type="button" className="btn" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <span style={{ display: "block", overflowWrap: "anywhere" }}>{memory.value}</span>
              )}
            </span>
            {editing?.id !== memory.id && memory.scope === `agent:${slot}` && (
              <span className="ap-actions">
                <button type="button" className="btn" disabled={disabled} onClick={() => setEditing({ id: memory.id, value: memory.value })}>
                  Correct
                </button>
                {memory.layer !== "central" && (
                  <button type="button" className="btn" disabled={disabled} onClick={() => void act("lotus.promote", { id: memory.id, layer: "central" })}>
                    Keep as core fact
                  </button>
                )}
                <button type="button" className="btn" disabled={disabled} onClick={() => void act("lotus.forget", { id: memory.id })} aria-label={`Forget ${memory.key}`}>
                  Forget
                </button>
              </span>
            )}
          </li>
        ))}
        {!memories.length && <li className="cx-muted">Nothing remembered yet.</li>}
      </ul>
      <form
        className="ap-actions"
        style={{ flexWrap: "wrap" }}
        onSubmit={async (event) => {
          event.preventDefault();
          if (await act("lotus.remember", { scope: `agent:${slot}`, key, value, origin })) {
            setKey("");
            setValue("");
            setOrigin("user");
          }
        }}
      >
        <label style={{ flex: "1 1 140px" }}>
          <span className="cx-muted">Name</span>
          <input value={key} maxLength={LOTUS_LIMITS.key} onChange={(event) => setKey(event.target.value)} style={{ width: "100%" }} />
        </label>
        <label style={{ flex: "2 1 220px" }}>
          <span className="cx-muted">What {name} should remember</span>
          <input value={value} maxLength={LOTUS_LIMITS.value} onChange={(event) => setValue(event.target.value)} style={{ width: "100%" }} />
        </label>
        <label style={{ flex: "1 1 160px" }}>
          <span className="cx-muted">Source</span>
          <select value={origin} onChange={(event) => setOrigin(event.target.value as typeof origin)} style={{ width: "100%" }}>
            <option value="user">I'm telling it</option>
            <option value="web">Pasted from a web page</option>
            <option value="repository">Pasted from a repository</option>
          </select>
        </label>
        <button type="submit" className="btn primary" disabled={disabled || !key.trim() || !value.trim()}>
          Remember
        </button>
      </form>
      {refusal && (
        <p className="st-error" role="alert">
          {refusal}
        </p>
      )}
    </div>
  );
}
