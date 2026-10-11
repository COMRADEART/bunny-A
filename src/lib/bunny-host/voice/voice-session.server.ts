/**
 * M-A-3 T10: the Host voice session. The only voice state authority.
 *
 * It owns one worker at most (VOICE_LIMITS.maxSessions), a generation counter for barge-in, and the VoiceSnapshot the
 * clients render. Every capture, recognition and playback fact comes from worker events; a worker event whose
 * generation or turn is stale is dropped and counted. Speech never authorizes anything: a spoken control becomes a
 * proposal that expires, and only the canonical agent command path runs it.
 */
import { randomUUID } from "node:crypto";
import { VoiceWorkerError, type VoiceWorkerPort } from "./voice-worker.server.ts";
import {
  VOICE_LIMITS,
  VOICE_PROTOCOL,
  type VoiceErrorCode,
  type VoiceInterruptReceipt,
  type VoiceMode,
  type VoiceProposal,
  type VoiceSnapshot,
  type VoiceState,
  type VoiceTiming,
  type VoiceTurnKind,
  type WorkerCommand,
  type WorkerEvent,
} from "./voice-protocol.ts";
import { canTransition, createFsm, hasSpeechInFlight, tryTransition, type VoiceFsm } from "./voice-fsm.ts";
import { VoiceChunker, chunkAnswer, type SpokenChunk } from "./voice-chunker.ts";
import { classifyTranscript, controlAction, type VoiceIntent } from "./voice-intent.ts";
import { answerApprovals, answerLastMission, answerModel, answerStatus, answerVerification, isTerminalAgent, type AgentFact, type ApprovalFact, type MissionFact } from "./voice-answers.server.ts";

export type ListenSource = "button" | "hotkey" | "push_to_talk" | "hands_free";
export type InterruptSource = VoiceInterruptReceipt["source"];
type AnswerSource = "model" | "host_facts" | "refusal";

/**
 * Defense in depth (round 2): the spoken-chat model is tool-free and cannot act. It is told so, so it never claims that an
 * approval, a command, a settings change or an agent control was done. The Host decides and acts, on its own screen.
 */
export const SPOKEN_CHAT_INSTRUCTION = [
  "You are Bunny, a voice assistant. Answer in one to three short spoken sentences without markdown.",
  "You cannot take any action. You cannot approve or deny anything, grant permissions, run commands, change settings, or pause, resume, stop or control agents or missions.",
  "Never say that you did any of those things, and never say that something was approved, cancelled, run, changed or stopped.",
  "If the user asks for one of those things, tell them it is done on the Windows Host screen.",
].join(" ");

export const REFUSAL_TEXT = "I can't do that by voice. Approvals, permissions and commands are reviewed on the Windows Host screen.";
export const REDIRECT_TEXT = "Redirecting a running agent isn't supported in this version. You can stop it and start a new Mission in the Agentic workspace.";
export const TOOLS_TEXT = "That question needs tools or a hosted model, so it is waiting for approval on the Windows Host screen.";

export type VoiceAgentRow = { id: string; name: string; state: string; revision: number };
export type VoiceChatTask = { taskId: string; provider: string; model: string | null; state: string; hasMission: boolean; mayLaunch: boolean };
export type VoiceTaskEvent = { text: string } | { done: true; state: string };

/** Ports the session needs. Production wiring is in http.server.ts; tests pass fakes. */
export interface VoiceChatPort {
  /** `prompt` is the bounded spoken-assistant instruction; `routingPrompt` is the bare transcript the router sees. */
  submit(prompt: string, routingPrompt: string): VoiceChatTask;
  /** Admits a task that the voice predicate allowed (manager.approveVoiceTurn). Throws when refused. */
  admit(taskId: string): void;
  onOutput(taskId: string, listener: (event: VoiceTaskEvent) => void): () => void;
  stop(taskId: string): Promise<void> | void;
  /** The task's final output text, when the router recorded one (non-streaming providers). Optional. */
  output?(taskId: string): string | null;
}
export interface VoiceAgentPort {
  rows(): VoiceAgentRow[];
  facts(): { agents: AgentFact[]; missions: MissionFact[]; approvals: ApprovalFact[] };
  /** Runs the canonical agent command (agentCommand with the workstation actor). Throws on refusal. */
  command(action: "agent.pause" | "agent.resume" | "agent.stop", id: string, revision: number): Promise<void>;
}

export type VoiceSessionDeps = {
  hostEpoch: string;
  dataDirectory: string;
  platform?: NodeJS.Platform;
  launch: (options: { dataDirectory: string; extraArgs?: string[] }) => Promise<VoiceWorkerPort>;
  /** Test-only worker flags. Never set from HTTP. */
  workerExtraArgs?: string[];
  /** Test-only stdin budgets (bytes). Production uses the defaults below; never set from HTTP. */
  workerStdinSoftBudget?: number;
  workerStdinHardBudget?: number;
  chat: VoiceChatPort;
  agents: VoiceAgentPort;
  /** Journal: a type and a coarse detail. Never transcripts, answers, audio or device secrets (V52). */
  journal: (type: string, detail: string) => void;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
};

type Candidate = { id: string; name: string; revision: number };
type Clarification = { action: VoiceProposal["action"]; candidates: Candidate[]; expiresAt: number };
type Inference = { taskId: string; turn: string; gen: number; chunker: VoiceChunker; spoken: string[]; done: boolean; received: boolean };

const HANDS_FREE_RESTART_MS = 400;
/** races#6: recent turn ids kept for the first-final-wins guard. Older turns can no longer reach onFinal (the turn gate drops them). */
const MAX_FINALIZED_TURNS = 64;
/** H3: how long open waits for the worker's first `devices` report before answering anyway. */
const DEVICE_SNAPSHOT_WAIT_MS = 1_500;
/**
 * H5: the F04 interactive budget is 512 KiB cumulative stdin per job group. A worker is relaunched at idle above the soft
 * budget; a turn that would cross the hard budget is ended with an error instead of failing silently.
 */
const WORKER_STDIN_HARD_BUDGET = 512 * 1024;
const defaultSchedule = (fn: () => void, ms: number) => {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
  return () => clearTimeout(timer);
};

export class VoiceSessionManager {
  private fsm: VoiceFsm = createFsm("IDLE");
  private worker: VoiceWorkerPort | null = null;
  private opening: Promise<VoiceSnapshot> | null = null;
  private readyResolve: ((ok: boolean) => void) | null = null;
  private devicesResolve: (() => void) | null = null;
  private relaunching: Promise<void> | null = null;
  /** containment#0: a worker whose job group is being settled after an exit; a new open waits for it. */
  private settling: Promise<void> | null = null;
  /** Bumped on every open and close: asynchronous control work from an earlier session never speaks into a later one (races#3). */
  private sessionEpoch = 0;
  private closing = false;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => () => void;
  private readonly softBudget: number;
  private readonly hardBudget: number;
  private readonly finalized = new Set<string>();
  private readonly history: { user: string; assistant: string }[] = [];
  private cancelIdle: (() => void) | null = null;
  private cancelRearm: (() => void) | null = null;
  private cancelInferenceTimer: (() => void) | null = null;
  private cancelTaskOutput: (() => void) | null = null;
  private inference: Inference | null = null;
  private outstanding = 0;
  private clarification: Clarification | null = null;
  private uiSeq = 0;
  private turnSeq = 0;
  /** Worker events and task deltas dropped as stale (generation, turn or epoch), counted into receipts. */
  private lateEventsDropped = 0;
  private snap: VoiceSnapshot;

  private readonly deps: VoiceSessionDeps;

  constructor(deps: VoiceSessionDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
    this.schedule = deps.schedule ?? defaultSchedule;
    this.softBudget = deps.workerStdinSoftBudget ?? VOICE_LIMITS.workerStdinSoftBudget;
    this.hardBudget = deps.workerStdinHardBudget ?? WORKER_STDIN_HARD_BUDGET;
    this.snap = {
      protocol: VOICE_PROTOCOL,
      open: false,
      sessionId: null,
      hostEpoch: null,
      principal: null,
      mode: "push_to_talk",
      state: "IDLE",
      capturing: false,
      playing: false,
      muted: false,
      level: null,
      turnId: null,
      generation: 0,
      partial: null,
      finalTranscript: null,
      turnKind: null,
      answer: null,
      answerSource: null,
      route: null,
      proposal: null,
      clarification: null,
      uiIntent: null,
      devices: { input: null, output: null, micPrivacy: "unknown" },
      engines: { stt: null, tts: null, local: true },
      error: null,
      lastInterrupt: null,
      timing: null,
      createdAt: null,
      updatedAt: this.now(),
    };
  }

  /** The VoiceSnapshot clients render. A copy: callers cannot mutate session state. */
  snapshot(): VoiceSnapshot {
    return structuredClone(this.snap);
  }

  /** Diagnostics for tests and the journal: how many stale events were dropped. */
  get staleEventsDropped(): number {
    return this.lateEventsDropped;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Session lifecycle
  // -------------------------------------------------------------------------------------------------------------

  async open(mode: VoiceMode = "push_to_talk"): Promise<VoiceSnapshot> {
    if (this.opening) await this.opening.catch(() => undefined);
    // containment#0: no second worker starts while the previous job group is still being settled.
    if (this.settling) await this.settling;
    if (this.snap.open) {
      // H4: an open with a different mode switches in place: same session id, same worker.
      if (mode !== this.snap.mode) this.switchMode(mode);
      return this.snapshot();
    }
    this.opening = this.doOpen(mode).finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  /** H4: changes the mode of the open session without relaunching the worker. */
  private switchMode(mode: VoiceMode) {
    this.snap.mode = mode;
    if (mode === "push_to_talk") {
      this.clearIdle();
      this.cancelRearmTimer();
    }
    this.deps.journal("voice.session_opened", `Voice mode switched to ${mode}.`);
    this.touch();
  }

  private async doOpen(mode: VoiceMode): Promise<VoiceSnapshot> {
    if ((this.deps.platform ?? process.platform) !== "win32") {
      this.setError("NOT_WINDOWS", "Voice requires the Windows Host; nothing was opened.");
      return this.snapshot();
    }
    const worker = await this.startWorker();
    if (!worker) return this.snapshot();
    this.sessionEpoch += 1;
    this.snap = {
      ...this.snap,
      open: true,
      sessionId: randomUUID(),
      hostEpoch: this.deps.hostEpoch,
      principal: "workstation",
      mode,
      error: null,
      createdAt: this.now(),
    };
    // H3: the snapshot must carry real device states, so the answer waits (bounded) for the worker's devices report.
    const devices = this.awaitDevices();
    this.tryWorker({ op: "devices" });
    await devices;
    this.deps.journal("voice.session_opened", `Voice session opened in ${mode} mode.`);
    this.touch();
    return this.snapshot();
  }

  /** Launches one contained worker, wires its events, and waits for `ready`. Returns null with the error set on failure. */
  private async startWorker(): Promise<VoiceWorkerPort | null> {
    let worker: VoiceWorkerPort;
    try {
      worker = await this.deps.launch({ dataDirectory: this.deps.dataDirectory, extraArgs: this.deps.workerExtraArgs });
    } catch (error) {
      const code = error instanceof VoiceWorkerError && error.code !== "INTERNAL" ? error.code : "INTERNAL";
      this.setError(code, error instanceof Error ? error.message : "Voice worker failed to start.");
      return null;
    }
    this.worker = worker;
    // Events are accepted only from the worker that is current: a relaunched-away worker can never write into the session.
    worker.onEvent((event) => {
      if (this.worker === worker) this.onWorkerEvent(event);
    });
    worker.exited.then((code) => this.onWorkerExit(worker, code)).catch(() => this.deps.journal("voice.error", "Voice worker exit could not be settled."));
    const ready = new Promise<boolean>((resolve) => {
      const cancel = this.schedule(() => resolve(false), VOICE_LIMITS.workerReadyTimeoutMs);
      this.readyResolve = (ok) => {
        cancel();
        resolve(ok);
      };
    });
    if (!(await ready)) {
      this.readyResolve = null;
      // races#4: a worker that close() already took down is settled by close(); only a current timeout reports TIMEOUT.
      if (this.worker !== worker) return null;
      this.worker = null;
      await worker.close();
      this.setError("TIMEOUT", "Voice worker did not become ready in time.");
      return null;
    }
    return worker;
  }

  private awaitDevices(): Promise<void> {
    return new Promise<void>((resolve) => {
      const cancel = this.schedule(() => {
        this.devicesResolve = null;
        resolve();
      }, DEVICE_SNAPSHOT_WAIT_MS);
      this.devicesResolve = () => {
        cancel();
        resolve();
      };
    });
  }

  /** Asks the worker to report its devices again (cheap; the answer arrives as a `devices` event). */
  refreshDevices(): VoiceSnapshot {
    this.tryWorker({ op: "devices" });
    return this.snapshot();
  }

  /** Closes the session: abort capture, cancel speech, stop the voice turn's own inference, shut the worker down. */
  async close(): Promise<VoiceSnapshot> {
    if (this.relaunching) await this.relaunching;
    if (this.settling) await this.settling;
    if (!this.worker && !this.snap.open) return this.snapshot();
    this.closing = true;
    this.clearTimers();
    // races#4: a worker still waiting for `ready` is abandoned now: its ready timer is cancelled, and its open attempt
    // sees that the worker is no longer current, so no TIMEOUT is written into the closed session.
    const pendingReady = this.readyResolve;
    this.readyResolve = null;
    pendingReady?.(false);
    const wasSpeaking = this.snap.playing || hasSpeechInFlight(this.fsm.state);
    const turn = this.snap.turnId ?? "none";
    const gen = this.snap.generation;
    // races#3: capture and speech are cut first, before anything is awaited, so queued chunks stop at once. The worker
    // handle is then dropped, so no event or command reaches the closing session.
    if (this.snap.capturing || this.fsm.state === "ARMING" || this.fsm.state === "LISTENING") this.tryWorker({ op: "capture.abort", gen });
    if (wasSpeaking) this.tryWorker({ op: "speak.cancel", gen });
    const worker = this.worker;
    this.worker = null;
    // Only then the voice turn's own inference is stopped (its timer and output listener are released synchronously).
    const inferenceStopped = this.inference ? await this.stopInference() : null;
    if (wasSpeaking) this.recordInterrupt("session_close", inferenceStopped, true, turn, gen);
    if (worker) await worker.close();
    this.resetAfterClose();
    this.closing = false;
    this.deps.journal("voice.session_closed", "Voice session closed; microphone and speaker released.");
    return this.snapshot();
  }

  private resetAfterClose() {
    this.sessionEpoch += 1;
    // races#5: no re-arm or idle timer from the closed session may fire into a later open.
    this.cancelRearmTimer();
    this.clearIdle();
    this.fsm = createFsm("IDLE");
    this.finalized.clear();
    this.clarification = null;
    this.outstanding = 0;
    // races#3: a stale inference releases its output listener and timer, not only its reference.
    const stale = this.inference;
    if (stale) this.releaseInference(stale);
    this.snap = {
      ...this.snap,
      open: false,
      sessionId: null,
      hostEpoch: null,
      principal: null,
      state: "IDLE",
      capturing: false,
      playing: false,
      level: null,
      turnId: null,
      partial: null,
      finalTranscript: null,
      turnKind: null,
      proposal: null,
      clarification: null,
      devices: { input: null, output: null, micPrivacy: "unknown" },
      error: null,
      timing: null,
      createdAt: null,
      updatedAt: this.now(),
    };
  }

  // -------------------------------------------------------------------------------------------------------------
  // Turn controls
  // -------------------------------------------------------------------------------------------------------------

  /** Starts one capture turn. Barge-in when speech is in flight: the generation advances and old speech is cancelled. */
  async listenStart(source: ListenSource = "button"): Promise<VoiceSnapshot> {
    // races#3: a session that is closing takes no new turn.
    if (this.closing) return this.refuse("INTERNAL", "Voice is closing.");
    // H5: an in-flight or due relaunch completes before the turn is judged (the worker handle is absent while it runs).
    if (this.relaunching || this.needsRelaunch()) await this.relaunchIfIdle();
    if (!this.snap.open || !this.worker) return this.refuse("INTERNAL", "Voice is not open.");
    if (this.snap.muted) return this.refuse("MUTED", "Microphone is muted; capture was not started.");
    if (this.fsm.state === "TRANSCRIBING") return this.refuse("DEVICE_BUSY", "The previous turn is still being transcribed.");
    if (hasSpeechInFlight(this.fsm.state) || this.snap.playing) this.bargeIn(source === "push_to_talk" ? "push_to_talk" : "button");
    if (this.snap.capturing || this.fsm.state === "LISTENING" || this.fsm.state === "ARMING") this.tryWorker({ op: "capture.abort", gen: this.snap.generation });
    this.cancelRearmTimer();
    this.clearIdle();
    const turn = this.newTurn();
    this.snap.timing = emptyTiming(turn, this.now());
    this.snap.partial = null;
    this.snap.finalTranscript = null;
    this.snap.turnKind = null;
    this.snap.answer = null;
    this.snap.answerSource = null;
    this.snap.route = null;
    this.snap.level = null;
    this.snap.error = null;
    this.setState("ARMING");
    this.tryWorker({
      op: "capture.start",
      turn,
      gen: this.snap.generation,
      device: -1,
      endpointing: source === "push_to_talk" ? "manual" : "vad",
      maxMs: VOICE_LIMITS.maxTurnCaptureMs,
    });
    if (this.snap.mode === "hands_free" || source === "hands_free") this.armIdle(turn);
    this.touch();
    return this.snapshot();
  }

  /** Push-to-talk release, or an explicit end of capture. */
  listenEnd(turnId?: string): VoiceSnapshot {
    // A late or duplicated release bound to an older turn never ends a newer capture (push-to-talk races).
    if (turnId && turnId !== this.snap.turnId) {
      this.lateEventsDropped += 1;
      return this.snapshot();
    }
    if (this.fsm.state === "LISTENING" && this.snap.turnId) {
      this.tryWorker({ op: "capture.end", turn: this.snap.turnId, gen: this.snap.generation });
      this.setState("TRANSCRIBING");
    } else if (this.fsm.state === "ARMING") {
      this.tryWorker({ op: "capture.abort", gen: this.snap.generation });
      this.setState("IDLE");
    }
    this.clearIdle();
    this.touch();
    return this.snapshot();
  }

  /** Interrupts speech, and capture if open. Never touches agents or missions (V29). */
  interrupt(source: InterruptSource = "button"): VoiceSnapshot {
    this.clearIdle();
    if (hasSpeechInFlight(this.fsm.state) || this.snap.playing) {
      this.bargeIn(source);
      this.settleIdle(false);
    } else if (this.snap.capturing || this.fsm.state === "LISTENING" || this.fsm.state === "ARMING") {
      this.tryWorker({ op: "capture.abort", gen: this.snap.generation });
      this.recordInterrupt(source, null, false, this.snap.turnId ?? "none", this.snap.generation);
      this.snap.capturing = false;
      this.snap.level = null;
      this.settleIdle(false);
    } else {
      this.recordInterrupt(source, null, false, this.snap.turnId ?? "none", this.snap.generation);
    }
    this.touch();
    return this.snapshot();
  }

  mute(on: boolean): VoiceSnapshot {
    this.snap.muted = on;
    if (on) {
      this.clearIdle();
      this.cancelRearmTimer();
      if (this.snap.capturing || this.fsm.state === "ARMING" || this.fsm.state === "LISTENING") this.tryWorker({ op: "capture.abort", gen: this.snap.generation });
      if (hasSpeechInFlight(this.fsm.state) || this.snap.playing) this.bargeIn("mute");
      this.snap.capturing = false;
      this.snap.level = null;
    }
    this.tryWorker({ op: "mute", on });
    this.settleIdle(false);
    this.touch();
    return this.snapshot();
  }

  /** Typed fallback for an unavailable recognizer. Enters the same final-turn path, flagged typed. */
  async text(text: string): Promise<VoiceSnapshot> {
    if (this.closing) return this.refuse("INTERNAL", "Voice is closing.");
    if (!this.snap.open) return this.refuse("INTERNAL", "Voice is not open.");
    const trimmed = text.trim();
    if (!trimmed) return this.snapshot();
    if (trimmed.length > VOICE_LIMITS.maxTranscriptChars) return this.refuse("BUFFER_LIMIT", "That text is too long for one voice turn.");
    if (this.snap.muted) return this.refuse("MUTED", "Microphone is muted; the text was not sent.");
    if (this.relaunching || this.needsRelaunch()) await this.relaunchIfIdle();
    if (!this.worker || !this.snap.open) return this.refuse("INTERNAL", "Voice is not open.");
    if (hasSpeechInFlight(this.fsm.state) || this.snap.playing) this.bargeIn("button");
    if (this.snap.capturing || this.fsm.state === "LISTENING" || this.fsm.state === "ARMING") this.tryWorker({ op: "capture.abort", gen: this.snap.generation });
    this.cancelRearmTimer();
    this.clearIdle();
    const turn = this.newTurn("typed");
    this.snap.timing = emptyTiming(turn, this.now());
    this.snap.partial = null;
    this.snap.error = null;
    this.rememberFinal(turn);
    this.settleForTypedTurn();
    this.acceptFinal(trimmed, turn);
    this.touch();
    return this.snapshot();
  }

  /**
   * races#0: a typed turn enters the final-turn path from a legal state. An open capture ends through TRANSCRIBING, and any
   * state that cannot reach PROCESSING (ARMING, LISTENING's siblings, ERROR, DEVICE_UNAVAILABLE, INTERRUPTED, MUTED) settles
   * to IDLE first. Capture truth is cleared here, so the old turn's capture events cannot leave it set.
   */
  private settleForTypedTurn() {
    if (this.fsm.state === "LISTENING") this.setState("TRANSCRIBING");
    if (this.fsm.state !== "PROCESSING" && !canTransition(this.fsm.state, "PROCESSING")) this.setState("IDLE");
    this.snap.capturing = false;
    this.snap.level = null;
  }

  /** Keeps the first-final-wins guard bounded (races#6). */
  private rememberFinal(turn: string) {
    this.finalized.add(turn);
    while (this.finalized.size > MAX_FINALIZED_TURNS) {
      const oldest = this.finalized.values().next().value;
      if (oldest === undefined) break;
      this.finalized.delete(oldest);
    }
  }

  /** On-screen confirmation: executes either a voice_or_screen or a screen-only proposal (V32, V33). */
  controlConfirm(proposalId: string): VoiceSnapshot {
    if (this.closing) return this.refuseControl("Voice is closing; nothing was changed.");
    const proposal = this.snap.proposal;
    if (!proposal || proposal.id !== proposalId) return this.refuseControl("Nothing matching that confirmation is waiting.");
    // truth#4: a control confirmation starts a new turn; the previous turn's route no longer describes this answer.
    this.snap.route = null;
    this.executeProposal(proposal, "screen");
    this.touch();
    return this.snapshot();
  }

  controlCancel(): VoiceSnapshot {
    // races#3: nothing is spoken or changed by a control while the session is closing.
    if (this.closing) return this.snapshot();
    if (this.snap.proposal || this.snap.clarification) {
      // truth#4: "Cancelled." is a host fact with no model route, even when a model answer came after the proposal.
      this.snap.route = null;
      this.snap.proposal = null;
      this.clarification = null;
      this.snap.clarification = null;
      this.deps.journal("voice.control_refused", "Pending voice control cancelled by the user.");
      this.speakAnswer("Cancelled.", "host_facts", this.newTurn("ctl"));
    }
    this.touch();
    return this.snapshot();
  }

  // -------------------------------------------------------------------------------------------------------------
  // Final turn routing
  // -------------------------------------------------------------------------------------------------------------

  /** Accepts one final transcript for a turn. Callers gate duplicates (V09, V10) before this point. */
  private acceptFinal(text: string, turn: string, confidence = 1) {
    this.expireProposal();
    this.snap.finalTranscript = text;
    this.snap.partial = null;
    // truth#4: every final turn starts without a route; only a model answer sets one (chat).
    this.snap.route = null;
    this.snap.timing = this.snap.timing ? { ...this.snap.timing, finalAt: this.now() } : null;
    this.setState("PROCESSING");
    // Speech is untrusted input: a barely-heard final is never routed, and never controls an agent.
    if (confidence < VOICE_LIMITS.minFinalConfidence) {
      this.snap.turnKind = "empty";
      this.deps.journal("voice.turn", "Turn not routed: recognizer confidence too low.");
      this.speakAnswer("Sorry, I didn't catch that clearly. Please say it again.", "host_facts", turn);
      return;
    }
    if (confidence < VOICE_LIMITS.minControlConfidence && this.clarification) {
      this.snap.turnKind = "empty";
      this.deps.journal("voice.turn", "Clarification not resolved: recognizer confidence too low.");
      this.speakAnswer("I'm not sure I heard which one. Please say it again, or use the screen.", "host_facts", turn);
      return;
    }
    // authz#0: the SENSITIVE classification runs before a pending clarification may consume the final. A clarification
    // answer is then taken only for an exact candidate name or a bare ordinal (see pickCandidate).
    const intent = classifyTranscript(text, { proposalPending: this.voiceConfirmable() });
    if (intent.kind === "sensitive_refused") this.clearClarification();
    else if (this.resolveClarification(text, turn)) return;
    if ((intent.kind === "agent_control" || intent.kind === "confirm") && confidence < VOICE_LIMITS.minControlConfidence) {
      this.snap.turnKind = intent.kind;
      this.deps.journal("voice.turn", `Turn classified as ${intent.kind} but not acted on: recognizer confidence too low.`);
      this.speakAnswer("I'm not sure I heard that right, so I won't change anything. Please say it again, or use the button on screen.", "host_facts", turn);
      return;
    }
    this.snap.turnKind = intent.kind;
    this.deps.journal("voice.turn", `Turn classified as ${intent.kind}.`);
    this.detach("turn", () => this.dispatch(intent, turn, text));
  }

  private clearClarification() {
    this.clarification = null;
    this.snap.clarification = null;
  }

  /**
   * races#7: a fire-and-forget voice promise. A throw is journaled and the turn settles to IDLE, so it never becomes an
   * unhandled rejection that the Host's fatal path would take as a whole-process failure.
   */
  private detach(label: string, work: () => Promise<unknown>): void {
    void work().catch(() => {
      this.deps.journal("voice.error", `Voice ${label} failed; nothing was changed.`);
      try {
        this.settleIdle(false);
      } catch {
        /* already journaled; the next user action recovers the session */
      }
    });
  }

  /** Stt final from the worker. Only the first final for a turn counts (V09, V10). */
  private onFinal(turn: string, text: string, confidence: number) {
    // races#3: a final that arrives while the session closes never starts a turn.
    if (this.closing || this.finalized.has(turn)) {
      this.lateEventsDropped += 1;
      return;
    }
    this.rememberFinal(turn);
    if (this.fsm.state === "LISTENING") this.setState("TRANSCRIBING");
    const trimmed = text.trim().slice(0, VOICE_LIMITS.maxTranscriptChars);
    if (!trimmed) {
      this.onNone("no_speech");
      return;
    }
    this.acceptFinal(trimmed, turn, Number.isFinite(confidence) ? confidence : 0);
  }

  /** A pending clarification consumes the next final: a name or ordinal picks the agent (V34). */
  private resolveClarification(text: string, turn: string): boolean {
    const clarification = this.clarification;
    if (!clarification) return false;
    this.clearClarification();
    if (clarification.expiresAt <= this.now()) return false;
    const choice = pickCandidate(text, clarification.candidates);
    if (!choice) return false;
    this.proposeAgentControl(clarification.action, choice);
    this.speakAnswer(this.proposalSentence(this.snap.proposal!), "host_facts", turn);
    return true;
  }

  /** A proposal past its TTL is dropped on the next turn, so a late "yes" can never act on it. */
  private expireProposal() {
    const p = this.snap.proposal;
    if (p && p.expiresAt <= this.now()) {
      this.snap.proposal = null;
      this.deps.journal("voice.control_refused", "Proposal expired before confirmation.");
    }
  }

  private voiceConfirmable(): boolean {
    const p = this.snap.proposal;
    return !!p && p.confirmVia === "voice_or_screen" && p.expiresAt > this.now() && p.hostEpoch === this.deps.hostEpoch;
  }

  private async dispatch(intent: VoiceIntent, turn: string, transcript: string) {
    switch (intent.kind) {
      case "empty":
        this.settleIdle();
        return;
      case "sensitive_refused":
        if (this.deps.agents.facts().approvals.length > 0) this.setUi("open_approvals", null);
        this.speakAnswer(REFUSAL_TEXT, "refusal", turn);
        return;
      case "redirect_unsupported":
        this.speakAnswer(REDIRECT_TEXT, "refusal", turn);
        return;
      case "cancel": {
        // authz#2: "Okay, cancelled." is spoken only when something was pending; a bare cancel with nothing pending says so.
        const pending = !!this.snap.proposal || !!this.snap.clarification;
        this.snap.proposal = null;
        this.clarification = null;
        this.snap.clarification = null;
        this.speakAnswer(pending ? "Okay, cancelled." : "Nothing is waiting to be cancelled.", "host_facts", turn);
        return;
      }
      case "confirm": {
        const proposal = this.snap.proposal;
        if (proposal && this.voiceConfirmable()) this.executeProposal(proposal, "voice", turn);
        else if (proposal) this.speakAnswer("That action needs the button on the Windows Host screen.", "host_facts", turn);
        else this.speakAnswer("Nothing is waiting for your confirmation.", "host_facts", turn);
        return;
      }
      case "open_ui":
        this.setUi("open_agentic", null);
        this.speakAnswer("Opening the agentic workspace on the Windows Host.", "host_facts", turn);
        return;
      case "agent_control":
        this.handleControl(intent, turn);
        return;
      case "agent_status":
      case "agent_verification":
      case "agent_model":
      case "agent_approvals":
      case "agent_last_mission":
        this.speakAnswer(this.hostAnswer(intent.kind), "host_facts", turn);
        return;
      case "chat":
        await this.chat(transcript, turn);
        return;
    }
  }

  private hostAnswer(kind: VoiceTurnKind): string {
    const facts = this.deps.agents.facts();
    const active = facts.agents.find((agent) => !isTerminalAgent(agent.state)) ?? null;
    const activeMission = facts.missions.find((item) => item.id === active?.missionId) ?? null;
    const finished = facts.missions
      .filter((item) => ["completed", "failed", "stopped"].includes(item.status))
      .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
    switch (kind) {
      case "agent_status":
        return answerStatus(facts.agents, facts.missions);
      case "agent_verification":
        return answerVerification(activeMission ?? finished);
      case "agent_model":
        return answerModel(activeMission ?? finished);
      case "agent_approvals":
        return answerApprovals(facts.approvals);
      default:
        return answerLastMission(finished);
    }
  }

  private handleControl(intent: VoiceIntent, turn: string) {
    const action = controlAction(intent.normalized);
    if (!action) return this.speakAnswer("I didn't understand which control you meant.", "refusal", turn);
    const active = this.deps.agents.rows().filter((row) => !isTerminalAgent(row.state));
    if (active.length === 0) return this.speakAnswer("No agent is running right now.", "host_facts", turn);
    // authz#3: a spoken name is honored. The ordinal picks by position only when no name matches; when the name and the
    // position point at different agents, the speaker is asked which one (never silently the position).
    const named = intent.target ? active.filter((row) => row.name.toLowerCase() === intent.target.toLowerCase()) : [];
    const byPosition = intent.ordinal !== null ? active[intent.ordinal - 1] : undefined;
    if (intent.ordinal !== null && !byPosition) return this.speakAnswer("There is no agent with that number.", "host_facts", turn);
    let candidates: Candidate[] = active;
    if (intent.target && named.length === 0) {
      if (!byPosition) return this.speakAnswer(`I can't find an agent named ${intent.target}.`, "host_facts", turn);
      candidates = [byPosition];
    } else if (named.length > 0) {
      candidates = byPosition ? uniqueById([...named, byPosition]) : named;
    } else if (byPosition) {
      candidates = [byPosition];
    }
    if (candidates.length > 1) {
      const expiresAt = this.now() + VOICE_LIMITS.clarificationTtlMs;
      const question = `Which agent should I ${action.slice(6)}?`;
      this.clarification = { action, candidates, expiresAt };
      this.snap.clarification = { question, candidates: candidates.map((row) => ({ id: row.id, name: row.name })), expiresAt };
      this.deps.journal("voice.control_proposed", `Clarification needed among ${candidates.length} agents.`);
      return this.speakAnswer(`${question} ${candidates.map((row) => row.name).join(", ")}.`, "host_facts", turn);
    }
    this.proposeAgentControl(action, candidates[0]);
    this.speakAnswer(this.proposalSentence(this.snap.proposal!), "host_facts", turn);
  }

  private proposeAgentControl(action: VoiceProposal["action"], row: Candidate) {
    const now = this.now();
    this.snap.proposal = {
      id: randomUUID(),
      action,
      agentId: row.id,
      agentName: row.name,
      revision: row.revision,
      confirmVia: action === "agent.pause" ? "voice_or_screen" : "screen",
      createdAt: now,
      expiresAt: now + VOICE_LIMITS.proposalTtlMs,
      hostEpoch: this.deps.hostEpoch,
    };
    this.deps.journal("voice.control_proposed", `Proposed ${action} (confirm via ${this.snap.proposal.confirmVia}).`);
  }

  private proposalSentence(p: VoiceProposal): string {
    const verb = p.action.slice(6);
    return p.confirmVia === "voice_or_screen"
      ? `Say confirm, or confirm on the Windows Host screen, to ${verb} ${p.agentName}.`
      : `Confirm on the Windows Host screen to ${verb} ${p.agentName}.`;
  }

  /**
   * Executes a proposal through the canonical agent command. A spoken confirm may execute only a voice_or_screen
   * proposal inside its TTL and epoch; the on-screen confirm may execute either (V32, V33, V36-V38 by construction).
   */
  private executeProposal(proposal: VoiceProposal, via: "voice" | "screen", turn?: string) {
    const speakTurn = turn ?? this.snap.turnId ?? this.newTurn("ctl");
    if (via === "voice" && proposal.confirmVia !== "voice_or_screen") {
      this.speakAnswer("That action needs the button on the Windows Host screen.", "host_facts", speakTurn);
      return;
    }
    this.snap.proposal = null;
    if (proposal.expiresAt <= this.now() || proposal.hostEpoch !== this.deps.hostEpoch) {
      this.deps.journal("voice.control_refused", "Proposal expired or from another Host epoch; not executed.");
      this.speakAnswer("That confirmation expired. Ask me again.", "host_facts", speakTurn);
      return;
    }
    const row = this.deps.agents.rows().find((item) => item.id === proposal.agentId);
    if (!row || row.revision !== proposal.revision || isTerminalAgent(row.state)) {
      this.deps.journal("voice.control_refused", "Agent changed since the proposal; not executed.");
      this.speakAnswer(`${proposal.agentName} changed while I was waiting. Ask me again to ${proposal.action.slice(6)} it.`, "host_facts", speakTurn);
      return;
    }
    this.deps.journal("voice.control_confirmed", `Confirmed ${proposal.action} via ${via}.`);
    this.detach("control", () => this.runControl(proposal, speakTurn));
  }

  /**
   * Runs the canonical agent command and acknowledges only what the canonical state shows (V32, V33).
   * The revision is checked in the same synchronous step as the command call (authz#3). The canonical pause and stop
   * branches do not take the revision, so this check is the only revision bind for them (residual, documented in the report).
   * The answer is spoken only when the same session and turn are still current (races#3).
   */
  private async runControl(proposal: VoiceProposal, turn: string) {
    const epoch = this.sessionEpoch;
    const current = () => epoch === this.sessionEpoch && this.snap.open && turn === this.snap.turnId;
    const before = this.deps.agents.rows().find((item) => item.id === proposal.agentId);
    if (!before || before.revision !== proposal.revision || isTerminalAgent(before.state)) {
      this.deps.journal("voice.control_refused", "Agent changed since the proposal; not executed.");
      if (current()) this.speakAnswer(`${proposal.agentName} changed while I was waiting. Ask me again to ${proposal.action.slice(6)} it.`, "host_facts", turn);
      return;
    }
    try {
      await this.deps.agents.command(proposal.action, proposal.agentId, proposal.revision);
    } catch {
      this.deps.journal("voice.error", `Agent command refused (${proposal.action}).`);
      if (current()) this.speakAnswer(`I couldn't ${proposal.action.slice(6)} ${proposal.agentName}. It was not changed.`, "host_facts", turn);
      return;
    }
    if (!current()) {
      this.deps.journal("voice.turn", `Result of ${proposal.action} not spoken: the voice session or turn changed first.`);
      return;
    }
    const row = this.deps.agents.rows().find((item) => item.id === proposal.agentId);
    const confirmed =
      !!row &&
      (proposal.action === "agent.pause"
        ? row.state === "PAUSED"
        : proposal.action === "agent.stop"
          ? row.state === "STOPPED"
          : row.state !== "PAUSED" && !isTerminalAgent(row.state));
    if (confirmed) {
      const done = proposal.action === "agent.pause" ? "paused" : proposal.action === "agent.resume" ? "resumed" : "stopped";
      this.speakAnswer(`${proposal.agentName} is ${done}.`, "host_facts", turn);
    } else {
      this.speakAnswer(`I asked for that, but ${proposal.agentName} shows ${row ? row.state.toLowerCase() : "no current state"}. I'm not sure it changed.`, "host_facts", turn);
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // Chat
  // -------------------------------------------------------------------------------------------------------------

  private async chat(transcript: string, turn: string) {
    // races#3: no model task is submitted or admitted once the session is closing.
    if (this.closing) {
      this.lateEventsDropped += 1;
      return;
    }
    const history = this.history
      .slice(-VOICE_LIMITS.maxHistoryTurns)
      .map((item) => `User: ${item.user}\nAssistant: ${item.assistant}`)
      .join("\n");
    const prompt = [
      SPOKEN_CHAT_INSTRUCTION,
      history,
      `User: ${transcript}`,
    ].filter(Boolean).join("\n\n");
    let task: VoiceChatTask;
    try {
      task = this.deps.chat.submit(prompt, transcript);
    } catch {
      this.speakAnswer("I couldn't start that answer.", "refusal", turn);
      return;
    }
    if (task.state !== "waiting_for_approval" || task.hasMission || !task.mayLaunch) {
      // Real tools, hosted models and anything not tool-free wait on the Windows Host screen; never auto-approved (V13, V14, V42).
      // truth#4: a refused task produced no answer, so it carries no route ("Answered by" would misattribute it).
      this.speakAnswer(TOOLS_TEXT, "refusal", turn);
      return;
    }
    try {
      this.deps.chat.admit(task.taskId);
    } catch {
      this.speakAnswer(TOOLS_TEXT, "refusal", turn);
      return;
    }
    // truth#4: the route is set only once the model answer is actually admitted and produced.
    this.snap.route = {
      taskId: task.taskId,
      provider: task.provider,
      model: task.model && task.model.trim() && !/^auto$/i.test(task.model.trim()) ? task.model : "UNKNOWN",
    };
    if (this.snap.timing) this.snap.timing = { ...this.snap.timing, admittedAt: this.now() };
    this.startInference(task.taskId, turn);
  }

  private startInference(taskId: string, turn: string) {
    const current: Inference = {
      taskId,
      turn,
      gen: this.snap.generation,
      chunker: new VoiceChunker({ now: this.now }),
      spoken: [],
      done: false,
      received: false,
    };
    this.inference = current;
    this.cancelTaskOutput = this.deps.chat.onOutput(taskId, (event) => {
      // Late model callbacks after a barge-in or close never restart playback (V21).
      if (this.inference !== current || current.turn !== this.snap.turnId || current.gen !== this.snap.generation) {
        this.lateEventsDropped += 1;
        return;
      }
      if ("text" in event) {
        current.received = true;
        for (const chunk of current.chunker.push(event.text)) this.sendChunk(current, chunk);
        if (this.snap.timing && this.snap.timing.firstTokenAt === null) this.snap.timing = { ...this.snap.timing, firstTokenAt: this.now() };
        this.touch();
        return;
      }
      this.finishInference(current, event.state);
    });
    this.cancelInferenceTimer = this.schedule(() => {
      this.cancelInferenceTimer = null;
      if (this.inference === current) {
        void this.stopInference();
        this.speakAnswer("That took too long, so I stopped it.", "refusal", turn);
      }
    }, VOICE_LIMITS.inferenceTimeoutMs);
  }

  private sendChunk(current: { turn: string; gen: number; spoken: string[] }, chunk: SpokenChunk) {
    this.outstanding += 1;
    current.spoken.push(chunk.text);
    this.tryWorker({ op: "speak", turn: current.turn, gen: current.gen, seq: chunk.seq, text: chunk.text, device: -1, voice: null });
  }

  private finishInference(current: Inference, state: string) {
    // H8: a non-streaming provider delivered no deltas but recorded a final output: speak it, bounded, through the chunker.
    if (!current.received && state === "completed") {
      const final = this.deps.chat.output?.(current.taskId)?.trim();
      if (final) for (const chunk of current.chunker.push(final)) this.sendChunk(current, chunk);
    }
    for (const chunk of current.chunker.end()) this.sendChunk(current, chunk);
    current.done = true;
    this.releaseInference(current);
    const answer = current.spoken.join(" ");
    if (answer) {
      this.history.push({ user: this.snap.finalTranscript ?? "", assistant: answer.slice(0, 600) });
      while (this.history.length > VOICE_LIMITS.maxHistoryTurns) this.history.shift();
      this.setAnswer(answer, "model");
    } else {
      this.setAnswer(state === "completed" ? "I didn't get an answer." : `That answer did not finish (${state}).`, "refusal");
    }
    // H2: the model text is complete now; the turn is complete only once playback has drained (or there is no TTS).
    if (this.snap.timing) {
      const now = this.now();
      this.snap.timing = { ...this.snap.timing, inferenceCompletedAt: now };
      if (this.outstanding === 0 || !this.worker) this.snap.timing = { ...this.snap.timing, completedAt: this.snap.timing.completedAt ?? now };
    }
    this.deps.journal("voice.turn", `Answer ${state}.`);
    if (this.outstanding === 0) this.settleIdle();
    this.touch();
  }

  private releaseInference(current: Inference) {
    if (this.inference === current) this.inference = null;
    this.cancelInferenceTimer?.();
    this.cancelInferenceTimer = null;
    this.cancelTaskOutput?.();
    this.cancelTaskOutput = null;
  }

  /** Stops only the voice turn's own inference task (never another agent's task). */
  private async stopInference(): Promise<boolean | null> {
    const current = this.inference;
    if (!current) return null;
    this.releaseInference(current);
    try {
      await this.deps.chat.stop(current.taskId);
      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // Speech
  // -------------------------------------------------------------------------------------------------------------

  /** Speaks a host-authored answer in chunks, exactly as a model answer is spoken. */
  private speakAnswer(text: string, source: AnswerSource, turn: string) {
    if (!text) {
      this.settleIdle();
      return;
    }
    this.setAnswer(text, source);
    // truth#4: a host-authored answer is not attributed to a model route that an earlier turn left behind.
    if (source !== "model") this.snap.route = null;
    // H2: host-authored text is complete as soon as it is set.
    if (this.snap.timing) this.snap.timing = { ...this.snap.timing, inferenceCompletedAt: this.snap.timing.inferenceCompletedAt ?? this.now() };
    if (!this.worker || !this.snap.open) {
      if (this.snap.timing) this.snap.timing = { ...this.snap.timing, completedAt: this.snap.timing.completedAt ?? this.now() };
      this.touch();
      return;
    }
    const { chunks } = chunkAnswer(text);
    if (chunks.length === 0) {
      if (this.snap.timing) this.snap.timing = { ...this.snap.timing, completedAt: this.snap.timing.completedAt ?? this.now() };
      this.settleIdle();
      return;
    }
    this.setState("PROCESSING");
    const current = { turn, gen: this.snap.generation, spoken: [] as string[] };
    for (const chunk of chunks) this.sendChunk(current, chunk);
    this.touch();
  }

  /** Barge-in: advance the generation, cancel the worker's speech, stop the voice turn's own inference, drop queued chunks. */
  private bargeIn(source: InterruptSource) {
    const oldGen = this.snap.generation;
    const oldTurn = this.snap.turnId ?? "none";
    const wasPlaying = this.snap.playing;
    const hadInference = this.inference !== null;
    this.snap.generation += 1;
    this.tryWorker({ op: "speak.cancel", gen: oldGen });
    if (hadInference) void this.stopInference();
    this.outstanding = 0;
    this.snap.playing = false;
    this.snap.answer = null;
    this.snap.answerSource = null;
    this.recordInterrupt(source, hadInference ? true : null, wasPlaying, oldTurn, oldGen);
    this.setState("INTERRUPTED");
    this.deps.journal("voice.interrupted", `Speech interrupted (${source}).`);
  }

  private recordInterrupt(source: InterruptSource, inferenceStopped: boolean | null, wasPlaying: boolean, turn: string, gen: number) {
    this.snap.lastInterrupt = {
      turnId: turn,
      gen,
      requestedAt: this.now(),
      source,
      workerResetMs: null,
      meterSilentMs: null,
      droppedChunks: 0,
      inferenceStopped,
      lateEventsDropped: this.lateEventsDropped,
      wasPlaying,
    };
  }

  // -------------------------------------------------------------------------------------------------------------
  // Worker events
  // -------------------------------------------------------------------------------------------------------------

  private onWorkerEvent(event: WorkerEvent) {
    switch (event.ev) {
      case "ready":
        this.snap.engines = { stt: event.stt.engine, tts: event.tts.engine, local: true };
        this.readyResolve?.(true);
        this.readyResolve = null;
        return this.touch();
      case "devices":
        this.snap.devices = { input: event.defaultInput, output: event.defaultOutput, micPrivacy: event.micPrivacy };
        this.devicesResolve?.();
        this.devicesResolve = null;
        return this.touch();
      case "device.changed":
        this.snap.devices = { ...this.snap.devices, input: event.defaultInput, output: event.defaultOutput };
        return this.touch();
      case "mute":
        this.snap.muted = event.on;
        return this.touch();
      case "bye":
        return this.onWorkerExit(this.worker, null);
      case "error":
        return this.setError(event.code, event.message);
      case "speak.cancelled":
        return this.onCancelReceipt(event);
      default:
        break;
    }
    // Generation and turn gate: stale speech, capture or recognition never reaches the state machine.
    if ("gen" in event && typeof event.gen === "number" && event.gen < this.snap.generation) {
      this.lateEventsDropped += 1;
      return;
    }
    if ("turn" in event && typeof event.turn === "string" && event.turn !== this.snap.turnId) {
      this.lateEventsDropped += 1;
      return;
    }
    switch (event.ev) {
      case "capture.started":
        if (this.fsm.state === "ARMING") {
          this.setState("LISTENING");
          this.snap.capturing = true;
          if (this.snap.timing) this.snap.timing = { ...this.snap.timing, captureStartedAt: this.now() };
        }
        break;
      case "capture.first_audio":
        if (this.snap.timing && this.snap.timing.firstAudioAt === null) this.snap.timing = { ...this.snap.timing, firstAudioAt: this.now() };
        break;
      case "level":
        if (this.snap.capturing) this.snap.level = { rms: clamp01(event.rms), peak: clamp01(event.peak), speech: event.speech, at: this.now() };
        break;
      case "vad":
        if (event.state === "speech_start") this.clearIdle();
        if (event.state === "speech_end" && this.snap.timing) this.snap.timing = { ...this.snap.timing, speechEndAt: this.now() };
        break;
      case "stt.partial":
        // Partials are display only; they are never acted on (V08).
        if (this.snap.timing && this.snap.timing.firstPartialAt === null) this.snap.timing = { ...this.snap.timing, firstPartialAt: this.now() };
        this.snap.partial = event.text.slice(0, VOICE_LIMITS.maxTranscriptChars);
        break;
      case "stt.final":
        this.clearIdle();
        this.onFinal(event.turn, event.text, event.confidence);
        break;
      case "stt.none":
        this.clearIdle();
        this.onNone(event.reason);
        break;
      case "capture.stopped":
        this.snap.capturing = false;
        this.snap.level = null;
        if (this.fsm.state === "LISTENING") this.setState("TRANSCRIBING");
        break;
      case "capture.error":
        this.clearIdle();
        this.snap.capturing = false;
        this.snap.level = null;
        this.setError(event.code, event.message, deviceStateFor(event.code));
        break;
      case "tts.ready":
        if (this.snap.timing && this.snap.timing.firstTtsReadyAt === null) this.snap.timing = { ...this.snap.timing, firstTtsReadyAt: this.now() };
        break;
      case "playback.started":
        if (this.snap.timing && this.snap.timing.firstPlaybackAt === null) this.snap.timing = { ...this.snap.timing, firstPlaybackAt: this.now() };
        if (this.fsm.state === "PROCESSING" || this.fsm.state === "SPEAKING") {
          this.snap.playing = true;
          this.setState("SPEAKING");
        }
        break;
      case "playback.chunk_done":
        this.outstanding = Math.max(0, this.outstanding - 1);
        break;
      case "playback.idle":
        this.snap.playing = false;
        this.outstanding = 0;
        if (this.inference) {
          // Idle between chunks while the answer still streams: wait, do not re-arm (V28).
          if (this.fsm.state === "SPEAKING") this.setState("PROCESSING");
        } else {
          if (this.snap.timing) this.snap.timing = { ...this.snap.timing, completedAt: this.snap.timing.completedAt ?? this.now() };
          if (this.fsm.state === "SPEAKING") this.settleIdle();
        }
        break;
      case "playback.error":
        this.snap.playing = false;
        this.outstanding = 0;
        // TTS failed: the answer is delivered as text, so the turn is finished once no inference is still streaming.
        if (!this.inference && this.snap.timing) this.snap.timing = { ...this.snap.timing, completedAt: this.snap.timing.completedAt ?? this.now() };
        this.setError(event.code, event.message);
        break;
      default:
        break;
    }
    this.touch();
  }

  private onCancelReceipt(event: Extract<WorkerEvent, { ev: "speak.cancelled" }>) {
    // H12: speak commands the worker dropped as already-cancelled since the last receipt. Absent on older workers.
    if (typeof event.staleDropped === "number" && event.staleDropped > 0) this.lateEventsDropped += event.staleDropped;
    const receipt = this.snap.lastInterrupt;
    if (!receipt || receipt.gen !== event.gen) {
      this.lateEventsDropped += 1;
      return;
    }
    this.snap.lastInterrupt = {
      ...receipt,
      workerResetMs: event.resetMs,
      meterSilentMs: event.meterSilentMs,
      droppedChunks: event.droppedChunks,
      wasPlaying: event.wasPlaying,
      lateEventsDropped: this.lateEventsDropped,
    };
    this.touch();
  }

  private onNone(reason: string) {
    this.snap.capturing = false;
    this.snap.level = null;
    this.snap.partial = null;
    this.deps.journal("voice.turn", `No speech accepted (${reason}).`);
    if (this.fsm.state === "LISTENING") this.setState("TRANSCRIBING");
    this.settleIdle();
  }

  private onWorkerExit(worker: VoiceWorkerPort | null, code: number | null) {
    void code;
    if (this.closing || !worker || worker !== this.worker) return;
    this.worker = null;
    this.snap.capturing = false;
    this.snap.playing = false;
    this.snap.level = null;
    // races#4: the voice turn's inference has no worker to speak into. Stop it now, so it cannot keep generating, and its
    // chunks are no longer counted as outstanding. The turn then settles to ERROR through setError below.
    if (this.inference) void this.stopInference();
    this.outstanding = 0;
    // containment#0: the job group of the exited worker is settled (terminated and closed) before any reopen can start.
    const settle = worker.close().catch(() => undefined);
    this.settling = settle.finally(() => {
      if (this.settling === settle) this.settling = null;
    }) as Promise<void>;
    this.setError("WORKER_EXITED", "The voice worker stopped. Close and open voice to continue.");
  }

  // -------------------------------------------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------------------------------------------

  /** Sends to the worker when it runs; a failed write becomes an error state, never an exception to the caller. */
  private tryWorker(command: WorkerCommand) {
    if (!this.worker) return;
    // H5: a command that would cross the hard stdin budget ends the turn truthfully instead of failing silently.
    const size = Buffer.byteLength(JSON.stringify(command), "utf8") + 1;
    if (this.worker.stdinBytes + size > this.hardBudget) {
      this.endForBudget();
      return;
    }
    try {
      this.worker.send(command);
    } catch (error) {
      void error;
      this.setError("INTERNAL", "The voice worker refused a command.");
    }
  }

  /** Ends the session when the worker's input budget would be crossed mid-turn: error shown, worker closed, voice must be reopened. */
  private endForBudget() {
    const worker = this.worker;
    this.worker = null;
    this.deps.journal("voice.error", "Voice worker input budget reached; the turn was ended.");
    if (this.inference) void this.stopInference();
    this.clearTimers();
    this.snap.capturing = false;
    this.snap.playing = false;
    this.snap.level = null;
    this.outstanding = 0;
    this.setError("INTERNAL", "The voice worker's input budget was reached, so this turn was ended. Open voice to continue.");
    this.snap.open = false;
    this.snap.sessionId = null;
    void worker?.close().catch(() => undefined);
    this.touch();
  }

  private needsRelaunch(): boolean {
    return !!this.worker && this.snap.open && this.worker.stdinBytes > this.softBudget && this.fsm.state === "IDLE" && !this.inference && this.outstanding === 0 && !this.snap.playing && !this.snap.capturing;
  }

  /**
   * H5: at idle, above the soft budget, closes the worker and launches a fresh one (new job group). The session id and
   * the microphone mute state carry over; no capture or speech is in flight, so nothing is lost.
   */
  private relaunchIfIdle(): Promise<void> {
    if (this.relaunching) return this.relaunching;
    if (!this.needsRelaunch() || this.closing) return Promise.resolve();
    const old = this.worker!;
    this.relaunching = this.doRelaunch(old).finally(() => {
      this.relaunching = null;
    });
    return this.relaunching;
  }

  private async doRelaunch(old: VoiceWorkerPort) {
    this.worker = null;
    try {
      await old.close();
      const fresh = await this.startWorker();
      if (!fresh) {
        this.snap.open = false;
        this.snap.sessionId = null;
        this.touch();
        return;
      }
      if (this.snap.muted) this.tryWorker({ op: "mute", on: true });
      this.tryWorker({ op: "devices" });
      this.deps.journal("voice.session_opened", "Voice worker relaunched at idle to stay within its input budget.");
    } catch {
      // races#7: a failed relaunch closes the session truthfully instead of leaving a rejected promise behind.
      this.snap.open = false;
      this.snap.sessionId = null;
      this.setError("INTERNAL", "The voice worker could not be relaunched. Open voice to continue.");
    }
    this.touch();
  }

  private newTurn(kind: "" | "typed" | "ctl" = ""): string {
    const turn = `t${++this.turnSeq}${kind ? `-${kind}` : ""}-${randomUUID().slice(0, 8)}`;
    this.snap.turnId = turn;
    return turn;
  }

  private setState(to: VoiceState) {
    if (this.fsm.state === to) return;
    if (!tryTransition(this.fsm, to)) return;
    this.snap.state = to;
    // Truth flags are cleared by any state that is not the confirmed one.
    if (to !== "LISTENING") this.snap.capturing = false;
    if (to !== "SPEAKING") this.snap.playing = false;
  }

  /** Returns to IDLE (or MUTED when muted). Hands-free re-arms only when `rearm` and nothing is playing. */
  private settleIdle(rearm = true) {
    if (this.fsm.state !== "IDLE") this.setState("IDLE");
    if (this.snap.muted && this.fsm.state === "IDLE") this.setState("MUTED");
    this.touch();
    if (this.needsRelaunch()) this.detach("relaunch", () => this.relaunchIfIdle());
    if (rearm) this.maybeRearm();
  }

  /** Hands-free only: re-arms after playback ends, never during playback (V28), never mid-answer. */
  private maybeRearm() {
    if (this.closing || this.snap.mode !== "hands_free" || !this.snap.open || this.snap.muted || this.fsm.state !== "IDLE") return;
    if (this.inference || this.outstanding > 0 || this.snap.playing) return;
    this.cancelRearmTimer();
    this.cancelRearm = this.schedule(() => {
      this.cancelRearm = null;
      // races#5: the callback re-checks the session it was armed in: no close in progress, still hands-free, not muted.
      if (this.closing || !this.snap.open || this.snap.mode !== "hands_free" || this.snap.muted) return;
      if (this.fsm.state === "IDLE" && !this.snap.playing && !this.inference) this.detach("re-arm", () => this.listenStart("hands_free"));
    }, HANDS_FREE_RESTART_MS);
  }

  /** Hands-free idle timeout: no speech within the window closes the microphone and does not re-arm (V01 default-off). */
  private armIdle(turn: string) {
    this.clearIdle();
    this.cancelIdle = this.schedule(() => {
      this.cancelIdle = null;
      if (this.snap.turnId !== turn) return;
      if (this.fsm.state === "LISTENING" || this.fsm.state === "ARMING") {
        this.tryWorker({ op: "capture.abort", gen: this.snap.generation });
        this.snap.capturing = false;
        this.snap.level = null;
        this.setState("IDLE");
        this.deps.journal("voice.turn", "Hands-free idle timeout; microphone closed.");
        this.touch();
      }
    }, VOICE_LIMITS.handsFreeIdleMs);
  }

  private clearIdle() {
    this.cancelIdle?.();
    this.cancelIdle = null;
  }

  private cancelRearmTimer() {
    this.cancelRearm?.();
    this.cancelRearm = null;
  }

  private clearTimers() {
    this.clearIdle();
    this.cancelRearmTimer();
    this.cancelInferenceTimer?.();
    this.cancelInferenceTimer = null;
  }

  private setError(code: VoiceErrorCode | "WORKER_EXITED" | "WORKER_INTEGRITY" | "NOT_WINDOWS", message: string, state?: VoiceState) {
    this.snap.error = { code, message: message.slice(0, 300) };
    if (state && canTransition(this.fsm.state, state)) this.setState(state);
    else if (canTransition(this.fsm.state, "ERROR")) this.setState("ERROR");
    if (code === "NOT_WINDOWS" || code === "WORKER_INTEGRITY" || code === "TIMEOUT") this.snap.open = false;
    this.deps.journal("voice.error", `Voice error ${code}.`);
    this.touch();
  }

  private setAnswer(text: string, source: AnswerSource) {
    this.snap.answer = text.slice(0, VOICE_LIMITS.maxAnswerChars);
    this.snap.answerSource = source;
  }

  private setUi(kind: "open_agentic" | "open_agent" | "open_approvals", agentId: string | null) {
    this.snap.uiIntent = { seq: ++this.uiSeq, kind, agentId };
  }

  private refuse(code: VoiceErrorCode, message: string): VoiceSnapshot {
    this.snap.error = { code, message };
    this.touch();
    return this.snapshot();
  }

  private refuseControl(message: string): VoiceSnapshot {
    this.deps.journal("voice.control_refused", "Control refused.");
    this.setAnswer(message, "refusal");
    this.touch();
    return this.snapshot();
  }

  private touch() {
    this.snap.state = this.fsm.state;
    this.snap.updatedAt = this.now();
  }
}

function emptyTiming(turnId: string, now: number): VoiceTiming {
  return {
    turnId,
    activatedAt: now,
    captureStartedAt: null,
    firstAudioAt: null,
    firstPartialAt: null,
    speechEndAt: null,
    finalAt: null,
    admittedAt: null,
    firstTokenAt: null,
    firstTtsReadyAt: null,
    firstPlaybackAt: null,
    inferenceCompletedAt: null,
    completedAt: null,
  };
}

/** A clarification answer is taken only as a whole: a candidate name, or a bare ordinal ("the second one", "two"). */
const ORDINAL_ANSWERS: [RegExp, number][] = [
  [/^(?:the )?(?:first|1st|one|1)(?: one)?$/, 0],
  [/^(?:the )?(?:second|2nd|two|2)(?: one)?$/, 1],
  [/^(?:the )?(?:third|3rd|three|3)(?: one)?$/, 2],
];

/**
 * Picks one candidate for a pending clarification (authz#0). Only an exact candidate name or a bare ordinal counts; any
 * other utterance, including one that merely contains an ordinal ("the first one, approve it"), returns null and is
 * classified normally, so it can never be turned into a control proposal by accident.
 */
export function pickCandidate(text: string, candidates: Candidate[]): Candidate | null {
  const normalized = text.toLowerCase().replace(/[.!?,]+$/, "").trim();
  const byName = candidates.filter((item) => item.name.toLowerCase() === normalized);
  if (byName.length === 1) return byName[0];
  for (const [re, index] of ORDINAL_ANSWERS) if (re.test(normalized)) return candidates[index] ?? null;
  return null;
}

function uniqueById(rows: Candidate[]): Candidate[] {
  return rows.filter((row, index) => rows.findIndex((other) => other.id === row.id) === index);
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** Device-level capture errors leave the session in DEVICE_UNAVAILABLE with the truthful code (V03, V04). */
function deviceStateFor(code: VoiceErrorCode): VoiceState {
  return code === "ENDPOINT_MUTED" || code === "PERMISSION_DENIED" || code === "DEVICE_UNAVAILABLE" || code === "DEVICE_LOST" ? "DEVICE_UNAVAILABLE" : "ERROR";
}
