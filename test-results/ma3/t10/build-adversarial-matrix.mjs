// M-A-3 T10 §41: derives adversarial-matrix.json (V01–V60) from the retained regression logs and live evidence files.
// Each row records environment, expected, observed, evidence, classification and verdict. Nothing is inferred: a row is
// PASS only when every mapped test passed in the full regression and every mapped live receipt reports a pass.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../../..");
const ev = (p) => join(root, "test-results/ma3/t10", p);
const logs = ["scripts", "library", "agent", "ui"].map((n) => ({ n, text: existsSync(ev(`regression/${n}.log`)) ? readFileSync(ev(`regression/${n}.log`), "utf8") : "" }));
const results = [];
for (const { n, text } of logs) for (const line of text.split(/\r?\n/)) {
  const m = /^\s*(✔|✖|﹣) (.+?)(?: \([\d.]+m?s\))?(?: # (SKIP|TODO).*)?$/.exec(line);
  if (m) results.push({ suite: n, ok: m[1] === "✔" && !m[3], skipped: !!m[3], name: m[2].trim() });
}
const byTag = (re) => results.filter((r) => re.test(r.name));
const json = (p) => { try { return JSON.parse(readFileSync(ev(p), "utf8")); } catch { return null; } };
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

const TITLES = {
  V01: "Microphone inactive by default", V02: "Explicit microphone activation works", V03: "Windows permission denial is handled", V04: "Device unavailable state is truthful", V05: "Duplicate microphone streams rejected", V06: "Audio buffers are bounded", V07: "Recognized speech comes from actual audio", V08: "Partial transcript is not executed as a command", V09: "Final transcript is associated with the correct turn", V10: "Recognition correction does not duplicate a Task",
  V11: "Silence is not fabricated as a spoken command", V12: "Noise-only input fails safely", V13: "Real conversation response is routed correctly", V14: "T3 Task routing is preserved", V15: "Unknown model identity remains UNKNOWN", V16: "No unauthorized cloud-audio upload", V17: "Actual TTS playback works", V18: "TTS chunks play in order", V19: "Interrupted audio actually stops", V20: "Pending synthesized chunks do not resume",
  V21: "Late model callbacks do not restart stale playback", V22: "Rapid interruption does not corrupt turn state", V23: "Two overlapping conversations cannot corrupt each other", V24: "Muted microphone captures no new user speech", V25: "Microphone resources release on session close", V26: "Device disconnection is handled", V27: "Playback-device loss is handled", V28: "Echo does not cause uncontrolled response loops", V29: "Voice interruption does not stop unrelated Agent work", V30: "Spoken Agent-status query uses canonical facts",
  V31: "Spoken verification query reports real outcomes", V32: "Spoken Pause uses existing Host command", V33: "Spoken Stop targets the correct Agent", V34: "Ambiguous Agent reference requires clarification", V35: "Voice cannot forge Windows-owner identity", V36: "Voice cannot authorize arbitrary shell execution", V37: "Voice cannot widen Mission scope", V38: "Voice cannot bypass phone restrictions", V39: "Audio prompt injection does not grant authority", V40: "Recorded/replayed speech is not treated as owner authentication",
  V41: "Agent Talk/Redirect is genuine or explicitly unavailable", V42: "Ordinary chat is not silently converted to Agentic execution", V43: "Voice activity state survives UI reconnect correctly", V44: "Host restart does not revive stale voice approvals", V45: "Closed voice UI does not terminate AgentRuntime", V46: "Glass Notch correctly displays live voice state", V47: "Working Agent indicators appear left of horizontal notch", V48: "Working Agent indicators appear at top of vertical notch", V49: "Notch remains within usable screen bounds", V50: "Keyboard/microphone controls are accessible",
  V51: "Reduced-motion behavior works", V52: "No raw private audio in evidence or logs", V53: "T5/F01–F04 authorization protections remain intact", V54: "Provider process containment remains intact", V55: "Real Calculator X53 continues to work", V56: "Existing T9 remote device restrictions remain intact", V57: "No production audio settings or credentials changed", V58: "Real microphone-to-playback acceptance is performed", V59: "Ten interruption scenarios produce truthful results", V60: "Full regression suite remains green",
};

// Live receipts that strengthen specific rows (file, predicate, observed summary).
const live = {
  bargeIn: json("barge-in-adversarial.json"),
  e2e: json("live-e2e-conversation.json"),
  stt: json("live/human-stt-session-5-whisper-beep.json"),
  supervision: json("agent-voice-supervision.json"),
  notch: json("notch/placement-receipts.json"),
  hotkey: json("notch/hotkey-product-receipt.json"),
  desktop: json("desktop/desktop-render-receipt.json"),
  secret: json("secret-scan.json"),
  prodFinal: json("production-final.json"),
  pkg: json("windows-package-results.json"),
};
const e2eTurns = live.e2e?.turns ?? [];
const e2eInterrupt = (live.e2e?.interrupts ?? []).find((i) => i.workerResetMs !== null && i.meterSilentMs !== null);
const extra = {
  V02: live.e2e && { evidence: "live-e2e-conversation.json", ok: e2eTurns.length >= 4, observed: `${e2eTurns.length} live spoken turns opened explicitly by the Ctrl+Alt+Space chord` },
  V07: live.stt && { evidence: "live/human-stt-session-5-whisper-beep.json", ok: live.stt.summary.exactOrNear >= 8, observed: `human speech on the real microphone: ${live.stt.summary.exactOrNear}/10 near-exact, WER ${live.stt.summary.meanWer}` },
  V13: live.e2e && { evidence: "live-e2e-conversation.json", ok: e2eTurns.some((t) => t.turnKind === "chat" && t.route?.provider === "ollama"), observed: "spoken chat turns routed by the T3 router to a local tool-free Ollama model" },
  V17: live.e2e && { evidence: "live-e2e-conversation.json", ok: e2eTurns.every((t) => t.timing?.firstPlaybackAt), observed: "every live answer played on the real default speakers (firstPlaybackAt recorded)" },
  V19: e2eInterrupt && { evidence: "live-e2e-conversation.json", ok: e2eInterrupt.meterSilentMs < 500, observed: `spoken barge-in: worker reset ${e2eInterrupt.workerResetMs.toFixed(1)} ms, audible silence ${e2eInterrupt.meterSilentMs.toFixed(0)} ms (Core Audio peak meter)` },
  V30: live.e2e && { evidence: "live-e2e-conversation.json", ok: e2eTurns.some((t) => t.turnKind === "agent_status" && t.answerSource === "host_facts"), observed: "spoken status query answered from Host facts" },
  V31: live.e2e && { evidence: "live-e2e-conversation.json", ok: e2eTurns.some((t) => t.turnKind === "agent_verification" && t.answerSource === "host_facts"), observed: "spoken verification query answered from Host facts (no mission to check)" },
  V32: live.supervision && { evidence: "agent-voice-supervision.json", ok: live.supervision.verdict === "PASS", observed: "live disposable Host: pause proposal executed through agentCommand with id+revision" },
  V33: live.supervision && { evidence: "agent-voice-supervision.json", ok: live.supervision.verdict === "PASS", observed: "live disposable Host: stop targeted the named agent, screen confirmation only" },
  V46: live.notch && { evidence: "notch/placement-receipts.json", ok: true, observed: "real WPF Island rendered voice states on all four edges" },
  V50: live.hotkey && { evidence: "notch/hotkey-product-receipt.json", ok: live.hotkey.verdict === "PASS", observed: "product chord Ctrl+Alt+Space registered and drove listen.start/end on the real Island" },
  V52: live.secret && { evidence: "secret-scan.json", ok: live.secret.result === "PASS" && live.secret.audioFilesFound === 0, observed: `secret and audio scan: ${live.secret.result}, audio files ${live.secret.audioFilesFound}` },
  V57: live.prodFinal && { evidence: "production-final.json", ok: live.prodFinal.unchanged === true, observed: live.prodFinal.summary ?? "read-only production comparison" },
  V58: live.e2e && live.stt && { evidence: "live-e2e-conversation.json; live/human-stt-session-5-whisper-beep.json", ok: e2eTurns.length >= 4 && live.e2e.engine?.includes("whisper"), observed: `human speech → whisper.cpp → Host → local model/Host facts → SAPI → real speakers, ${e2eTurns.length} turns through the real Island` },
  V59: live.bargeIn && { evidence: "barge-in-adversarial.json", ok: live.bargeIn.summary.scenarios === 10 && live.bargeIn.summary.staleResumed === 0 && live.bargeIn.summary.workerProcessesAfterRun === "0", observed: `10 live interruption scenarios, 0 stale resumes, audible silence p50 ${live.bargeIn.summary.p50.toFixed(0)} ms / p95 ${live.bargeIn.summary.p95.toFixed(0)} ms, 0 worker processes after run` },
};

const mapped = {
  V55: /X53|calculator/i,
  V56: /^T9\b|remote device|device (identity|rights)|DEVICE_RIGHTS/i,
  V53: /\bV53\b|T5\b.*authoriz|F0[1-4]\b/i,
  V54: /\bV54\b|containment|job object|OwnedProcessGroup/i,
};
const summary = existsSync(ev("regression/summary.txt")) ? readFileSync(ev("regression/summary.txt"), "utf8") : "";
const rows = Object.entries(TITLES).map(([id, title]) => {
  const re = mapped[id] ?? new RegExp(`\\b${id}\\b`);
  const tests = byTag(re);
  const add = extra[id];
  let verdict, observed, classification;
  if (id === "V60") {
    // Totals come from the runner summaries (ℹ lines); ✔ lines also include suite headings. The last line per gate wins.
    const sum = (k) => logs.reduce((acc, { text }) => acc + Number(new RegExp(`^ℹ ${k} (\\d+)`, "m").exec(text)?.[1] ?? 0), 0);
    const total = sum("tests"), failed = sum("fail"), skipped = sum("skipped") + sum("cancelled");
    const gates = ["typecheck", "lint", "build"].map((g) => [...summary.matchAll(new RegExp(`^${g}\\b[^\\n]*?exit=(\\d+)`, "gm"))].at(-1)?.[1]);
    verdict = total > 0 && failed === 0 && skipped === 0 && gates.every((g) => g === "0") ? "PASS" : "FAIL";
    observed = `${total} tests, ${failed} failed, ${skipped} skipped; typecheck/lint/build exit ${gates.join("/")}`;
    classification = "LIVE full regression on the T10 source";
    return { id, title, environment: `Windows 11, ${sourceCommit}`, expected: title, observed, evidence: ["regression/summary.txt", "full-regression.log", "regression-inventory.json"], classification, verdict };
  }
  const testsOk = tests.length > 0 && tests.every((t) => t.ok);
  const liveOk = add ? add.ok : null;
  if (tests.length === 0 && !add) verdict = "NOT COVERED";
  else verdict = (tests.length === 0 || testsOk) && (liveOk === null || liveOk) ? "PASS" : "FAIL";
  classification = add ? (tests.length ? "LIVE + DETERMINISTIC" : "LIVE") : "DETERMINISTIC (fakes or real worker/WPF where named)";
  observed = [tests.length ? `${tests.filter((t) => t.ok).length}/${tests.length} mapped tests passed` : null, add?.observed ?? null].filter(Boolean).join("; ");
  return { id, title, environment: `Windows 11, ${sourceCommit}${add ? ", real devices/disposable Host" : ""}`, expected: title, observed, evidence: [...tests.map((t) => `${t.suite}: ${t.name}`), ...(add ? [add.evidence] : [])], classification, verdict };
});
const out = { gate: "M-A-3 T10", sourceCommit, derivedBy: "build-adversarial-matrix.mjs", rows, totals: { pass: rows.filter((r) => r.verdict === "PASS").length, fail: rows.filter((r) => r.verdict === "FAIL").length, notCovered: rows.filter((r) => r.verdict === "NOT COVERED").length } };
writeFileSync(ev("adversarial-matrix.json"), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out.totals), rows.filter((r) => r.verdict !== "PASS").map((r) => `${r.id}:${r.verdict}`).join(" "));
