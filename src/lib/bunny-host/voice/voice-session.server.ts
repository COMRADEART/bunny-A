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
import { claimsAction, classifyTranscript, controlAction, type VoiceIntent } from "./voice-intent.ts";
import { VoiceTurnTaking, echoMatch, echoTokens, type TurnDecision } from "./voice-turn-taking.ts";
import { answerApprovals, answerFollowUp, answerTeam, answerLastMission, answerModel, answerStatus, answerVerification, humanState, isTerminalAgent, missionLabel, MISSION_OVER, type AgentFact, type ApprovalFact, type FollowUpSubject, type MissionFact } from "./voice-answers.server.ts";

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
  "You also cannot open apps, create, write or save files, browse, send messages, or end this voice session.",
  "If the user asks for one of those things, tell them it is done on the Windows Host screen. Never answer with only \"Done\".",
].join(" ");
/** T12 live: replaces model text that claims an action the tool-free model cannot take (see claimsAction). */
export const SPOKEN_ACTION_CLAIM_TEXT = "I can't do that by voice. Nothing was changed.";
/** T12 live: the fixed answer to a request to act on the computer. */
export const DEVICE_ACTION_TEXT = "I can't do things on this computer by voice. I can answer questions, report on your agents, or draft a Mission.";

export const REFUSAL_TEXT = "I can't do that by voice. Approvals, permissions and commands are reviewed on the Windows Host screen.";
export const REDIRECT_TEXT = "I can't change a running agent's plan by voice. You can pause or stop it, or start a new Mission in the Agentic workspace.";
/** T12 F3: the one truthful refusal for a Mission draft that was not created. */
export const DRAFT_REFUSAL = "I couldn't draft that Mission. Nothing was created.";
export const TOOLS_TEXT = "That question needs tools or a hosted model, so it is waiting for approval on the Windows Host screen.";
/** T12 RES-04: refused before submit once the spoken questions already waiting for approval reach the cap. */
export const WAITING_VOICE_TASKS_TEXT = "Some voice questions are already waiting for review on the Windows Host screen.";
/** T12 RES-04 (round 2): the words of a spoken question, lowercased and unpunctuated, so a repeat of it collapses onto one row. */
function voiceCollapseKey(transcript: string): string {
  return transcript.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
/** T12-AUTH-04: "pause the mission" has no voice answer; Missions are paused per Agent or on the Windows Host screen. */
export const MISSION_PAUSE_TEXT = "Missions are paused and resumed per Agent, or on the Windows Host screen. Nothing was changed.";
/** T12: speech at least this long is recognized by the worker (shorter bursts end as stt.none too_short without a decode). */
const MIN_RECOGNIZED_SPEECH_MS = 250;
/** T12 live re-check: how long an unfinished sentence waits for the user to start speaking again, and its hard bound. */
const FRAGMENT_WAIT_MS = 2500;
const FRAGMENT_MAX_MS = 9000;
const UNFINISHED_LAST_WORD = /\b(?:and|but|or|because|if|a|an|the|my|your|our|their|to|for|of|about|with|from|into|um|uh|er|erm)$/;
/**
 * T12 live re-check: a duplex final that would only reach the chat model and ends on a word that cannot end a sentence
 * (or on whisper's trailing ellipsis) is unfinished. Anything that is not chat (a stop, a close, a refusal, a status
 * question, a confirm) is never held.
 */
function isUnfinishedChat(text: string, proposalPending: boolean): boolean {
  if (classifyTranscript(text, { proposalPending }).kind !== "chat") return false;
  const trimmed = text.trim();
  if (/(?:\.\.\.|…)$/.test(trimmed)) return true;
  const words = trimmed.toLowerCase().replace(/[’`]/g, "'").replace(/[\s.!?,;:]+$/, "");
  return UNFINISHED_LAST_WORD.test(words);
}
/** T12 AEC-02: a turn whose speech starts this soon after Bunny's output stopped is still the output's tail, not a new turn. */
const OUTPUT_OVERLAP_TAIL_MS = 300;
/** T12 AEC-02: how many recent output windows are kept for the overlap check. */
const OUTPUT_WINDOWS_MAX = 4;

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
  /** T12 RES-04: the task's canonical state, so a refused spoken question leaves the waiting count when it is reviewed. Optional. */
  taskState?(taskId: string): string | null;
}
export interface VoiceAgentPort {
  rows(): VoiceAgentRow[];
  facts(): { agents: AgentFact[]; missions: MissionFact[]; approvals: ApprovalFact[] };
  /** T12 RES-02: every Mission that has not finished, read from canonical state (not the recency window). Optional. */
  activeMissions?(): MissionFact[];
  /** T12 RES-02: one Mission by id from canonical state, so a stop is confirmed against the record itself. Optional. */
  mission?(missionId: string): MissionFact | null;
  /** T12 RES-01: how many voice-origin Missions wait for review, counted from canonical state. Optional. */
  pendingVoiceDrafts?(): number;
  /** Runs the canonical agent command (agentCommand with the workstation actor). Throws on refusal. */
  command(action: "agent.pause" | "agent.resume" | "agent.stop", id: string, revision: number): Promise<void>;
  /** T12: the canonical MissionManager stop with the workstation actor (missionCommand "mission.stop"). Throws on refusal. */
  missionStop?(missionId: string): Promise<void>;
  /**
   * T12: the canonical missionCommand "mission.create" of a DRAFT (origin voice:workstation, mode fast, local-only, no
   * steps, no team). It never approves or starts; the Mission waits for review on the Windows Host screen. Throws on refusal.
   */
  draftMission?(input: { objective: string; projectId: string | null }): Promise<{ id: string; title: string; state: string }> | { id: string; title: string; state: string };
  /** T12: registered Projects, for resolving a spoken Project name ("the dashboard project"). */
  projects?(): { id: string; name: string }[];
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
/** T12: a pending pick. A control names the Agent or Mission to act on; a follow-up names the subject to answer about. */
type Clarification =
  | { purpose: "control"; action: VoiceProposal["action"]; subject: "agent" | "mission"; candidates: Candidate[]; expiresAt: number }
  | { purpose: "followup"; focus: string; candidates: Candidate[]; expiresAt: number };
/** T12 F4: the ids a Host-facts answer named, in spoken order. Ids only: the state is always read again from live rows. */
type Referent = { kind: "agents" | "missions"; ids: string[]; missionId: string | null; at: number; hostEpoch: string };
type Inference = { taskId: string; turn: string; gen: number; chunker: VoiceChunker; spoken: string[]; done: boolean; received: boolean; claimBlocked?: boolean };
/** T12: a reply held on speech onset. Keyed by output generation: a resume or a stale timer can never touch newer speech. */
type Hold = { turn: string; gen: number; inputTurn: string; inputGen: number; cancelResume: (() => void) | null; cancelMax: (() => void) | null };
/** T12: how the Host received a transcript: from the duplex lane, a push-to-talk capture, or typed text. */
export type TurnMeta = { source: "duplex" | "push_to_talk" | "typed"; overlapped: boolean; speechMs: number | null; /** Review round 5: built from a held unfinished sentence; it can never confirm. */ fromFragment?: boolean };
/** T12: one input turn of the echo-cancelled lane, with its own controller, identity and recognition deadline. */
type InputTurn = { turn: string; gen: number; timing: VoiceTiming; controller: VoiceTurnTaking; overlapped: boolean; speechOpen: boolean; dropped: boolean; cancelDeadline: (() => void) | null };
/** T12: one chunk of Bunny's own speech, kept for the echo gate from the time it was sent until it stopped playing. */
type SpokenEntry = { turn: string; gen: number; seq: number; tokens: string[]; sentAt: number; playedAt: number | null; endedAt: number | null };
/** Every way the duplex lane ends. Only a "user" stop or a "relaunch" keeps the hands-free grant. */
export type DuplexEnd = "user" | "mute" | "idle" | "lifetime" | "error" | "worker_exit" | "close" | "mode" | "relaunch" | "budget";
/** RC-05: how a held reply ends with the duplex lane. Absent means cancelled (interrupted), never resumed by default. */
type StopOptions = { holdOutcome?: "resumed" | "interrupted" };
const SPOKEN_LOG_MAX = 64;
/** Input turns whose capture ended and whose recognition is still pending: bounded, oldest evicted first. */
const FINALIZING_MAX = 4;
/** After a recognition deadline drops an input turn, the worker has this long to acknowledge the abort before the session closes. */
const FINALIZE_ACK_MS = 2_000;
const TYPED_META: TurnMeta = { source: "typed", overlapped: false, speechMs: null };

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
  /** The recognizer notice (whisper unavailable, SAPI in use). Non-fatal: it stays on the snapshot until a turn replaces it. */
  private sttNotice: string | null = null;
  /** containment#0: a worker whose job group is being settled after an exit; a new open waits for it. */
  private settling: Promise<void> | null = null;
  /** Bumped on every open and close: asynchronous control work from an earlier session never speaks into a later one (races#3). */
  private sessionEpoch = 0;
  private closing = false;
  /** R3-session#2: one close at a time; a second close joins the first instead of racing it. */
  private closingPromise: Promise<VoiceSnapshot> | null = null;
  private pendingAtTurn = false;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => () => void;
  /** listen.start presses waiting for the previous turn's final (Part B live finding). */
  private readonly transcribedWaiters = new Set<() => void>();
  private readonly softBudget: number;
  private readonly hardBudget: number;
  private readonly finalized = new Set<string>();
  /** Short spoken history for chat follow-ups. Host-facts answers are kept too, marked `host` (T12 F8). Cleared on close. */
  private readonly history: { user: string; assistant: string; host?: boolean }[] = [];
  private cancelIdle: (() => void) | null = null;
  private cancelRearm: (() => void) | null = null;
  private cancelInferenceTimer: (() => void) | null = null;
  private cancelTaskOutput: (() => void) | null = null;
  private inference: Inference | null = null;
  private outstanding = 0;
  private clarification: Clarification | null = null;
  private uiSeq = 0;
  private turnSeq = 0;
  private duplexSupported = false;
  private duplexStarting = false;
  private duplexToken: string | null = null;
  private inputSequence = 0;
  /** The armed input turn of the echo-cancelled lane, or null between turns. */
  private input: InputTurn | null = null;
  /** Input turns whose capture ended and whose recognition has not reported yet, keyed by turn id. */
  private readonly finalizing = new Map<string, InputTurn>();
  /** The reply held on speech onset (paused, not cancelled) while the controller decides. */
  private hold: Hold | null = null;
  /**
   * The explicit user start that permits the microphone to be (re)opened. Null means no live grant. Only a Start click
   * (listen.start with source hands_free) creates or renews it, after that start's validity checks pass (T12-PRIV-01/02).
   */
  private grantExpiresAt: number | null = null;
  /** RES-07: the Host's own timer at the grant's end; it stops the duplex lane even while it is live. */
  private cancelGrantExpiry: (() => void) | null = null;
  /** T12 AEC-02: recent windows in which Bunny's output was in flight (end null while still in flight). Overlap is judged on these. */
  private outputWindows: { start: number; end: number | null }[] = [];
  /** T12-AUTH-06: whether Bunny's output was audible when the push-to-talk capture being finalized began. */
  private captureOverlap = false;
  /** T12 RES-04: spoken questions that were refused and still wait for review on the Host screen (tracked until reviewed). */
  // T12 RES-04 (round 2): taskId -> the collapse key of its spoken question (see voiceCollapseKey).
  private readonly waitingVoiceTasks = new Map<string, string>();
  private cancelDuplexReady: (() => void) | null = null;
  private duplexStopping: Promise<void> | null = null;
  private duplexStopResolve: (() => void) | null = null;
  private cancelDuplexStop: (() => void) | null = null;
  private cancelDuplexIdle: (() => void) | null = null;
  private readonly spokenLog: SpokenEntry[] = [];
  /** How the transcript that is being accepted reached the Host. Read by dispatch for the overlapped-confirm rule. */
  private turnMeta: TurnMeta = TYPED_META;
  /** T12: whether Bunny's output was audible when the transcript being accepted was heard, before the turn settled to PROCESSING. */
  private outputAtFinal = false;
  /** T12 live re-check: an unfinished duplex sentence waiting for its continuation (see holdFragment). */
  private fragment: { text: string; turn: string; confidence: number; meta: TurnMeta; cancel: (() => void) | null } | null = null;
  /** T12 F4: the last Host-facts list of Agents or Missions. Cleared on close. */
  private referent: Referent | null = null;
  /** T12 F3: when a spoken Mission draft was last attempted (the rate limit between drafts). */
  private lastDraftAt: number | null = null;

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
      lastClose: null,
      inputTurnId: null,
      duplex: freshDuplex(false, null),
      outputHeld: false,
      turnDecision: null,
      lastBargeIn: null,
      timing: null,
      createdAt: null,
      updatedAt: this.now(),
    };
  }

  /** The VoiceSnapshot clients render. A copy: callers cannot mutate session state. */
  snapshot(): VoiceSnapshot {
    const copy = structuredClone(this.snap);
    // The grant lapses with the clock, not with an event: the copy reports the grant's truth at this instant.
    if (copy.duplex) copy.duplex.grantExpiresAt = this.grantLive() ? this.grantExpiresAt : null;
    return copy;
  }

  /** Diagnostics for tests and the journal: how many stale events were dropped. */
  get staleEventsDropped(): number {
    return this.lateEventsDropped;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Session lifecycle
  // -------------------------------------------------------------------------------------------------------------

  async open(mode: VoiceMode = "push_to_talk"): Promise<VoiceSnapshot> {
    // T12-PRIV-01: an open never creates or renews the hands-free grant. Opening or switching to hands-free only shows the mode;
    // the microphone opens on an explicit Start hands-free (listen.start with source hands_free), which alone grants it.
    if (this.opening) await this.opening.catch(() => undefined);
    // R3-session#2: an open never interleaves with an in-flight close (which would orphan the new worker).
    if (this.closingPromise) await this.closingPromise.catch(() => undefined);
    // containment#0: no second worker starts while the previous job group is still being settled.
    if (this.settling) await this.settling;
    if (this.snap.open) {
      // H4: an open with a different mode switches in place: same session id, same worker.
      if (mode !== this.snap.mode) await this.switchMode(mode);
      return this.snapshot();
    }
    this.opening = this.doOpen(mode).finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  /** H4: changes the mode of the open session without relaunching the worker. */
  private async switchMode(mode: VoiceMode) {
    this.snap.mode = mode;
    if (mode === "push_to_talk") {
      this.revokeGrant();
      // RC-05: a held reply continues when the mode changes; the mode change is not a barge-in.
      await this.stopDuplex("mode", { holdOutcome: "resumed" });
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
      error: this.standingNotice(),
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
    // Each launch states its own recognizer: a relaunch without a fallback clears the previous notice.
    if (worker.sttNotice) this.setSttNotice(worker.sttNotice);
    else this.sttNotice = null;
    return worker;
  }

  /** The STT notice as a snapshot error, kept across turn starts so the fallback stays visible while SAPI is in use. */
  private standingNotice(): { code: "STT_UNAVAILABLE"; message: string } | null {
    return this.sttNotice ? { code: "STT_UNAVAILABLE", message: this.sttNotice } : null;
  }

  /** Shows a recognizer notice without changing the session state: the session stays usable on SAPI. */
  private setSttNotice(message: string) {
    this.sttNotice = message.slice(0, 300);
    this.snap.error = this.standingNotice();
    this.deps.journal("voice.notice", "Voice recognizer notice shown.");
    this.touch();
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
  close(source = "client"): Promise<VoiceSnapshot> {
    const label = /^[a-z_]{1,24}$/.test(source) ? source : "client";
    if (this.closingPromise) {
      // R4: a second close joins the first; its own label is still journaled, so the receipt never hides a caller.
      this.deps.journal("voice.session_closed", `Voice close also requested (${label}) while a close was in flight.`);
      return this.closingPromise;
    }
    const closing = this.doClose(label).finally(() => {
      if (this.closingPromise === closing) this.closingPromise = null;
    });
    this.closingPromise = closing;
    return closing;
  }

  private async doClose(source: string): Promise<VoiceSnapshot> {
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
    const wasSpeaking = this.snap.playing || this.hold !== null || hasSpeechInFlight(this.fsm.state);
    const turn = this.snap.turnId ?? "none";
    const gen = this.snap.generation;
    // RC-05: a close cancels a held reply (its receipt says interrupted, never resumed); the duplex release is not a resume.
    void this.stopDuplex("close");
    // races#3: capture and speech are cut first, before anything is awaited, so queued chunks stop at once. The worker
    // handle is then dropped, so no event or command reaches the closing session.
    // The duplex lane aborted its own input turns in stopDuplex; a generation-only abort would name the wrong lane.
    if (!this.duplexLane() && (this.snap.capturing || this.fsm.state === "ARMING" || this.fsm.state === "LISTENING")) this.tryWorker({ op: "capture.abort", gen });
    if (wasSpeaking) this.tryWorker({ op: "speak.cancel", gen });
    const worker = this.worker;
    this.worker = null;
    // Only then the voice turn's own inference is stopped (its timer and output listener are released synchronously).
    // Device teardown starts independently of provider acknowledgment. A stalled provider cannot keep the mic alive.
    const releasing = worker?.close();
    const stopping = this.inference ? this.stopInference() : null;
    let stopTimer: ReturnType<typeof setTimeout> | null = null;
    const stopDeadline = new Promise<null>(done => { stopTimer = setTimeout(() => done(null), 2000); });
    const inferenceStopped = stopping ? await Promise.race([stopping, stopDeadline]) : null;
    if (stopTimer) clearTimeout(stopTimer);
    // T12-AUD-08: a stop that misses the deadline is "requested", never "not_requested"; its later answer updates this receipt only while it is current.
    const receipt = wasSpeaking ? this.recordInterrupt("session_close", inferenceStopped, true, turn, gen, stopping !== null) : null;
    if (receipt && stopping && inferenceStopped === null) void stopping.then((ok) => this.acknowledgeInferenceStop(receipt, ok === true));
    if (releasing) await releasing;
    this.finishDuplexStop();
    this.cancelWaitingVoiceTasks();
    this.resetAfterClose();
    this.closing = false;
    this.snap.lastClose = { source, at: this.now() };
    this.deps.journal("voice.session_closed", `Voice session closed (${source}); microphone and speaker released.`);
    return this.snapshot();
  }

  private resetAfterClose() {
    this.clearHold("interrupted", "session_close");
    this.revokeGrant();
    this.outputWindows = [];
    this.spokenLog.length = 0;
    // T12 F8: the spoken history and the Host-facts referent end with the session.
    this.history.length = 0;
    this.referent = null;
    this.sessionEpoch += 1;
    // races#5: no re-arm or idle timer from the closed session may fire into a later open.
    this.cancelRearmTimer();
    this.clearIdle();
    this.fsm = createFsm("IDLE");
    // A press waiting on the closed session's transcription wakes now and finds the session closed.
    for (const wake of [...this.transcribedWaiters]) wake();
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
      inputTurnId: null,
      duplex: freshDuplex(this.duplexSupported, this.snap.duplex?.stopped ?? null),
      outputHeld: false,
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
    // T12-PRIV-01/02: an explicit hands_free start is the only path that creates or renews the duplex grant, and it does so
    // only after the start's own validity checks pass (see beginListen). A refused start leaves no new grant.
    return this.beginListen(source, source === "hands_free");
  }

  /**
   * The turn itself. Internal re-arms come here with `grant` false, so they can never create or renew a grant. A user's
   * hands-free start (`grant`) renews the grant only after the closing, open, worker and muted checks pass.
   */
  private async beginListen(source: ListenSource, grant = false): Promise<VoiceSnapshot> {
    // T12-AUTH-06: whether Bunny spoke when the press arrived is read before anything stops the lane or barges in.
    const outputAtPress = this.outputActive();
    // races#3: a session that is closing takes no new turn.
    if (this.closing) return this.refuse("INTERNAL", "Voice is closing.");
    // H5: an in-flight or due relaunch completes before the turn is judged (the worker handle is absent while it runs).
    if (this.relaunching || this.needsRelaunch()) await this.relaunchIfIdle();
    if (!this.snap.open || !this.worker) return this.refuse("INTERNAL", "Voice is not open.");
    if (this.snap.muted) return this.refuse("MUTED", "Microphone is muted; capture was not started.");
    if (this.snap.mode === "hands_free" && this.duplexSupported && source !== "push_to_talk" && (grant || this.grantLive())) {
      if (this.duplexStopping) await this.duplexStopping;
      if (!this.worker || !this.snap.open || this.closing) return this.refuse("INTERNAL", "Voice is not open.");
      if (grant) this.renewGrant();
      this.startDuplex();
      return this.snapshot();
    }
    // A push-to-talk press stops the duplex lane ("user" keeps the grant); a button press without a grant is an ordinary turn.
    // RC-05: the press barges in on a held reply, so the held reply is cancelled (interrupted), never resumed first.
    if (this.duplexLane()) await this.stopDuplex("user", { holdOutcome: "interrupted" });
    if (!this.worker || !this.snap.open || this.closing) return this.refuse("INTERNAL", "Voice is not open.");
    // Live finding (Part B): a press during TRANSCRIBING was refused as DEVICE_BUSY, which the clients show as "microphone in
    // use by another app". The press now waits (bounded) for the previous final, then starts its turn, barging in on any
    // answer that final began. Only a transcription that outlasts the bound is refused, with its own truthful code.
    if (this.fsm.state === "TRANSCRIBING") {
      const epoch = this.sessionEpoch;
      await this.waitTranscribed(VOICE_LIMITS.transcribeWaitMs);
      // R4 H-RELAUNCH-WAKE: the settle that woke this press may have started an idle relaunch (worker handle absent while
      // it runs). The relaunch gate is re-run here, exactly as at the top of listenStart, before the press is judged.
      if (epoch === this.sessionEpoch && (this.relaunching || this.needsRelaunch())) await this.relaunchIfIdle();
      if (this.closing || epoch !== this.sessionEpoch || !this.snap.open || !this.worker) return this.refuse("INTERNAL", "Voice is not open.");
      if (this.snap.muted) return this.refuse("MUTED", "Microphone is muted; capture was not started.");
      if (this.fsm.state === "TRANSCRIBING") return this.refuse("BUSY_TRANSCRIBING", "The previous turn is still being transcribed. Try again in a moment.");
      // A turn another press started while this one waited is left alone; this press joins it.
      if (this.fsm.state === "ARMING" || this.fsm.state === "LISTENING") return this.snapshot();
    }
    // T12-AUTH-06: a press during output barges in first; its final is then overlapped, so it can never confirm a proposal.
    this.captureOverlap = outputAtPress;
    // T12-PRIV-01 (round 2): a Start hands-free click grants only while hands-free mode is on. A start made in push-to-talk mode
    // (or any other mode) records no grant, so a later hotkey press cannot open the microphone. Without duplex support the
    // grant still governs hands-free re-arm (see rearmHandsFree), as the Start click is what the grant records.
    if (grant && this.snap.mode === "hands_free") this.renewGrant();
    if (this.outputActive()) this.bargeIn(source === "push_to_talk" ? "push_to_talk" : "button");
    if (this.snap.capturing || this.fsm.state === "LISTENING" || this.fsm.state === "ARMING") this.tryWorker({ op: "capture.abort", gen: this.snap.generation });
    this.cancelRearmTimer();
    this.clearIdle();
    const turn = this.newTurn();
    this.snap.timing = { ...emptyTiming(turn, this.now()), source, endpointing: source === "push_to_talk" ? "manual" : "vad" };
    this.snap.partial = null;
    this.snap.finalTranscript = null;
    this.snap.turnKind = null;
    this.snap.answer = null;
    this.snap.answerSource = null;
    this.snap.route = null;
    this.snap.level = null;
    this.snap.error = this.standingNotice();
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
    if (this.snap.duplex?.active && this.input) {
      if (!turnId || turnId === this.input.turn) this.tryWorker({ op: "capture.end", turn: this.input.turn, gen: this.input.gen });
      else this.lateEventsDropped += 1;
      return this.snapshot();
    }
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
    if (this.duplexActive()) {
      // T12-AUD-04: the duplex lane keeps its microphone and its own turn ids. Output is cancelled on its own generation;
      // only the armed input turn is aborted (with its turn and gen), and a fresh input turn is armed.
      if (this.outputActive()) {
        this.bargeIn(source);
        this.settleIdle(false);
      } else this.recordInterrupt(source, null, false, this.snap.turnId ?? "none", this.snap.generation);
      this.abortInput();
      this.armDuplexTurn();
      this.touch();
      return this.snapshot();
    }
    this.clearIdle();
    if (this.outputActive()) {
      this.bargeIn(source);
      this.settleIdle(false);
    } else if (this.snap.capturing || this.fsm.state === "LISTENING" || this.fsm.state === "ARMING") {
      this.tryWorker({ op: "capture.abort", gen: this.snap.generation });
      this.recordInterrupt(source, null, false, this.snap.turnId ?? "none", this.snap.generation);
      if (!this.duplexStopping) this.snap.capturing = false;
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
      // RC-05: a mute cancels a held reply (receipt: interrupted, reason mute); the stop is not a resume.
      void this.stopDuplex("mute");
      this.clearIdle();
      this.cancelRearmTimer();
      // The duplex lane aborts its own input turn inside stopDuplex; a generation-only abort here would name the wrong lane.
      if (!this.duplexLane() && (this.snap.capturing || this.fsm.state === "ARMING" || this.fsm.state === "LISTENING")) this.tryWorker({ op: "capture.abort", gen: this.snap.generation });
      if (this.outputActive()) this.bargeIn("mute");
      if (!this.duplexStopping) this.snap.capturing = false;
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
    // T12: typed text never stops the hands-free microphone. It barges in on output and proceeds while the duplex lane stays live.
    if (!this.worker || !this.snap.open || this.closing) return this.refuse("INTERNAL", "Voice is not open.");
    if (this.outputActive()) {
      // T12 F1: a typed "stop talking" while Bunny speaks silences her, and nothing else is done with the text.
      const speechStop = classifyTranscript(trimmed, { proposalPending: this.voiceConfirmable() }).kind === "speech_stop";
      this.bargeIn(speechStop ? "speech_stop" : "button");
      if (speechStop) {
        this.settleIdle(false);
        this.touch();
        return this.snapshot();
      }
    }
    if (!this.duplexLane() && (this.snap.capturing || this.fsm.state === "LISTENING" || this.fsm.state === "ARMING")) this.tryWorker({ op: "capture.abort", gen: this.snap.generation });
    this.cancelRearmTimer();
    this.clearIdle();
    const turn = this.newTurn("typed");
    this.snap.timing = { ...emptyTiming(turn, this.now()), source: "typed", endpointing: null };
    this.snap.partial = null;
    this.snap.error = this.standingNotice();
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
    if (!this.duplexLane()) this.snap.capturing = false;
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
  private acceptFinal(text: string, turn: string, confidence = 1, meta: TurnMeta = TYPED_META) {
    // Review round 5: typed and push-to-talk input never joins a held spoken fragment; the fragment is dropped.
    if (meta.source !== "duplex") this.dropFragment("another input arrived");
    this.turnMeta = meta;
    this.outputAtFinal = this.outputActive();
    this.expireProposal();
    this.snap.finalTranscript = text;
    this.snap.partial = null;
    // truth#4: every final turn starts without a route; only a model answer sets one (chat).
    this.snap.route = null;
    this.snap.timing = this.snap.timing ? { ...this.snap.timing, finalAt: this.now() } : null;
    this.setState("PROCESSING");
    // Speech is untrusted input: a barely-heard final is never routed, and never controls an agent.
    if (confidence < VOICE_LIMITS.minFinalConfidence) {
      // T12 F1: a barely heard "stop" while Bunny speaks still silences her, and nothing else is said.
      if (this.outputAtFinal && classifyTranscript(text, { proposalPending: this.voiceConfirmable() }).kind === "speech_stop") {
        this.snap.turnKind = "speech_stop";
        this.bargeIn("speech_stop");
        this.settleIdle(false);
        return;
      }
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
    // Review round 5: words held from before a proposal existed can never answer it, so a fragment-built turn is classified
    // as if nothing were pending, and a confirm from it is refused below.
    const intent = classifyTranscript(text, { proposalPending: this.voiceConfirmable() && !meta.fromFragment });
    // R3-session#1: whether anything was pending is decided before a clarification is consumed, so a bare "cancel"
    // that drops a pending name choice truthfully says it was cancelled.
    this.pendingAtTurn = !!this.snap.proposal || !!this.clarification || !!this.snap.clarification;
    if (intent.kind === "sensitive_refused") this.clearClarification();
    else if (this.resolveClarification(text, turn)) return;
    if ((intent.kind === "agent_control" || intent.kind === "confirm" || intent.kind === "mission_control" || intent.kind === "mission_draft") && confidence < VOICE_LIMITS.minControlConfidence) {
      this.snap.turnKind = intent.kind;
      this.deps.journal("voice.turn", `Turn classified as ${intent.kind} but not acted on: recognizer confidence too low.`);
      this.speakAnswer("I'm not sure I heard that right, so I won't change anything. Please say it again, or use the button on screen.", "host_facts", turn);
      return;
    }
    if (meta.fromFragment && intent.kind === "confirm") {
      this.snap.turnKind = "confirm";
      this.deps.journal("voice.turn", "A confirm built from an unfinished spoken sentence was not acted on.");
      this.answerHost("To confirm, say confirm again after I finish, or use the screen.", turn);
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
    // T12-AUTH-06: a push-to-talk final is overlapped when Bunny's output was audible at the press, or when it is Bunny's own speech.
    const overlapped = this.captureOverlap || this.isEcho(trimmed);
    this.acceptFinal(trimmed, turn, Number.isFinite(confidence) ? confidence : 0, { source: "push_to_talk", overlapped, speechMs: null });
  }

  /** A pending pick consumes the next final: a name or ordinal picks one candidate (V34), then its control or follow-up runs. */
  private resolveClarification(text: string, turn: string): boolean {
    const clarification = this.clarification;
    if (!clarification) return false;
    this.clearClarification();
    if (clarification.expiresAt <= this.now()) return false;
    const choice = pickCandidate(text, clarification.candidates);
    if (!choice) return false;
    if (clarification.purpose === "control") {
      this.proposeControl(clarification.action, choice, clarification.subject);
      this.answerHost(this.proposalSentence(this.snap.proposal!), turn);
      return true;
    }
    const subject = subjectFor(this.deps.agents.facts(), choice.id);
    if (subject) this.speakFollowUp(clarification.focus, subject, turn);
    else this.answerHost("That one is no longer on the Host.", turn);
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
      case "speech_stop":
        this.handleSpeechStop(intent, turn);
        return;
      case "voice_close":
        // T12 live: ending voice only removes capability, so a spoken request is honoured at once, overlapped or not.
        this.deps.journal("voice.turn", "Voice session ended by a spoken request.");
        void this.close("voice_command");
        return;
      case "device_action_unsupported":
        this.speakAnswer(DEVICE_ACTION_TEXT, "refusal", turn);
        return;
      case "mission_draft":
        // T12 F3: a draft is never made from speech that overlapped Bunny's own output; the user says it again.
        if (this.overlappedDuplexTurn()) return this.answerHost("To draft a Mission, say it again after I finish, or use the Windows Host screen.", turn);
        return this.draftMission(intent.target, turn);
      case "mission_control":
        // T12 F2: a Mission stop is proposed only from a clean turn; it executes on the Windows Host screen alone.
        if (this.overlappedDuplexTurn()) return this.answerHost("To stop a Mission, say it again after I finish, or use the Windows Host screen.", turn);
        // T12-AUTH-04: a Mission pause or resume is answered, never proposed; Missions are paused per Agent or on screen.
        if (intent.missionVerb) return this.answerHost(MISSION_PAUSE_TEXT, turn);
        this.handleMissionControl(intent, turn);
        return;
      case "cancel": {
        // authz#2: "Okay, cancelled." is spoken only when something was pending; a bare cancel with nothing pending says so.
        const pending = this.pendingAtTurn || !!this.snap.proposal || !!this.snap.clarification;
        this.snap.proposal = null;
        this.clarification = null;
        this.snap.clarification = null;
        this.answerHost(pending ? "Okay, cancelled." : "Nothing is waiting to be cancelled.", turn);
        return;
      }
      case "confirm": {
        const proposal = this.snap.proposal;
        // T12: a confirm spoken over Bunny's own output (an overlapped turn on any lane, duplex or push-to-talk) never executes;
        // the proposal stays pending (T12-AUTH-06).
        if (proposal && this.voiceConfirmable() && this.turnMeta.overlapped) this.answerHost("To confirm, say confirm again after I finish, or use the screen.", turn);
        else if (proposal && this.voiceConfirmable()) this.executeProposal(proposal, "voice", turn);
        else if (proposal) this.answerHost("That action needs the button on the Windows Host screen.", turn);
        else this.answerHost("Nothing is waiting for your confirmation.", turn);
        return;
      }
      case "open_ui":
        this.setUi("open_agentic", null);
        this.answerHost("Opening the agentic workspace on the Windows Host.", turn);
        return;
      case "agent_control":
        this.handleControl(intent, turn);
        return;
      case "agent_status":
      case "agent_verification":
      case "agent_model":
      case "agent_approvals":
      case "agent_last_mission":
        this.answerHost(this.hostAnswer(intent.kind), turn);
        return;
      case "agent_team": {
        const facts = this.deps.agents.facts();
        this.rememberTeamReferent(intent.target, facts);
        this.answerHost(answerTeam(intent.target, facts.agents, facts.missions), turn);
        return;
      }
      case "agent_followup":
        return this.handleFollowUp(intent, turn, transcript);
      case "chat":
        await this.chat(transcript, turn);
        return;
    }
  }

  /**
   * T12: the transcript was heard while Bunny's own output was audible (or it is Bunny's own speech). Such a turn never makes a
   * draft or a proposal, on the duplex lane or on push-to-talk (T12-AUTH-06).
   */
  private overlappedDuplexTurn(): boolean {
    return this.turnMeta.overlapped;
  }

  /**
   * A host-authored answer to the transcript that asked for it. It is spoken like any answer and kept in the short history as a
   * Host fact, so a chat follow-up has context. The history never carries a proposal id: only the spoken text is kept.
   */
  private answerHost(text: string, turn: string) {
    this.speakAnswer(text, "host_facts", turn);
    const user = this.snap.finalTranscript;
    if (!user) return;
    this.history.push({ user, assistant: text.slice(0, 600), host: true });
    while (this.history.length > VOICE_LIMITS.maxHistoryTurns) this.history.shift();
  }

  /**
   * T12 F1: "stop talking" silences Bunny only. Output that was audible when the words were heard counts, even when the duplex
   * controller already cut it. With no output, a bare "stop" asks which is meant while an Agent runs; nothing is executed.
   */
  private handleSpeechStop(intent: VoiceIntent, turn: string) {
    if (this.outputAtFinal || this.overlappedDuplexTurn()) {
      if (this.outputActive()) this.bargeIn("speech_stop");
      this.settleIdle(false);
      return;
    }
    const agentRunning = this.deps.agents.rows().some((row) => !isTerminalAgent(row.state));
    if (intent.target === "ambiguous" && agentRunning) {
      this.answerHost("Stop talking, or stop an agent?", turn);
      return;
    }
    this.settleIdle();
  }

  private hostAnswer(kind: VoiceTurnKind): string {
    const facts = this.deps.agents.facts();
    const active = facts.agents.find((agent) => !isTerminalAgent(agent.state)) ?? null;
    const activeMission = facts.missions.find((item) => item.id === active?.missionId) ?? null;
    const finished = facts.missions
      .filter((item) => ["completed", "failed", "stopped"].includes(item.status))
      .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
    switch (kind) {
      case "agent_status": {
        const live = facts.agents.filter((agent) => !isTerminalAgent(agent.state));
        if (live.length > 0) this.setReferent("agents", live.map((agent) => agent.id), live.length === 1 ? live[0].missionId : null);
        return answerStatus(facts.agents, facts.missions);
      }
      case "agent_verification":
        return this.missionAnswer(activeMission ?? finished, answerVerification);
      case "agent_model":
        return this.missionAnswer(activeMission ?? finished, answerModel);
      case "agent_approvals":
        return answerApprovals(facts.approvals);
      default:
        if (finished) this.setReferent("missions", [finished.id], finished.id);
        return answerLastMission(finished);
    }
  }

  /** T12 F6: a verification or model answer names the Mission it describes, and says when that is not the active one. */
  private missionAnswer(mission: MissionFact | null, answer: (mission: MissionFact | null) => string): string {
    if (!mission) return answer(null);
    this.setReferent("missions", [mission.id], mission.id);
    return `${missionLabel(mission)}${answer(mission)}`;
  }

  private handleControl(intent: VoiceIntent, turn: string) {
    const action = controlAction(intent.normalized);
    if (!action) return this.answerHost("I didn't understand which control you meant.", turn);
    const active = this.deps.agents.rows().filter((row) => !isTerminalAgent(row.state));
    if (active.length === 0) return this.answerHost("No agent is running right now.", turn);
    const choice = this.chooseTargets(intent, active, "agent");
    if ("reply" in choice) return this.answerHost(choice.reply, turn);
    if (choice.candidates.length > 1) return this.askWhich({ purpose: "control", action, subject: "agent" }, choice.candidates, turn);
    this.proposeControl(action, choice.candidates[0], "agent");
    this.answerHost(this.proposalSentence(this.snap.proposal!), turn);
  }

  /**
   * T12 F2: "stop the mission" proposes a screen-confirmed mission.stop for one active Mission. The Mission id travels as the
   * proposal's agentId; the Mission's own canonical stop runs it. An Agent stop is never proposed for a Mission.
   */
  private handleMissionControl(intent: VoiceIntent, turn: string) {
    if (!this.deps.agents.missionStop) return this.answerHost("I can't stop a Mission by voice here. Use the Windows Host screen.", turn);
    const pool = this.activeMissions();
    if (pool.length === 0) return this.answerHost("No mission is running right now.", turn);
    const choice = this.chooseTargets(intent, pool, "mission");
    if ("reply" in choice) return this.answerHost(choice.reply, turn);
    if (choice.candidates.length > 1) return this.askWhich({ purpose: "control", action: "mission.stop", subject: "mission" }, choice.candidates, turn);
    this.proposeControl("mission.stop", choice.candidates[0], "mission");
    this.answerHost(this.proposalSentence(this.snap.proposal!), turn);
  }

  /**
   * Active Missions: every canonical Mission that has not finished. Read from the Host's canonical state, never from the
   * recency window (T12 RES-02): a running Mission older than the newest rows is still a stop candidate.
   */
  private activeMissions(): Candidate[] {
    return this.unfinishedMissions().map((mission) => ({ id: mission.id, name: mission.title, revision: 0 }));
  }

  private unfinishedMissions(): MissionFact[] {
    const port = this.deps.agents;
    const source = port.activeMissions ? port.activeMissions() : port.facts().missions;
    return source.filter((mission) => !MISSION_OVER.includes(mission.status));
  }

  /** One Mission by id from canonical state (the same source the proposal pool reads), for the confirm-time check. */
  private missionById(id: string): MissionFact | null {
    const port = this.deps.agents;
    if (port.mission) return port.mission(id);
    return port.facts().missions.find((mission) => mission.id === id) ?? null;
  }

  /**
   * The rows a spoken control or pick names. A named target is honored; the ordinal picks by position only when no name matches,
   * and when the name and the position disagree the speaker is asked (authz#3). Messages are unchanged for Agents.
   */
  private chooseTargets(intent: VoiceIntent, pool: Candidate[], noun: "agent" | "mission"): { candidates: Candidate[] } | { reply: string } {
    const named = intent.target ? pool.filter((row) => row.name.toLowerCase() === intent.target.toLowerCase()) : [];
    const byPosition = intent.ordinal !== null ? pool[intent.ordinal - 1] : undefined;
    if (intent.ordinal !== null && !byPosition) return { reply: `There is no ${noun} with that number.` };
    if (intent.target && named.length === 0) {
      if (!byPosition) return { reply: noun === "agent" ? `I can't find an agent named ${intent.target}.` : `I can't find a mission named ${intent.target}.` };
      return { candidates: [byPosition] };
    }
    if (named.length > 0) return { candidates: byPosition ? uniqueById([...named, byPosition]) : named };
    if (byPosition) return { candidates: [byPosition] };
    return { candidates: pool };
  }

  /** A pending pick. The next final that names one candidate resolves it; anything else leaves the question unanswered. */
  private askWhich(base: { purpose: "control"; action: VoiceProposal["action"]; subject: "agent" | "mission" } | { purpose: "followup"; focus: string }, candidates: Candidate[], turn: string) {
    const expiresAt = this.now() + VOICE_LIMITS.clarificationTtlMs;
    const names = candidates.map((row) => row.name);
    if (base.purpose === "control") {
      const question = `Which ${base.subject} should I ${base.action.split(".")[1]}?`;
      this.clarification = { purpose: "control", action: base.action, subject: base.subject, candidates, expiresAt };
      this.snap.clarification = { question, candidates: candidates.map((row) => ({ id: row.id, name: row.name })), expiresAt };
      this.deps.journal("voice.control_proposed", `Clarification needed among ${candidates.length} ${base.subject}s.`);
      return this.answerHost(`${question} ${names.join(", ")}.`, turn);
    }
    const question = `Which one: ${orList(names)}?`;
    this.clarification = { purpose: "followup", focus: base.focus, candidates, expiresAt };
    this.snap.clarification = { question, candidates: candidates.map((row) => ({ id: row.id, name: row.name })), expiresAt };
    this.deps.journal("voice.turn", `Clarification needed among ${candidates.length} Host facts.`);
    return this.answerHost(question, turn);
  }

  private proposeControl(action: VoiceProposal["action"], row: Candidate, subject: "agent" | "mission") {
    const now = this.now();
    this.snap.proposal = {
      id: randomUUID(),
      action,
      ...(subject === "mission" ? { subject: "mission" as const } : {}),
      agentId: row.id,
      agentName: row.name,
      revision: row.revision,
      confirmVia: action === "agent.pause" ? "voice_or_screen" : "screen",
      createdAt: now,
      expiresAt: now + VOICE_LIMITS.proposalTtlMs,
      hostEpoch: this.deps.hostEpoch,
    };
    this.setReferent(subject === "mission" ? "missions" : "agents", [row.id], subject === "mission" ? row.id : null);
    this.deps.journal("voice.control_proposed", `Proposed ${action} (confirm via ${this.snap.proposal.confirmVia}).`);
  }

  private proposalSentence(p: VoiceProposal): string {
    const verb = p.action.split(".")[1];
    if (p.subject === "mission") return `Confirm on the Windows Host screen to ${verb} the mission ${p.agentName}.`;
    return p.confirmVia === "voice_or_screen"
      ? `Say confirm, or confirm on the Windows Host screen, to ${verb} ${p.agentName}.`
      : `Confirm on the Windows Host screen to ${verb} ${p.agentName}.`;
  }

  /**
   * T12 F3: a spoken Mission draft through the canonical mission.create (origin voice:workstation, fast, local-only). The draft
   * waits for review on the Windows Host screen; it is never approved or started from here.
   */
  private async draftMission(objective: string, turn: string) {
    const port = this.deps.agents;
    const now = this.now();
    if (!port.draftMission) return this.answerHost(DRAFT_REFUSAL, turn);
    if (this.lastDraftAt !== null && now - this.lastDraftAt < VOICE_LIMITS.voiceDraftMinIntervalMs) return this.answerHost("Please wait a moment before drafting another Mission.", turn);
    // T12 RES-01: counted from canonical state. The recency window of the facts never holds every waiting draft.
    const waiting = port.pendingVoiceDrafts
      ? port.pendingVoiceDrafts()
      : port.facts().missions.filter((mission) => mission.origin?.startsWith("voice:") && AWAITING_REVIEW.includes(mission.status)).length;
    if (waiting >= VOICE_LIMITS.maxPendingVoiceDrafts) return this.answerHost(`${VOICE_LIMITS.maxPendingVoiceDrafts} voice Missions are already waiting for review on the Windows Host screen. Review them there first.`, turn);
    const project = this.resolveProject(objective);
    if (project.names.length > 1) return this.answerHost(`I found several projects: ${project.names.join(", ")}. Say it again with the project name.`, turn);
    this.lastDraftAt = now;
    const epoch = this.sessionEpoch;
    let draft: { id: string; title: string; state: string };
    try {
      draft = await port.draftMission({ objective, projectId: project.projectId });
    } catch {
      this.deps.journal("voice.error", "Mission draft refused; nothing was created.");
      if (epoch === this.sessionEpoch) this.answerHost(DRAFT_REFUSAL, turn);
      return;
    }
    if (epoch !== this.sessionEpoch) {
      this.deps.journal("voice.turn", "Mission draft created; the voice session closed before it was spoken.");
      return;
    }
    this.deps.journal("voice.mission_draft", `Mission draft ${draft.id} created (${draft.state}).`);
    if (!AWAITING_REVIEW.includes(draft.state)) return this.answerHost(DRAFT_REFUSAL, turn);
    this.setReferent("missions", [draft.id], draft.id);
    this.setUi("open_agentic", null);
    const sentence = `I drafted a Mission: ${draft.title}. It is waiting for review on the Windows Host screen. I can't approve or start it by voice.`;
    this.answerHost(project.projectId ? sentence : `${sentence} It uses the default workspace, because no project name matched.`, turn);
  }

  /** The Project a draft names: exactly one registered Project whose name words all appear in the objective. */
  private resolveProject(objective: string): { projectId: string | null; names: string[] } {
    const words = new Set(objective.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    const matches = (this.deps.agents.projects?.() ?? []).filter((project) => {
      const tokens = project.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      return tokens.length > 0 && tokens.every((token) => words.has(token));
    });
    if (matches.length > 1) return { projectId: null, names: matches.map((project) => project.name) };
    return { projectId: matches[0]?.id ?? null, names: [] };
  }

  /**
   * T12 F4: a follow-up about the last Host-facts subject. The subject is resolved from live rows only. One candidate is
   * answered; several are asked about by name; no referent is a general status answer; a name that is no Host subject is a chat.
   */
  private async handleFollowUp(intent: VoiceIntent, turn: string, transcript: string) {
    const focus = intent.focus ?? "finished";
    const facts = this.deps.agents.facts();
    const referent = this.liveReferent();
    if (!referent) {
      if (intent.target) {
        const named = this.subjectsNamed(facts, intent.target);
        if (named.length === 1) return this.speakFollowUp(focus, named[0], turn);
        if (named.length > 1) return this.askWhich({ purpose: "followup", focus }, named.map(subjectCandidate), turn);
        // A name that is no Host subject, with no earlier Host answer in view, is an ordinary question.
        return this.chat(transcript, turn);
      }
      if (intent.ordinal !== null) return this.answerHost("I'm not sure which one you mean. Ask about an agent or mission by name.", turn);
      return this.answerHost(this.hostAnswer(focus === "verification" ? "agent_verification" : "agent_status"), turn);
    }
    if (intent.ordinal !== null) {
      const id = referent.ids[intent.ordinal - 1];
      if (!id) return this.answerHost("There is no one with that number in the last answer.", turn);
      const subject = subjectFor(facts, id);
      if (!subject) return this.answerHost("That one is no longer on the Host.", turn);
      return this.speakFollowUp(focus, subject, turn);
    }
    const listed = referent.ids.map((id) => subjectFor(facts, id)).filter((subject): subject is FollowUpSubject => subject !== null);
    if (intent.target) {
      const wanted = intent.target.toLowerCase();
      const inList = listed.filter((subject) => subjectName(subject).toLowerCase() === wanted);
      const pool = inList.length > 0 ? inList : this.subjectsNamed(facts, intent.target);
      if (pool.length === 1) return this.speakFollowUp(focus, pool[0], turn);
      if (pool.length > 1) return this.askWhich({ purpose: "followup", focus }, pool.map(subjectCandidate), turn);
      return this.answerHost(`I can't find ${intent.target} in the last answer.`, turn);
    }
    if (listed.length === 0) return this.answerHost("Nothing from the last answer is still on the Host.", turn);
    if (listed.length === 1) return this.speakFollowUp(focus, listed[0], turn);
    return this.askWhich({ purpose: "followup", focus }, listed.map(subjectCandidate), turn);
  }

  private speakFollowUp(focus: string, subject: FollowUpSubject, turn: string) {
    const id = subjectCandidate(subject).id;
    if (!this.liveReferent()) this.setReferent(subject.kind === "agent" ? "agents" : "missions", [id], subject.kind === "agent" ? subject.agent.missionId : id);
    this.answerHost(answerFollowUp(focus, subject), turn);
  }

  /** Subjects (Agents and Missions) whose name is exactly the spoken name, from live rows. */
  private subjectsNamed(facts: { agents: AgentFact[]; missions: MissionFact[] }, name: string): FollowUpSubject[] {
    const wanted = name.toLowerCase();
    const ids = [...facts.agents.filter((agent) => agent.name.toLowerCase() === wanted).map((agent) => agent.id), ...facts.missions.filter((mission) => mission.title.toLowerCase() === wanted).map((mission) => mission.id)];
    return ids.map((id) => subjectFor(facts, id)).filter((subject): subject is FollowUpSubject => subject !== null);
  }

  /** The last Host-facts list, while it is within referentTtlMs and was named under this Host epoch. */
  private liveReferent(): Referent | null {
    const referent = this.referent;
    if (!referent) return null;
    if (referent.hostEpoch !== this.deps.hostEpoch || this.now() - referent.at > VOICE_LIMITS.referentTtlMs) {
      this.referent = null;
      return null;
    }
    return referent;
  }

  /** Records the ids a Host-facts answer named, in spoken order. Ids only: the state is always read again from live rows. */
  private setReferent(kind: Referent["kind"], ids: string[], missionId: string | null) {
    if (ids.length === 0) return;
    this.referent = { kind, ids: [...ids], missionId, at: this.now(), hostEpoch: this.deps.hostEpoch };
  }

  /** Team answers name the Agents that are working (counts and roles) or the Mission they describe. */
  private rememberTeamReferent(question: string, facts: { agents: AgentFact[]; missions: MissionFact[] }) {
    if (question === "count" || question.startsWith("role:")) {
      const role = question.startsWith("role:") ? question.slice(5) : null;
      const ids = facts.agents
        .filter((agent) => !isTerminalAgent(agent.state) && (role ? agent.role === role : agent.role && agent.role !== "coordinator"))
        .map((agent) => agent.id);
      this.setReferent("agents", ids, null);
      return;
    }
    const newest = [...facts.missions].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (newest) this.setReferent("missions", [newest.id], newest.id);
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
    // A Mission proposal's id is a Mission id, not an agent row: its own port checks it when it runs.
    if (proposal.subject !== "mission") {
      const row = this.deps.agents.rows().find((item) => item.id === proposal.agentId);
      if (!row || row.revision !== proposal.revision || isTerminalAgent(row.state)) {
        this.deps.journal("voice.control_refused", "Agent changed since the proposal; not executed.");
        this.speakAnswer(`${proposal.agentName} changed while I was waiting. Ask me again to ${proposal.action.split(".")[1]} it.`, "host_facts", speakTurn);
        return;
      }
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
    if (proposal.action === "mission.stop") {
      // T12 F2: a Mission stop goes through its own canonical port, never the agent command. Without that port it is refused truthfully.
      const port = this.deps.agents;
      if (!port.missionStop) {
        this.deps.journal("voice.control_refused", "Mission stop is not available by voice; not executed.");
        if (current()) this.answerHost("I can't stop a Mission by voice here. Use the Windows Host screen.", turn);
        return;
      }
      const known = this.missionById(proposal.agentId);
      if (!known || MISSION_OVER.includes(known.status)) {
        this.deps.journal("voice.control_refused", "Mission changed since the proposal; not executed.");
        if (current()) this.answerHost(`${proposal.agentName} is no longer running. Nothing was changed.`, turn);
        return;
      }
      try {
        await port.missionStop(proposal.agentId);
      } catch {
        this.deps.journal("voice.error", "Mission stop refused.");
        if (current()) this.answerHost(`I couldn't stop ${proposal.agentName}. It was not changed.`, turn);
        return;
      }
      if (!current()) return;
      // Confirmed from the canonical Mission record, never from the request alone.
      const row = this.missionById(proposal.agentId);
      if (row?.status === "stopped") this.answerHost(`The mission ${proposal.agentName} is stopped.`, turn);
      else this.answerHost(`I asked for that, but the mission ${proposal.agentName} shows ${row ? humanState(row.status) : "no current state"}. I'm not sure it stopped.`, turn);
      return;
    }
    const before = this.deps.agents.rows().find((item) => item.id === proposal.agentId);
    if (!before || before.revision !== proposal.revision || isTerminalAgent(before.state)) {
      this.deps.journal("voice.control_refused", "Agent changed since the proposal; not executed.");
      if (current()) this.speakAnswer(`${proposal.agentName} changed while I was waiting. Ask me again to ${proposal.action.split(".")[1]} it.`, "host_facts", turn);
      return;
    }
    try {
      await this.deps.agents.command(proposal.action, proposal.agentId, proposal.revision);
    } catch {
      this.deps.journal("voice.error", `Agent command refused (${proposal.action}).`);
      if (current()) this.speakAnswer(`I couldn't ${proposal.action.split(".")[1]} ${proposal.agentName}. It was not changed.`, "host_facts", turn);
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
      .map((item) => `User: ${item.user}\n${item.host ? "Assistant (Host facts, not a model answer)" : "Assistant"}: ${item.assistant}`)
      .join("\n");
    const prompt = [
      SPOKEN_CHAT_INSTRUCTION,
      history,
      `User: ${transcript}`,
    ].filter(Boolean).join("\n\n");
    // T12 RES-04 (round 2): a repeat of a question that already waits for review adds no row; the same refusal is spoken.
    const collapseKey = voiceCollapseKey(transcript);
    if (this.waitingVoiceCount() > 0 && [...this.waitingVoiceTasks.values()].includes(collapseKey)) {
      this.deps.journal("voice.turn", "Spoken question not submitted: the same question already waits for review.");
      this.speakAnswer(TOOLS_TEXT, "refusal", turn);
      return;
    }
    // T12 RES-04: once the spoken questions already waiting on the Host screen reach the cap, nothing new is submitted.
    if (this.waitingVoiceCount() >= VOICE_LIMITS.maxWaitingVoiceTasks) {
      this.deps.journal("voice.turn", "Spoken question not submitted: voice questions already wait for review.");
      this.speakAnswer(WAITING_VOICE_TASKS_TEXT, "refusal", turn);
      return;
    }
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
      if (task.state === "waiting_for_approval") this.waitingVoiceTasks.set(task.taskId, collapseKey);
      this.speakAnswer(TOOLS_TEXT, "refusal", turn);
      return;
    }
    try {
      this.deps.chat.admit(task.taskId);
    } catch {
      this.waitingVoiceTasks.set(task.taskId, collapseKey);
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

  /**
   * T12 RES-04: how many spoken questions this session refused and that still wait for review. A reviewed or finished task
   * leaves the count (its canonical state is read here). Without the port's state, the count is kept, never guessed down.
   */
  private waitingVoiceCount(): number {
    const chat = this.deps.chat;
    if (chat.taskState) {
      for (const id of [...this.waitingVoiceTasks.keys()]) if (chat.taskState(id) !== "waiting_for_approval") this.waitingVoiceTasks.delete(id);
    }
    return this.waitingVoiceTasks.size;
  }

  /**
   * T12 RES-04 (round 2): closing voice stops only the spoken questions this session submitted that still wait for review.
   * Agents, Missions and anything the user already reviewed are untouched. Without the port's canonical state the task is
   * kept, never guessed as waiting, so a reviewed task is never cancelled.
   */
  private cancelWaitingVoiceTasks() {
    const chat = this.deps.chat;
    for (const id of [...this.waitingVoiceTasks.keys()]) {
      if (!chat.taskState || chat.taskState(id) !== "waiting_for_approval") continue;
      void Promise.resolve().then(() => chat.stop(id)).catch(() => undefined);
    }
    this.waitingVoiceTasks.clear();
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
        for (const chunk of current.chunker.push(event.text)) this.sendModelChunk(current, chunk);
        if (this.snap.timing && this.snap.timing.firstTokenAt === null) this.snap.timing = { ...this.snap.timing, firstTokenAt: this.now() };
        this.touch();
        return;
      }
      this.finishInference(current, event.state);
    });
    this.cancelInferenceTimer = this.schedule(() => {
      this.cancelInferenceTimer = null;
      if (this.inference === current) {
        this.bargeIn("timeout", "inference_timeout");
        this.speakAnswer("That took too long, so I stopped it.", "refusal", this.newTurn("ctl"));
      }
    }, VOICE_LIMITS.inferenceTimeoutMs);
  }

  /**
   * T12 live: model text is spoken only while it makes no claim that Bunny acted. The first claiming sentence is replaced by
   * the truthful refusal and the rest of that answer is dropped (the tool-free model cannot have acted).
   */
  private sendModelChunk(current: Inference, chunk: SpokenChunk) {
    if (current.claimBlocked) return;
    if (claimsAction(chunk.text)) {
      current.claimBlocked = true;
      this.deps.journal("voice.turn", "A spoken answer claimed an action the voice model cannot take; it was replaced.");
      this.sendChunk(current, { ...chunk, text: SPOKEN_ACTION_CLAIM_TEXT });
      return;
    }
    this.sendChunk(current, chunk);
  }

  private sendChunk(current: { turn: string; gen: number; spoken: string[] }, chunk: SpokenChunk) {
    this.outstanding += 1;
    current.spoken.push(chunk.text);
    this.rememberSpoken(current.turn, current.gen, chunk.seq, chunk.text);
    this.tryWorker({ op: "speak", turn: current.turn, gen: current.gen, seq: chunk.seq, text: chunk.text, device: -1, voice: null });
    this.noteDuplexActivity();
  }

  private finishInference(current: Inference, state: string) {
    // H8: a non-streaming provider delivered no deltas but recorded a final output: speak it, bounded, through the chunker.
    if (!current.received && state === "completed") {
      const final = this.deps.chat.output?.(current.taskId)?.trim();
      if (final) for (const chunk of current.chunker.push(final)) this.sendModelChunk(current, chunk);
    }
    for (const chunk of current.chunker.end()) this.sendModelChunk(current, chunk);
    current.done = true;
    this.releaseInference(current);
    const answer = current.spoken.join(" ");
    if (answer) {
      this.history.push({ user: this.snap.finalTranscript ?? "", assistant: answer.slice(0, 600) });
      while (this.history.length > VOICE_LIMITS.maxHistoryTurns) this.history.shift();
      // A replaced claim is the Host's sentence, not the model's.
      this.setAnswer(answer, current.claimBlocked ? "refusal" : "model");
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

  /**
   * Barge-in: advance the generation, cancel the worker's speech, stop the voice turn's own inference, drop queued chunks.
   * T12: a held reply is cleared here and its barge-in receipt records the interruption.
   */
  private bargeIn(source: InterruptSource, reason: string = source) {
    const oldGen = this.snap.generation;
    const oldTurn = this.snap.turnId ?? "none";
    const wasPlaying = this.snap.playing || this.hold !== null;
    const hadInference = this.inference !== null;
    this.snap.generation += 1;
    this.tryWorker({ op: "speak.cancel", gen: oldGen });
    this.forgetUnplayed(oldTurn, oldGen);
    this.endSpokenPlayback(oldTurn, oldGen);
    this.clearHold("interrupted", reason);
    const stopping = hadInference ? this.stopInference() : null;
    this.outstanding = 0;
    this.snap.playing = false;
    this.snap.answer = null;
    this.snap.answerSource = null;
    const receipt = this.recordInterrupt(source, null, wasPlaying, oldTurn, oldGen, stopping !== null);
    if (stopping) void stopping.then((ok) => this.acknowledgeInferenceStop(receipt, ok === true));
    this.setState("INTERRUPTED");
    this.deps.journal("voice.interrupted", `Speech interrupted (${source}).`);
  }

  private recordInterrupt(source: InterruptSource, inferenceStopped: boolean | null, wasPlaying: boolean, turn: string, gen: number, requested = false): VoiceInterruptReceipt {
    const inferenceCancellation: VoiceInterruptReceipt["inferenceCancellation"] = inferenceStopped === null ? (requested ? "requested" : "not_requested") : inferenceStopped ? "acknowledged" : "failed";
    const receipt: VoiceInterruptReceipt = {
      turnId: turn,
      gen,
      requestedAt: this.now(),
      source,
      workerResetMs: null,
      meterSilentMs: null,
      droppedChunks: 0,
      inferenceStopped,
      inferenceCancellation,
      lateEventsDropped: this.lateEventsDropped,
      wasPlaying,
    };
    this.snap.lastInterrupt = receipt;
    return receipt;
  }

  /**
   * A late inference-stop answer. The receipt is updated only while it is still the current object. A receipt that a newer
   * barge-in replaced is not lost: the acknowledgment is journaled either way.
   */
  private acknowledgeInferenceStop(receipt: VoiceInterruptReceipt, ok: boolean) {
    if (this.snap.lastInterrupt === receipt) {
      receipt.inferenceStopped = ok;
      receipt.inferenceCancellation = ok ? "acknowledged" : "failed";
      this.touch();
    }
    this.deps.journal("voice.interrupted", `Inference stop ${ok ? "acknowledged" : "failed"} for an earlier interrupt.`);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Held reply, echo gate and the hands-free grant (T12)
  // -------------------------------------------------------------------------------------------------------------

  /** Output in progress: own speech in flight, playing, held, queued, or still streaming from the model. */
  private outputActive(): boolean {
    return hasSpeechInFlight(this.fsm.state) || this.snap.playing || this.hold !== null || this.inference !== null || this.outstanding > 0;
  }

  /** Pauses the reply on speech onset (reversible). Only transcript-grade evidence decides whether it is cancelled. */
  private holdOutput(input: InputTurn, event: { onsetMono?: number; mono: number }) {
    const turn = this.snap.turnId;
    if (!turn) return;
    if (this.hold) {
      // A newer input turn that takes the floor during an existing pause takes over its ownership; an older one never does.
      if (input.gen > this.hold.inputGen) {
        this.hold.inputTurn = input.turn;
        this.hold.inputGen = input.gen;
        if (this.snap.lastBargeIn?.gen === this.hold.gen) this.snap.lastBargeIn = { ...this.snap.lastBargeIn, inputTurnId: input.turn };
      }
      return;
    }
    const hold: Hold = { turn, gen: this.snap.generation, inputTurn: input.turn, inputGen: input.gen, cancelResume: null, cancelMax: null };
    this.hold = hold;
    this.snap.lastBargeIn = {
      inputTurnId: input.turn,
      outputTurnId: turn,
      gen: hold.gen,
      onsetMono: typeof event.onsetMono === "number" ? event.onsetMono : null,
      detectMono: event.mono,
      pauseRequestMono: null,
      silentMono: null,
      detectionToSilenceMs: null,
      onsetToSilenceMs: null,
      wasAudible: null,
      outcome: "pending",
      reason: "speech_onset_during_output",
      decidedAt: null,
      echoRejected: 0,
    };
    this.tryWorker({ op: "speak.pause", gen: hold.gen, on: true });
    this.snap.playing = false;
    // A reply is never held longer than heldMaxMs: past it the old answer is cancelled, not resumed stale.
    hold.cancelMax = this.schedule(() => {
      hold.cancelMax = null;
      if (this.hold === hold) this.bargeIn("acoustic", "held_too_long");
    }, VOICE_LIMITS.heldMaxMs);
    this.armHoldResume();
    this.deps.journal("voice.turn", "Reply held while the user speaks.");
  }

  /** The resume deadline runs from the most recent speech activity, so it is re-armed by every onset and audible level. */
  private armHoldResume() {
    const hold = this.hold;
    if (!hold) return;
    hold.cancelResume?.();
    hold.cancelResume = this.schedule(() => {
      hold.cancelResume = null;
      if (this.hold !== hold) return;
      // T12 live finding (human trial 4): a short question is decoded 1.5-3 s after it ends, later than this deadline, so the
      // old answer resumed over the user before their words were known. Real speech (not a short burst) whose recognition has
      // not reported yet keeps the reply held; its final, its none, or heldMaxMs decides. A cough or click still resumes here.
      if (this.awaitingRecognition(hold)) return;
      this.resumeHeld("no_interrupt_evidence");
    }, VOICE_LIMITS.heldResumeMs);
  }

  /** Whether the hold's owning input turn spoke for real (beyond a short burst) and its recognition has not reported yet. */
  private awaitingRecognition(hold: Hold): boolean {
    const owner = this.inputFor(hold.inputTurn, hold.inputGen);
    if (!owner || owner.dropped || this.finalized.has(owner.turn)) return false;
    return owner.controller.speechMs >= MIN_RECOGNIZED_SPEECH_MS;
  }

  /**
   * RC-05: a held reply ends with the outcome its caller decides. "resumed" continues it: a pause-off on its own generation.
   * "interrupted" cancels it: speak.cancel for the held generation is sent unconditionally, and no pause-off is ever sent first,
   * so the receipt and the device agree. Callers that cancel their own speech (close, mute) rely on this; a stop without an
   * outcome cancels, so a close, mute or error is never recorded as resumed.
   */
  private releaseHeld(reason: string, opts: StopOptions) {
    const hold = this.hold;
    if (!hold) return;
    if (opts.holdOutcome === "resumed") {
      this.resumeHeld(reason);
      return;
    }
    this.tryWorker({ op: "speak.cancel", gen: hold.gen });
    this.clearHold("interrupted", reason);
  }

  /** Resumes a held reply on its own generation. Speech is never cancelled here. */
  private resumeHeld(reason: string) {
    const hold = this.hold;
    if (!hold) return;
    this.clearHold("resumed", reason);
    if (hold.gen === this.snap.generation) this.tryWorker({ op: "speak.pause", gen: hold.gen, on: false });
    this.touch();
  }

  /** Ends the hold and records its outcome on the barge-in receipt, when that receipt is still pending for this output. */
  private clearHold(outcome: "resumed" | "interrupted", reason: string) {
    const hold = this.hold;
    if (!hold) return;
    this.hold = null;
    hold.cancelResume?.();
    hold.cancelResume = null;
    hold.cancelMax?.();
    hold.cancelMax = null;
    this.snap.outputHeld = false;
    const receipt = this.snap.lastBargeIn;
    if (receipt && receipt.outcome === "pending" && receipt.gen === hold.gen && receipt.outputTurnId === hold.turn) {
      this.snap.lastBargeIn = { ...receipt, outcome, reason, decidedAt: this.now() };
    }
  }

  /** The worker's pause receipt: how quickly Bunny's audible output stopped after the onset, measured by the render meter. */
  private recordPauseReceipt(event: Extract<WorkerEvent, { ev: "playback.paused" }>) {
    const receipt = this.snap.lastBargeIn;
    if (!receipt || receipt.gen !== event.gen || receipt.outputTurnId !== event.turn) return;
    const silent = typeof event.silentMono === "number" ? event.silentMono : null;
    this.snap.lastBargeIn = {
      ...receipt,
      pauseRequestMono: typeof event.requestMono === "number" ? event.requestMono : null,
      silentMono: silent,
      wasAudible: typeof event.wasAudible === "boolean" ? event.wasAudible : null,
      detectionToSilenceMs: silent !== null && receipt.detectMono !== null ? silent - receipt.detectMono : null,
      onsetToSilenceMs: silent !== null && receipt.onsetMono !== null ? silent - receipt.onsetMono : null,
    };
  }

  /** Every chunk of Bunny's own speech, kept so that a transcript repeating it can be recognized as echo. */
  private rememberSpoken(turn: string, gen: number, seq: number, text: string) {
    this.spokenLog.push({ turn, gen, seq, tokens: echoTokens(text), sentAt: this.now(), playedAt: null, endedAt: null });
    while (this.spokenLog.length > SPOKEN_LOG_MAX) this.spokenLog.shift();
  }

  /** playback.started reports which chunk is audible now. The chunk stays echo while it plays, and for a window after it stops. */
  private markSpokenPlayed(turn: string, gen: number, seq: number) {
    const entry = this.spokenLog.find((item) => item.turn === turn && item.gen === gen && item.seq === seq && item.playedAt === null);
    if (entry) entry.playedAt = this.now();
  }

  /** A chunk that played to its end (chunk_done): its echo window starts now, not when it started (a long chunk plays for ~25 s). */
  private markSpokenEnded(turn: string, gen: number, seq: number) {
    const entry = this.spokenLog.find((item) => item.turn === turn && item.gen === gen && item.seq === seq && item.endedAt === null);
    if (!entry) return;
    entry.playedAt ??= this.now();
    entry.endedAt = this.now();
  }

  /** Playback of a turn's generation stopped (playback.idle or a barge-in cut): every chunk that had played starts its window now. */
  private endSpokenPlayback(turn: string, gen: number) {
    const now = this.now();
    for (const entry of this.spokenLog) {
      if (entry.turn === turn && entry.gen === gen && entry.playedAt !== null && entry.endedAt === null) entry.endedAt = now;
    }
  }

  /** Chunks that never reported playback were cancelled or drained, so they were not heard and are not echo. */
  private forgetUnplayed(turn: string, gen: number) {
    for (let i = this.spokenLog.length - 1; i >= 0; i -= 1) {
      const entry = this.spokenLog[i];
      if (entry.turn === turn && entry.gen === gen && entry.playedAt === null) this.spokenLog.splice(i, 1);
    }
  }

  /**
   * True when the transcript is mostly Bunny's own recent speech. A played chunk that is still playing never expires; one
   * that stopped counts for echoWindowMs after it stopped. An unplayed chunk is kept longer, since it may still be heard.
   */
  private isEcho(text: string): boolean {
    const now = this.now();
    for (let i = this.spokenLog.length - 1; i >= 0; i -= 1) {
      const entry = this.spokenLog[i];
      const expired = entry.endedAt !== null ? now - entry.endedAt > VOICE_LIMITS.echoWindowMs : entry.playedAt === null && now - entry.sentAt > VOICE_LIMITS.echoWindowMs * 3;
      if (expired) this.spokenLog.splice(i, 1);
    }
    if (this.spokenLog.length === 0) return false;
    // T12 AEC-04: judged per spoken chunk (ordered runs and overlap), never across the union of everything Bunny said.
    return echoMatch(text, this.spokenLog.map((entry) => entry.tokens), VOICE_LIMITS.echoOverlap);
  }

  /**
   * Echo is only possible in a turn that heard Bunny's output: a user who says the words of the proposal sentence in a quiet
   * turn (after playback ended) is not echoing. Overlap is sticky per input turn, so it is checked here, not per event.
   */
  private echoFor(input: InputTurn, text: string): boolean {
    return input.overlapped && this.isEcho(text);
  }

  /** T12 AEC-02: output start and end times, one window per period Bunny's output was in flight. Updated by touch(). */
  private trackOutputWindows() {
    const active = this.outputActive();
    const last = this.outputWindows.at(-1);
    if (active && (!last || last.end !== null)) {
      this.outputWindows.push({ start: this.now(), end: null });
      while (this.outputWindows.length > OUTPUT_WINDOWS_MAX) this.outputWindows.shift();
    } else if (!active && last && last.end === null) {
      last.end = this.now();
    }
  }

  /**
   * T12 AEC-02: an input turn is overlapped when its speech began inside an output window, or within OUTPUT_OVERLAP_TAIL_MS
   * after one ended. A turn armed after Bunny stopped, whose onset is Bunny's own tail, is then echo-gated like the rest.
   */
  private overlapsOutput(onsetAt: number): boolean {
    return this.outputWindows.some((window) => onsetAt >= window.start && (window.end === null || onsetAt <= window.end + OUTPUT_OVERLAP_TAIL_MS));
  }

  /** The Host-clock time a speech onset began: the worker's onset age is subtracted from receipt time; receipt time when absent. */
  private onsetAt(event: { onsetMono?: number; mono?: number }): number {
    const now = this.now();
    if (typeof event.onsetMono === "number" && typeof event.mono === "number" && event.mono >= event.onsetMono) return now - (event.mono - event.onsetMono);
    return now;
  }

  private countEcho(input: InputTurn) {
    const receipt = this.snap.lastBargeIn;
    if (receipt && receipt.inputTurnId === input.turn) receipt.echoRejected += 1;
  }

  /** Records why the duplex lane ended. Only a user stop or a relaunch keeps the grant; everything else revokes it. */
  private recordDuplexStop(reason: DuplexEnd) {
    if (this.snap.duplex) this.snap.duplex.stopped = { reason, at: this.now() };
    if (reason !== "user" && reason !== "relaunch") this.revokeGrant();
    this.deps.journal("voice.duplex", `Hands-free microphone released (${reason}).`);
  }

  /**
   * An explicit user start (listen as hands_free) creates or renews the grant, and only after its validity checks pass.
   * The grant lasts duplexGrantMs; the Host's own timer at its end stops the lane (RES-07), not only the worker's maxMs bound.
   */
  private renewGrant() {
    this.cancelGrantExpiry?.();
    const expiresAt = this.now() + VOICE_LIMITS.duplexGrantMs;
    this.grantExpiresAt = expiresAt;
    this.cancelGrantExpiry = this.schedule(() => {
      this.cancelGrantExpiry = null;
      if (this.grantExpiresAt !== expiresAt) return;
      this.revokeGrant();
      // RES-07: the lane ends with reason "lifetime" while it is live, and a held reply continues (the grant ended, not a barge-in).
      if (this.duplexLane()) this.stopDuplex("lifetime", { holdOutcome: "resumed" });
      this.touch();
    }, VOICE_LIMITS.duplexGrantMs);
    this.touch();
  }

  /** Ends the grant and its expiry timer. A later Start click is the only way back. */
  private revokeGrant() {
    this.cancelGrantExpiry?.();
    this.cancelGrantExpiry = null;
    this.grantExpiresAt = null;
  }

  private grantLive(): boolean {
    return this.grantExpiresAt !== null && this.now() < this.grantExpiresAt;
  }

  /** A duplex start without a live grant is refused: the microphone stays closed and the last stop reason says why. */
  private denyDuplexStart() {
    this.revokeGrant();
    if (this.snap.duplex && !this.snap.duplex.stopped) this.recordDuplexStop("lifetime");
    this.touch();
  }

  /** Worker exit or budget end: the duplex lane, its grant and any held reply end with the worker. */
  private endDuplexWithWorker(reason: DuplexEnd) {
    if (this.duplexLane()) this.recordDuplexStop(reason);
    this.revokeGrant();
    this.clearHold("interrupted", reason);
    this.finishDuplexStop();
  }

  /** The worker's own duplex.stopped reason, mapped onto the Host's receipt set. Anything unrecognized is an error. */
  private workerStopReason(reason: string): DuplexEnd {
    // T12 round 2: the worker's "mute" stop is a mute release, not an error, so the receipt and grant bookkeeping say so.
    if (/^mute$/i.test(reason)) return "mute";
    return /life|max|time/i.test(reason) ? "lifetime" : "error";
  }

  /** Arms or re-arms the idle release: no user speech and no Bunny output for duplexIdleMs releases the microphone. */
  private noteDuplexActivity() {
    if (this.duplexActive()) this.armDuplexIdle();
  }

  private armDuplexIdle() {
    this.cancelDuplexIdle?.();
    this.cancelDuplexIdle = this.schedule(() => {
      this.cancelDuplexIdle = null;
      if (!this.duplexActive() || this.closing) return;
      if (this.input?.speechOpen || this.outputActive()) {
        this.armDuplexIdle();
        return;
      }
      this.stopDuplex("idle");
      this.touch();
    }, VOICE_LIMITS.duplexIdleMs);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Hands-free duplex lane (T12)
  // -------------------------------------------------------------------------------------------------------------

  private duplexActive(): boolean {
    return this.snap.duplex?.active === true;
  }

  /** The duplex lane owns the microphone: starting, live, or still releasing. */
  private duplexLane(): boolean {
    return this.duplexActive() || this.duplexStarting || this.duplexStopping !== null;
  }

  private startDuplex() {
    if (this.duplexStopping) return;
    if (this.duplexActive()) {
      this.armDuplexTurn();
      return;
    }
    if (this.duplexStarting || !this.worker || !this.snap.sessionId || this.snap.muted || this.closing) return;
    // P2: nothing reopens the microphone without a live grant from an explicit user start.
    if (!this.grantLive()) {
      this.denyDuplexStart();
      return;
    }
    if (this.snap.capturing) this.tryWorker({ op: "capture.abort", gen: this.snap.generation });
    if (this.outputActive()) this.bargeIn("new_turn");
    this.duplexStarting = true;
    const session = `${this.snap.sessionId}/${++this.inputSequence}`;
    this.duplexToken = session;
    // The worker's own lifetime bound is the grant's remaining time: the microphone cannot outlive the user's start.
    const remaining = Math.max(1, (this.grantExpiresAt ?? 0) - this.now());
    this.cancelDuplexReady = this.schedule(() => {
      this.cancelDuplexReady = null;
      if (!this.duplexStarting || this.duplexToken !== session) return;
      this.stopDuplex("error");
      this.setError("AEC_UNAVAILABLE", "Echo-cancelled capture did not start. Use push-to-talk.");
    }, VOICE_LIMITS.workerReadyTimeoutMs);
    if (!this.snap.playing && !this.inference) this.setState("ARMING");
    this.tryWorker({ op: "duplex.start", session, maxMs: Math.min(remaining, VOICE_LIMITS.duplexGrantMs) });
    this.touch();
  }

  /**
   * Stops the duplex lane. The microphone truth stays on until the worker acknowledges release. Each input turn is aborted
   * with its own turn and gen, and a held reply is resumed on its own generation. The reason is recorded (a receipt).
   */
  private stopDuplex(reason: DuplexEnd = "user", opts: StopOptions = {}): Promise<void> {
    // Review round 5: a held spoken fragment never outlives its lane (mute, mode switch, error, relaunch, close).
    this.dropFragment(`hands-free stopped (${reason})`);
    if (this.duplexStopping) return this.duplexStopping;
    const token = this.duplexToken;
    if (token !== null) this.recordDuplexStop(reason);
    else if (reason !== "user" && reason !== "relaunch") this.revokeGrant();
    this.cancelDuplexReady?.();
    this.cancelDuplexReady = null;
    this.cancelDuplexIdle?.();
    this.cancelDuplexIdle = null;
    if (!token) {
      this.duplexStarting = false;
      this.touch();
      return Promise.resolve();
    }
    this.duplexStopping = new Promise<void>((resolve) => {
      this.duplexStopResolve = resolve;
    });
    const stopping = this.duplexStopping;
    this.releaseHeld(reason, opts);
    for (const turn of [this.input, ...this.finalizing.values()]) {
      if (!turn) continue;
      turn.cancelDeadline?.();
      turn.cancelDeadline = null;
      this.tryWorker({ op: "capture.abort", gen: turn.gen, turn: turn.turn });
    }
    this.input = null;
    this.finalizing.clear();
    this.duplexStarting = false;
    if (this.snap.duplex) this.snap.duplex.active = false;
    this.snap.inputTurnId = null;
    this.snap.partial = null;
    this.snap.level = null;
    // Keep physical capture truth until release is acknowledged. A stalled COM/driver call settles only this owned worker.
    this.cancelDuplexStop = this.schedule(() => {
      this.cancelDuplexStop = null;
      // A normal close or a settled release is never overwritten by this timer.
      if (this.duplexToken !== token || !this.duplexStopping || this.closingPromise) return;
      this.detach("audio release", async () => {
        await this.close("audio_release_timeout");
        this.setError("AEC_UNAVAILABLE", "Audio release timed out; the owned voice worker was closed. Start voice again.");
      });
    }, 1500);
    this.tryWorker({ op: "duplex.stop", session: token });
    this.touch();
    return stopping;
  }

  /** The worker has released the lane (or is gone): every duplex runtime fact is settled and waiters are released. */
  private finishDuplexStop() {
    this.cancelDuplexStop?.();
    this.cancelDuplexStop = null;
    this.cancelDuplexReady?.();
    this.cancelDuplexReady = null;
    this.cancelDuplexIdle?.();
    this.cancelDuplexIdle = null;
    this.input?.cancelDeadline?.();
    for (const turn of this.finalizing.values()) turn.cancelDeadline?.();
    this.input = null;
    this.finalizing.clear();
    this.duplexToken = null;
    this.duplexStarting = false;
    if (this.snap.duplex) this.snap.duplex.active = false;
    this.snap.inputTurnId = null;
    this.snap.capturing = false;
    this.snap.level = null;
    // T12 live: with the lane released nothing is listening, so LISTENING is no longer true. Nothing is re-armed here: only
    // a user start reopens the microphone.
    if (this.fsm.state === "LISTENING") {
      this.setState("IDLE");
      if (this.snap.muted) this.setState("MUTED");
    }
    const resolve = this.duplexStopResolve;
    this.duplexStopResolve = null;
    this.duplexStopping = null;
    resolve?.();
  }

  /**
   * Arms the next input turn on the duplex lane. Arming happens as soon as the previous turn's capture ends (VT-08), so the
   * microphone never waits for recognition. With `afterTurn`, a soft-budget relaunch may run first at a safe point.
   */
  private armDuplexTurn(afterTurn = false) {
    if (!this.duplexActive() || this.snap.muted || this.closing || !this.worker) return;
    if (afterTurn && this.needsDuplexRelaunch()) {
      this.relaunchDuplex();
      return;
    }
    if (this.input) return;
    const gen = ++this.inputSequence;
    const turn = `input-${gen}-${randomUUID().slice(0, 8)}`;
    this.input = {
      turn,
      gen,
      timing: { ...emptyTiming(turn, this.now()), source: "hands_free", endpointing: "vad" },
      controller: new VoiceTurnTaking(),
      overlapped: false,
      speechOpen: false,
      dropped: false,
      cancelDeadline: null,
    };
    this.snap.inputTurnId = turn;
    this.snap.partial = null;
    if (this.fsm.state === "IDLE") this.setState("ARMING");
    // Not re-armed here: a silent turn ends on its own (no speech) and re-arming per turn would keep a quiet room open forever.
    this.tryWorker({ op: "capture.start", turn, gen, device: -1, endpointing: "vad", maxMs: VOICE_LIMITS.maxTurnCaptureMs, duplex: true, session: this.duplexToken ?? undefined });
  }

  /** A safe point for a soft-budget relaunch: no speech, no recognition, no output, no inference. */
  private needsDuplexRelaunch(): boolean {
    return (
      !!this.worker &&
      this.worker.stdinBytes > this.softBudget &&
      !this.input?.speechOpen &&
      this.finalizing.size === 0 &&
      !this.snap.playing &&
      this.hold === null &&
      this.outstanding === 0 &&
      this.inference === null &&
      !this.duplexStarting
    );
  }

  /** T12-AUD-06: relaunch the worker during hands-free at a safe point. The grant is kept and the duplex restarts within it. */
  private relaunchDuplex() {
    this.detach("duplex relaunch", async () => {
      const old = this.worker;
      await this.stopDuplex("relaunch", { holdOutcome: "resumed" });
      if (!old || this.closing || !this.snap.open) return;
      this.relaunching = this.doRelaunch(old).finally(() => {
        this.relaunching = null;
      });
      await this.relaunching;
      this.deps.journal("voice.duplex", "Hands-free microphone restarted on a fresh worker (relaunch).");
      if (this.grantLive() && this.snap.open && this.snap.mode === "hands_free" && this.worker) this.startDuplex();
    });
  }

  private applyTurnDecision(decision: TurnDecision) {
    this.snap.turnDecision = { ...decision, at: this.now() };
  }

  /** A partial or a none-class result: barge in, resume, or nothing. Only transcript-grade evidence can interrupt. */
  private applyInputDecision(input: InputTurn, decision: TurnDecision) {
    this.applyTurnDecision(decision);
    this.actOnDecision(input, decision);
  }

  /**
   * Acts on a controller decision for one input turn. The held reply belongs to the input turn that paused it: a finalizing
   * turn may resume or interrupt only while it still owns the hold (or no hold exists), so a late turn can never resume or
   * cancel a newer turn's pause. Returns false when the decision was superseded by a newer hold.
   */
  private actOnDecision(input: InputTurn, decision: TurnDecision): boolean {
    const hold = this.hold;
    if (decision.action === "interrupt") {
      // An older turn never cancels a pause that a newer turn started; a newer turn may cancel the pause it did not start.
      if (hold && input.gen < hold.inputGen) return false;
      this.interruptForInput(decision.reason);
    } else if (decision.action === "resume" || decision.action === "drop") {
      if (hold?.inputTurn === input.turn) this.resumeHeld(decision.reason);
    }
    return true;
  }

  private interruptForInput(reason: string) {
    if (this.outputActive()) this.bargeIn("acoustic", reason);
  }

  /** The input turn for an event: the armed turn, or one still finalizing. Matched by turn and gen, never by one alone. */
  private inputFor(turn: string, gen: number): InputTurn | null {
    if (this.input && this.input.turn === turn && this.input.gen === gen) return this.input;
    const finalizing = this.finalizing.get(turn);
    return finalizing && finalizing.gen === gen ? finalizing : null;
  }

  /** The input turn's capture ended. Its identity stays (bounded) until recognition reports, under its own deadline. */
  private retireInput(input: InputTurn) {
    if (this.input === input) this.input = null;
    this.snap.inputTurnId = null;
    this.finalizing.set(input.turn, input);
    while (this.finalizing.size > FINALIZING_MAX) {
      const oldest = this.finalizing.keys().next().value;
      if (oldest === undefined) break;
      this.finalizing.get(oldest)?.cancelDeadline?.();
      this.finalizing.delete(oldest);
    }
    input.cancelDeadline?.();
    input.cancelDeadline = this.schedule(() => {
      input.cancelDeadline = null;
      this.abandonRecognition(input);
    }, VOICE_LIMITS.transcribeWaitMs);
  }

  /** The input turn leaves the lane: its recognition reported, or the worker acknowledged its abort. */
  private leaveInputLane(input: InputTurn) {
    input.cancelDeadline?.();
    input.cancelDeadline = null;
    if (this.input === input) this.input = null;
    if (this.finalizing.get(input.turn) === input) this.finalizing.delete(input.turn);
    this.snap.inputTurnId = this.input?.turn ?? null;
  }

  /** Aborts the armed input turn with its own turn and gen. The output generation is never named. */
  private abortInput() {
    const input = this.input;
    if (!input) return;
    this.tryWorker({ op: "capture.abort", gen: input.gen, turn: input.turn });
    this.retireInput(input);
  }

  /**
   * T12-AUD-07: recognition overran its deadline. Only this input turn is dropped (capture.abort with its turn and gen), any
   * held reply resumes, and the lane keeps listening. A worker that does not acknowledge within a further 2 s is closed.
   */
  private abandonRecognition(input: InputTurn) {
    if (this.finalizing.get(input.turn) !== input || this.closing) return;
    input.dropped = true;
    this.tryWorker({ op: "capture.abort", gen: input.gen, turn: input.turn });
    this.deps.journal("voice.turn", "Recognition deadline reached; that input turn was dropped.");
    // Only a hold this turn owns is released by its deadline; a newer turn's pause is left to its own evidence.
    if (this.hold?.inputTurn === input.turn) this.resumeHeld("recognition_deadline");
    input.cancelDeadline = this.schedule(() => {
      input.cancelDeadline = null;
      if (this.finalizing.get(input.turn) !== input || this.closing) return;
      this.detach("recognition deadline", async () => {
        await this.close("recognition_timeout");
        this.setError("STT_UNAVAILABLE", "Recognition finalization timed out; voice was released. Start again or use push-to-talk.");
      });
    }, FINALIZE_ACK_MS);
    this.armDuplexTurn(true);
    this.touch();
  }

  private onDuplexInput(event: WorkerEvent) {
    if (!("turn" in event) || !("gen" in event) || typeof event.turn !== "string" || typeof event.gen !== "number") {
      this.lateEventsDropped += 1;
      return;
    }
    const input = this.inputFor(event.turn, event.gen);
    if (!input || this.closing || this.snap.muted) {
      this.lateEventsDropped += 1;
      return;
    }
    // T12 AEC-02: a turn is overlapped when the user's speech was heard while output was audible. Arming and capture events
    // alone do not count: a turn armed while a reply is still being generated would otherwise be overlapped before anyone spoke.
    const heardSpeech = event.ev === "vad" || event.ev === "stt.partial" || event.ev === "stt.final" || event.ev === "stt.none" || (event.ev === "level" && event.speech === true);
    if (heardSpeech && this.outputActive()) input.overlapped = true;
    switch (event.ev) {
      case "capture.started":
        if (input === this.input) {
          input.timing.captureStartedAt = this.now();
          if (this.fsm.state === "ARMING") this.setState("LISTENING");
        }
        break;
      case "capture.first_audio":
        input.timing.firstAudioAt ??= this.now();
        break;
      case "capture.stopped":
        input.timing.captureStopReason = event.reason;
        if (input === this.input) {
          // VT-08: the next input turn is armed now; this turn keeps its identity until its recognition reports.
          this.retireInput(input);
          this.armDuplexTurn(true);
        } else this.leaveInputLane(input);
        break;
      case "vad":
        if (event.state === "speech_start") {
          input.speechOpen = true;
          // T12 AEC-02: an onset inside an output window, or just after one ended, is Bunny's own tail: the turn is overlapped.
          if (this.overlapsOutput(this.onsetAt(event))) input.overlapped = true;
          this.noteDuplexActivity();
          const decision = input.controller.decide({ kind: "speech_start", outputActive: this.outputActive() });
          if (decision?.action === "pause") this.holdOutput(input, event);
          if (decision) this.applyTurnDecision(decision);
          if (this.hold) this.armHoldResume();
        } else if (event.state === "speech_end") {
          input.speechOpen = false;
          input.timing.speechEndAt = this.now();
          const decision = input.controller.decide({ kind: "speech_end", short: event.short === true, outputActive: this.outputActive() });
          if (decision) this.applyInputDecision(input, decision);
        }
        break;
      case "level":
        if (input === this.input) this.snap.level = { rms: clamp01(event.rms), peak: clamp01(event.peak), speech: event.speech, at: this.now() };
        input.controller.decide({ kind: "level", speechMs: event.speechMs ?? 0 });
        if (event.speech && this.hold) this.armHoldResume();
        break;
      case "stt.partial": {
        input.timing.firstPartialAt ??= this.now();
        const echo = this.echoFor(input, event.text);
        if (input === this.input && !echo) this.snap.partial = event.text.slice(0, VOICE_LIMITS.maxTranscriptChars);
        const decision = input.controller.decide({ kind: "partial", text: event.text, echo, outputActive: this.outputActive() });
        if (decision) this.applyInputDecision(input, decision);
        break;
      }
      case "stt.final": {
        // The first final for a turn counts, exactly once, even when the turn is already finalizing (VT-08).
        if (this.finalized.has(input.turn)) {
          this.lateEventsDropped += 1;
          break;
        }
        this.rememberFinal(input.turn);
        const text = event.text.trim().slice(0, VOICE_LIMITS.maxTranscriptChars);
        const confidence = Number.isFinite(event.confidence) ? event.confidence : 0;
        this.leaveInputLane(input);
        if (input.dropped) this.lateEventsDropped += 1;
        else if (text) this.decideFinal(input, text, confidence);
        else this.decideNone(input, "no_speech");
        this.armDuplexTurn(true);
        break;
      }
      case "stt.none":
        if (this.finalized.has(input.turn)) {
          this.lateEventsDropped += 1;
          break;
        }
        this.rememberFinal(input.turn);
        this.leaveInputLane(input);
        this.decideNone(input, event.reason);
        this.armDuplexTurn(true);
        break;
      default:
        break;
    }
    this.touch();
  }

  /** A final transcript from the duplex lane. The controller decides; only an interrupt or an accept reaches Host routing. */
  private decideFinal(input: InputTurn, text: string, confidence: number) {
    const echo = this.echoFor(input, text);
    const decision = input.controller.decide({ kind: "final", text, confidence, echo, outputActive: this.outputActive() });
    if (!decision) return;
    this.applyTurnDecision(decision);
    this.snap.partial = null;
    if (echo) this.countEcho(input);
    // A finalizing turn that was superseded by a newer pause is not routed: its words never cancel the newer turn's speech.
    if (!this.actOnDecision(input, decision)) {
      this.applyTurnDecision({ ...decision, action: "drop", reason: "superseded_by_newer_pause" });
      return;
    }
    if (decision.action === "resume" || decision.action === "drop") return;
    // A capture-state FSM never reaches PROCESSING directly from LISTENING: settle to IDLE first (the answer path then sets PROCESSING).
    if (this.fsm.state !== "PROCESSING" && !canTransition(this.fsm.state, "PROCESSING")) this.setState("IDLE");
    this.snap.turnId = input.turn;
    this.snap.timing = input.timing;
    this.snap.answer = null;
    this.snap.answerSource = null;
    this.onFinalDuplex(text, input.turn, confidence, input);
  }

  private decideNone(input: InputTurn, reason: string) {
    const decision = input.controller.decide({ kind: "none", outputActive: this.outputActive() });
    if (decision) this.applyTurnDecision(decision);
    this.snap.partial = null;
    this.deps.journal("voice.turn", `No speech accepted (${reason}).`);
    if (decision) this.actOnDecision(input, decision);
  }

  private onFinalDuplex(text: string, turn: string, confidence: number, input: InputTurn) {
    // First-final guard is recorded above before any async routing. Only this finalized path can reach Host intents.
    let meta: TurnMeta = { source: "duplex", overlapped: input.overlapped, speechMs: input.controller.speechMs };
    // T12 live re-check: a hesitation after "Prepare a" ended the turn before whisper had any partial text, so the worker's
    // endpointing could not know the sentence was unfinished. A held fragment is joined with the next final here; the joined
    // text is classified from scratch, overlapped if either part was, at the lower confidence of the two.
    const held = this.fragment;
    if (held && classifyTranscript(text, { proposalPending: this.voiceConfirmable() }).kind !== "chat") {
      // Review round 5: a continuation that is itself a stop, a close, a control or a question is routed on its own; the
      // unfinished words before it are dropped, never joined into chat.
      this.dropFragment("the next words were a command or a question of their own");
    } else if (held) {
      this.clearFragment();
      text = `${held.text.replace(/[\s.!?,;:…]+$/, "")} ${text}`.slice(0, VOICE_LIMITS.maxTranscriptChars);
      confidence = Math.min(confidence, held.confidence);
      meta = { source: "duplex", overlapped: meta.overlapped || held.meta.overlapped, speechMs: (meta.speechMs ?? 0) + (held.meta.speechMs ?? 0), fromFragment: true };
      this.deps.journal("voice.turn", "An unfinished spoken sentence was joined with its continuation.");
    } else if (isUnfinishedChat(text, this.voiceConfirmable())) {
      this.holdFragment(text, turn, confidence, meta);
      return;
    }
    this.acceptFinal(text, turn, confidence, meta);
  }

  /**
   * Holds an unfinished sentence (chat-bound, ending on a word that cannot end a sentence) for its continuation. It is
   * routed alone when the user does not start speaking again within FRAGMENT_WAIT_MS, or once FRAGMENT_MAX_MS has passed.
   */
  private holdFragment(text: string, turn: string, confidence: number, meta: TurnMeta) {
    const since = this.now();
    const check = () => {
      const fragment = this.fragment;
      if (!fragment || fragment.turn !== turn) return;
      const speaking = !!this.input?.speechOpen || this.finalizing.size > 0;
      if (speaking && this.now() - since < FRAGMENT_MAX_MS) {
        fragment.cancel = this.schedule(check, 250);
        return;
      }
      this.clearFragment();
      if (this.closing || !this.snap.open) return;
      this.deps.journal("voice.turn", "An unfinished spoken sentence had no continuation; routed as heard.");
      this.snap.turnId = turn;
      this.acceptFinal(text, turn, confidence, { ...meta, fromFragment: true });
    };
    this.fragment = { text, turn, confidence, meta, cancel: this.schedule(check, FRAGMENT_WAIT_MS) };
    this.snap.partial = text.slice(0, VOICE_LIMITS.maxTranscriptChars);
    this.deps.journal("voice.turn", "Waiting for the rest of an unfinished spoken sentence.");
  }

  private dropFragment(reason: string) {
    if (!this.fragment) return;
    this.clearFragment();
    this.snap.partial = null;
    this.deps.journal("voice.turn", `An unfinished spoken sentence was dropped: ${reason}.`);
  }

  private clearFragment() {
    this.fragment?.cancel?.();
    this.fragment = null;
  }

  private onWorkerEvent(event: WorkerEvent) {
    switch (event.ev) {
      case "ready":
        this.duplexSupported = event.duplex?.supported === true;
        this.snap.duplex = freshDuplex(this.duplexSupported, this.snap.duplex?.stopped ?? null);
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
        // A recognizer that failed to load after ready is a notice, not a session failure: the worker keeps running on SAPI.
        if (event.code === "STT_UNAVAILABLE") return this.setSttNotice(event.message);
        return this.setError(event.code, event.message);
      case "speak.cancelled":
        return this.onCancelReceipt(event);
      case "duplex.started": {
        if (!this.duplexStarting || event.session !== this.duplexToken) {
          this.lateEventsDropped += 1;
          return;
        }
        // The worker confirmed the lane after the user's grant may already have lapsed or the mode changed: release it.
        if (this.snap.mode !== "hands_free" || this.snap.muted || this.closing || !this.grantLive()) {
          this.stopDuplex(this.snap.muted ? "mute" : this.closing ? "close" : this.snap.mode !== "hands_free" ? "mode" : "lifetime", { holdOutcome: this.closing || this.snap.muted ? "interrupted" : "resumed" });
          return;
        }
        this.duplexStarting = false;
        this.cancelDuplexReady?.();
        this.cancelDuplexReady = null;
        this.snap.duplex = { ...freshDuplex(true, null), active: true, aec: event.aec, reference: event.reference, fixture: event.fixture, grantExpiresAt: this.grantExpiresAt };
        this.snap.capturing = true;
        this.armDuplexTurn();
        // The idle clock starts with the lane; only speech and output activity re-arm it (noteDuplexActivity).
        this.armDuplexIdle();
        return this.touch();
      }
      case "duplex.error":
        if (event.session !== this.duplexToken) return;
        this.stopDuplex("error");
        if (this.outputActive()) this.bargeIn("host_disconnect", "duplex_error");
        this.setError(event.code, event.message);
        return;
      case "duplex.stopped":
        if (event.session !== this.duplexToken) return;
        // A worker-initiated stop is recorded here; a Host-initiated stop was recorded when it was requested.
        if (!this.duplexStopping) this.recordDuplexStop(this.workerStopReason(event.reason));
        // RC-08: a held reply does not wait for the resume timer once the lane is gone. A lifetime end resumes it; a mute or error end cancels it.
        if (this.hold) this.releaseHeld(this.workerStopReason(event.reason), { holdOutcome: this.workerStopReason(event.reason) === "lifetime" ? "resumed" : "interrupted" });
        this.finishDuplexStop();
        return this.touch();
      default:
        break;
    }
    // A device error on the duplex lane revokes the grant: the microphone stays closed until the user starts hands-free again.
    // RC-05 (decided): a capture error on the duplex lane cancels a held reply and any reply still in flight. The microphone that
    // would judge a barge-in is gone, so a resume would play a reply nobody can interrupt; the cancel is the fail-safe.
    if (event.ev === "capture.error" && this.duplexLane()) {
      this.stopDuplex("error");
      if (this.outputActive()) this.bargeIn("host_disconnect", "capture_error");
      this.setError(event.code, event.message, deviceStateFor(event.code));
      return;
    }
    if ("turn" in event && /^(?:capture\.|stt\.|vad$|level$)/.test(event.ev) && (this.duplexLane() || this.input || this.finalizing.size > 0)) {
      return this.onDuplexInput(event);
    }
    // Generation and turn gate: stale speech, capture or recognition never reaches the state machine.
    if ("gen" in event && typeof event.gen === "number" && event.gen !== this.snap.generation) {
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
        if (this.snap.timing && event.turn === this.snap.timing.turnId) this.snap.timing = { ...this.snap.timing, captureStopReason: String(event.reason ?? "").slice(0, 16) || null };
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
        this.markSpokenPlayed(event.turn, event.gen, event.seq);
        this.noteDuplexActivity();
        // RC-01: the state tracks output in flight, so a chunk that starts during a hold still leaves PROCESSING. Only the
        // audibility flag waits: a held reply is not audible until its resume receipt (playback.paused on:false).
        if (this.fsm.state === "PROCESSING" || this.fsm.state === "SPEAKING") {
          if (!this.hold) this.snap.playing = true;
          this.setState("SPEAKING");
        }
        break;
      case "playback.paused":
        if (event.on) {
          this.snap.playing = false;
          this.recordPauseReceipt(event);
        } else if (!this.hold && this.outstanding > 0 && this.fsm.state === "SPEAKING") {
          // Playing again is true only on the resume receipt, and only while chunks remain to play.
          this.snap.playing = true;
        }
        break;
      case "playback.chunk_done":
        this.outstanding = Math.max(0, this.outstanding - 1);
        this.markSpokenEnded(event.turn, event.gen, event.seq);
        this.noteDuplexActivity();
        break;
      case "playback.idle":
        this.snap.playing = false;
        this.outstanding = 0;
        this.forgetUnplayed(event.turn, event.gen);
        this.endSpokenPlayback(event.turn, event.gen);
        if (this.inference) {
          // Idle between chunks while the answer still streams: wait, do not re-arm (V28).
          if (this.fsm.state === "SPEAKING") this.setState("PROCESSING");
        } else {
          if (this.snap.timing) this.snap.timing = { ...this.snap.timing, completedAt: this.snap.timing.completedAt ?? this.now() };
          // RC-01: a reply that finished playing settles from PROCESSING too, so a stuck state can never keep output "active".
          if (this.fsm.state === "SPEAKING" || this.fsm.state === "PROCESSING") this.settleIdle();
        }
        this.noteDuplexActivity();
        break;
      case "playback.error":
        // RC-02: a hold on the failed generation releases the worker's pause before the hold is dropped. Otherwise the worker keeps
        // pausing every later chunk of that generation, and playback waits forever.
        if (this.hold && event.gen === this.hold.gen) this.tryWorker({ op: "speak.pause", gen: this.hold.gen, on: false });
        // RC-07: chunks that played before the failure end their echo window now; chunks that never played are not heard.
        if (event.turn !== null && event.gen !== null) {
          this.endSpokenPlayback(event.turn, event.gen);
          this.forgetUnplayed(event.turn, event.gen);
        }
        this.snap.playing = false;
        this.outstanding = 0;
        this.clearHold("interrupted", "playback_error");
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
    // In place: the receipt object identity is what lets a late inference-stop acknowledgment find it.
    Object.assign(receipt, {
      workerResetMs: event.resetMs,
      meterSilentMs: event.meterSilentMs,
      droppedChunks: event.droppedChunks,
      wasPlaying: event.wasPlaying,
      lateEventsDropped: this.lateEventsDropped,
    });
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
    this.endDuplexWithWorker("worker_exit");
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
    this.endDuplexWithWorker("budget");
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

  /** Resolves when the FSM leaves TRANSCRIBING, or after `ms` (the caller re-checks the state either way). */
  private waitTranscribed(ms: number): Promise<void> {
    if (this.fsm.state !== "TRANSCRIBING") return Promise.resolve();
    return new Promise((resolve) => {
      let cancel: () => void = () => undefined;
      const done = () => {
        cancel();
        this.transcribedWaiters.delete(done);
        resolve();
      };
      this.transcribedWaiters.add(done);
      cancel = this.schedule(done, ms);
    });
  }

  private setState(to: VoiceState) {
    if (this.fsm.state === to) return;
    if (!tryTransition(this.fsm, to)) return;
    this.snap.state = to;
    if (to !== "TRANSCRIBING" && this.transcribedWaiters.size) for (const wake of [...this.transcribedWaiters]) wake();
    // Truth flags are cleared by any state that is not the confirmed one.
    if (to !== "LISTENING" && !this.snap.duplex?.active && !this.duplexStopping) this.snap.capturing = false;
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

  /** Hands-free only: re-arms after playback ends, never during playback (V28), never mid-answer. Never renews a grant. */
  private maybeRearm() {
    if (this.duplexActive()) {
      this.armDuplexTurn(true);
      return;
    }
    if (this.duplexStarting || this.duplexStopping) return;
    if (this.closing || this.snap.mode !== "hands_free" || !this.snap.open || this.snap.muted || this.fsm.state !== "IDLE") return;
    if (this.inference || this.outstanding > 0 || this.snap.playing || this.hold) return;
    this.cancelRearmTimer();
    this.cancelRearm = this.schedule(() => {
      this.cancelRearm = null;
      // races#5: the callback re-checks the session it was armed in: no close in progress, still hands-free, not muted.
      if (this.closing || !this.snap.open || this.snap.mode !== "hands_free" || this.snap.muted) return;
      if (this.fsm.state === "IDLE" && !this.snap.playing && !this.inference && !this.hold) this.detach("re-arm", () => this.rearmHandsFree());
    }, HANDS_FREE_RESTART_MS);
  }

  /**
   * Internal hands-free re-arm. Nothing reopens the microphone without a live grant from an explicit user start, with or without
   * the duplex lane: after the grant lapses, hands-free waits for the user (the exception to T10 is deliberate; see the report).
   */
  private async rearmHandsFree(): Promise<void> {
    if (!this.grantLive()) {
      this.denyDuplexStart();
      return;
    }
    if (!this.duplexSupported) {
      await this.beginListen("hands_free");
      return;
    }
    this.startDuplex();
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
    this.clearFragment();
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
    this.snap.outputHeld = this.hold !== null;
    this.trackOutputWindows();
    if (this.snap.duplex) {
      this.snap.duplex.starting = this.duplexStarting;
      this.snap.duplex.releasing = this.duplexStopping !== null;
      this.snap.duplex.grantExpiresAt = this.grantLive() ? this.grantExpiresAt : null;
    }
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

/** T12 F3: Mission states in which a voice draft still waits for the workstation's review (nothing has started). */
const AWAITING_REVIEW = ["draft", "planning", "waiting_for_approval"];

/** T12 F4: the canonical record a follow-up names: an Agent (with its Mission when it has one) or a Mission. */
function subjectFor(facts: { agents: AgentFact[]; missions: MissionFact[] }, id: string): FollowUpSubject | null {
  const agent = facts.agents.find((row) => row.id === id);
  if (agent) return { kind: "agent", agent, mission: facts.missions.find((row) => row.id === agent.missionId) ?? null };
  const mission = facts.missions.find((row) => row.id === id);
  return mission ? { kind: "mission", mission } : null;
}

function subjectName(subject: FollowUpSubject): string {
  return subject.kind === "agent" ? subject.agent.name : subject.mission.title;
}

function subjectCandidate(subject: FollowUpSubject): Candidate {
  return subject.kind === "agent" ? { id: subject.agent.id, name: subject.agent.name, revision: 0 } : { id: subject.mission.id, name: subject.mission.title, revision: 0 };
}

/** "A", "A or B", "A, B or C": the spoken alternatives for a pick. */
function orList(names: string[]): string {
  if (names.length <= 2) return names.join(" or ");
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

function uniqueById(rows: Candidate[]): Candidate[] {
  return rows.filter((row, index) => rows.findIndex((other) => other.id === row.id) === index);
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** A duplex snapshot with nothing running. `stopped` carries the last end reason, a receipt that survives close. */
function freshDuplex(available: boolean, stopped: { reason: string; at: number } | null): NonNullable<VoiceSnapshot["duplex"]> {
  return { available, active: false, aec: null, reference: null, fixture: false, releasing: false, starting: false, grantExpiresAt: null, stopped };
}

/** Device-level capture errors leave the session in DEVICE_UNAVAILABLE with the truthful code (V03, V04). */
function deviceStateFor(code: VoiceErrorCode): VoiceState {
  return code === "ENDPOINT_MUTED" || code === "PERMISSION_DENIED" || code === "DEVICE_UNAVAILABLE" || code === "DEVICE_LOST" ? "DEVICE_UNAVAILABLE" : "ERROR";
}
