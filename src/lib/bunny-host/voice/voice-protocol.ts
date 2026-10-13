/**
 * M-A-3 T10: the shared voice contract.
 *
 * Voice is an input/output modality, never an execution authority. Three parties speak this contract:
 *  - the Bunny voice worker (native/voice/BunnyVoiceWorker.cs), a Job-Object-contained executable that alone owns the
 *    microphone and speaker handles, talks JSON lines (one object per line, UTF-8, no BOM);
 *  - the Host VoiceSessionManager (voice-session.server.ts), the only voice state authority;
 *  - the clients (WPF Island, desktop UI), which render `VoiceSnapshot` and send `voice.*` Host actions.
 *
 * Every worker event carries the Host-issued `gen` (cancellation generation). The Host drops any speech, capture or
 * recognition event whose `gen` is older than the session's current generation, so a late callback can never restart
 * stale audio or attach text to the wrong turn.
 */

import type { CompanionState } from "./voice-companion.ts";

export const VOICE_PROTOCOL = "bunny-voice/1" as const;

/** Worker-side identity of an audio endpoint. `index` is the winmm device index; -1 is the Windows default (WAVE_MAPPER). */
export type VoiceDevice = { index: number; name: string; channels?: number };
export type VoiceEndpointState = { name: string | null; muted: boolean | null; volume: number | null; present: boolean };

// ---------------------------------------------------------------------------------------------------------------
// Host -> worker (stdin). Every line is one object; unknown ops are answered with {ev:"error",code:"UNKNOWN_OP"}.
// ---------------------------------------------------------------------------------------------------------------
export type WorkerCommand =
  | { op: "devices" }
  | { op: "duplex.start"; session: string; maxMs: number }
  | { op: "duplex.stop"; session: string }
  /** Open the input device and start recognition for exactly one turn. Refused while playback is active (half duplex). */
  | { op: "capture.start"; turn: string; gen: number; device: number; endpointing: "manual" | "vad"; maxMs: number; duplex?: boolean; session?: string }
  /** Manual end of turn (push-to-talk release): stop capture, flush the recognizer, emit stt.final or stt.none. */
  | { op: "capture.end"; turn: string; gen: number }
  /**
   * Discard the turn: stop capture and recognition, emit no final. T12: when `turn` is given, the worker aborts only the
   * capture whose turn id AND gen match exactly (the duplex input lane has its own ids, separate from output generations).
   */
  | { op: "capture.abort"; gen: number; turn?: string }
  /** Synthesize one ordered chunk and queue it for playback. `seq` starts at 0 per turn and is strictly increasing. */
  | { op: "speak"; turn: string; gen: number; seq: number; text: string; device: number; voice: string | null }
  /** Barge-in: waveOutReset, drop every queued or synthesizing chunk with gen <= `gen`, report measured silence. */
  | { op: "speak.cancel"; gen: number }
  | { op: "speak.pause"; gen: number; on: boolean }
  /** Microphone mute: aborts any capture and refuses capture.start until unmuted. Does not touch Windows settings. */
  | { op: "mute"; on: boolean }
  | { op: "shutdown" };

// ---------------------------------------------------------------------------------------------------------------
// Worker -> Host (stdout). `t` is worker wall-clock epoch ms; `mono` is the worker monotonic clock in ms (Stopwatch),
// used for latency arithmetic inside the worker. The Host stamps its own receipt time too.
// ---------------------------------------------------------------------------------------------------------------
export type VoiceErrorCode =
  | "DEVICE_UNAVAILABLE" // no such device / waveInOpen or waveOutOpen failed
  | "ENDPOINT_MUTED" // the Windows capture endpoint reports mute (read-only observation)
  | "PERMISSION_DENIED" // Windows microphone privacy denies desktop apps
  | "DEVICE_BUSY"
  | "DEVICE_LOST" // device disappeared while open
  | "FORMAT_UNSUPPORTED"
  | "AEC_UNAVAILABLE"
  | "STT_UNAVAILABLE"
  | "TTS_UNAVAILABLE"
  | "BUSY_PLAYBACK" // capture.start while playback active
  | "BUSY_TRANSCRIBING" // listen.start while the previous turn was still being transcribed past the wait bound
  | "MUTED" // capture.start while worker mute is on
  | "BUFFER_LIMIT"
  | "TIMEOUT"
  | "UNKNOWN_OP"
  | "INTERNAL";

export type WorkerEvent = { t: number; mono: number } & (
  | {
      ev: "ready";
      protocol: typeof VOICE_PROTOCOL;
      pid: number;
      stt: { engine: string; recognizer: string | null; culture: string | null; local: true };
      tts: { engine: string; voices: string[]; local: true };
      duplex?: { supported: boolean; backend: string };
    }
  /** `floor`: the measured AEC-processed ambient RMS at start (bounded), carried across the session's input turns. */
  | { ev: "duplex.started"; session: string; aec: string; reference: string; inputId: string | null; outputId: string | null; renderDevice: number; fixture: boolean; floor?: number }
  | { ev: "duplex.stopped"; session: string; reason: string }
  | { ev: "duplex.error"; session: string; code: VoiceErrorCode; message: string }
  | { ev: "devices"; inputs: VoiceDevice[]; outputs: VoiceDevice[]; defaultInput: VoiceEndpointState; defaultOutput: VoiceEndpointState; micPrivacy: "allow" | "deny" | "unknown" }
  | { ev: "device.changed"; defaultInput: VoiceEndpointState; defaultOutput: VoiceEndpointState }
  | { ev: "capture.started"; turn: string; gen: number; device: VoiceDevice; sampleRate: 16000; channels: 1 }
  | { ev: "capture.first_audio"; turn: string; gen: number }
  /**
   * T12 duplex fields (absent on half-duplex turns): `speechMs` accumulated above-threshold speech in this turn; `floor` the
   * bounded ambient estimate; `residual` the AEC-output RMS estimate while the worker's own playback is audible (null when
   * nothing plays); `outputActive` whether the worker's speaker was writing audio during this window.
   */
  | { ev: "level"; turn: string; gen: number; rms: number; peak: number; speech: boolean; speechMs?: number; floor?: number; residual?: number | null; outputActive?: boolean }
  /**
   * T12: `onsetMono` (speech_start) is the worker-monotonic time of the first above-threshold frame of the onset window,
   * i.e. the detected acoustic onset; `speechMs` (speech_end) is the speech duration; `short` marks a burst below the
   * recognition minimum that ends without a decode. `outputActive` reports whether own playback was audible at onset.
   */
  | { ev: "vad"; turn: string; gen: number; state: "speech_start" | "speech_end" | "noise_only" | "no_speech"; onsetMono?: number; speechMs?: number; short?: boolean; outputActive?: boolean }
  | { ev: "stt.partial"; turn: string; gen: number; text: string }
  | { ev: "stt.final"; turn: string; gen: number; text: string; confidence: number }
  | { ev: "stt.none"; turn: string; gen: number; reason: "no_speech" | "noise_only" | "rejected" | "aborted" | "timeout" | "too_short" }
  | { ev: "capture.stopped"; turn: string; gen: number; reason: "end" | "abort" | "vad" | "max" | "mute" | "error" | "shutdown"; bufferedPeakBytes: number }
  | { ev: "capture.error"; turn: string | null; gen: number | null; code: VoiceErrorCode; message: string }
  | { ev: "tts.ready"; turn: string; gen: number; seq: number; audioMs: number; synthMs: number }
  | { ev: "playback.started"; turn: string; gen: number; seq: number }
  /**
   * T12 pause/resume receipt (the acoustic barge-in silence path). `requestMono`: worker-monotonic time the speak.pause
   * command was applied; `silentMono`: when the render endpoint meter read silent after a pause (null when not measured);
   * `meterSilentMs` = silentMono - requestMono; `wasAudible`: the meter was above silence when the pause was applied.
   */
  | { ev: "playback.paused"; turn: string; gen: number; on: boolean; requestMono?: number; silentMono?: number | null; meterSilentMs?: number | null; wasAudible?: boolean }
  | { ev: "playback.chunk_done"; turn: string; gen: number; seq: number }
  | { ev: "playback.idle"; turn: string; gen: number }
  | { ev: "playback.error"; turn: string | null; gen: number | null; code: VoiceErrorCode; message: string }
  /**
   * Barge-in receipt. `resetMs`: elapsed bounded wait for the playback thread's reset acknowledgment, including queue time.
   * `resetPending` true means that wait expired before acknowledgment; it is not a reset-completion measurement.
   * `meterSilentMs`: from the cancel request until the
   * render endpoint peak meter (IAudioMeterInformation) read below the silence threshold, i.e. measured audible stop.
   * `wasPlaying` false means nothing was audible when the cancel arrived.
   */
  | { ev: "speak.cancelled"; gen: number; wasPlaying: boolean; resetMs: number; resetPending?: boolean; meterSilentMs: number | null; droppedChunks: number; /** speak commands dropped since the previous receipt because their gen was already cancelled. */ staleDropped?: number }
  | { ev: "mute"; on: boolean }
  | { ev: "error"; code: VoiceErrorCode; message: string }
  | { ev: "bye" }
);

// ---------------------------------------------------------------------------------------------------------------
// Host session state (the only state clients may render).
// ---------------------------------------------------------------------------------------------------------------
export type VoiceState =
  | "IDLE" // session open, microphone closed, nothing playing
  | "ARMING" // capture requested, device not yet confirmed open
  | "LISTENING" // worker confirmed capture.started (real device open)
  | "TRANSCRIBING" // capture stopped, recognizer finalizing
  | "PROCESSING" // final transcript accepted, answer being produced
  | "SPEAKING" // worker confirmed playback.started and not yet idle/cancelled
  | "INTERRUPTED" // playback was cancelled by the user; next turn available
  | "MUTED"
  | "ERROR"
  | "DEVICE_UNAVAILABLE";

export type VoiceMode = "push_to_talk" | "hands_free";

export type VoiceTurnKind =
  | "chat" // ordinary question -> existing router under local tool-free constraint
  | "agent_status"
  | "agent_verification"
  | "agent_model"
  | "agent_approvals"
  | "agent_last_mission"
  | "agent_team" // M-A-3 T11: team questions (how many working, which agent is testing, what is the planner doing, failures, finished)
  | "agent_control" // pause / resume / stop -> proposal, then canonical agent.* command
  | "mission_control" // T12: "stop the mission" -> screen-confirmed mission.stop proposal (never folded into agent.stop)
  | "mission_draft" // T12: "prepare a plan for X" -> a Mission DRAFT via canonical mission.create; approval/start stay on screen
  | "speech_stop" // T12: "stop", "wait", "be quiet", "stop talking": silences Bunny's speech only; never an Agent or Mission control
  | "agent_followup" // T12: "did it finish?", "what about the second one?": a Host-facts follow-up resolved against the last referent
  | "open_ui" // open Agentic workspace / show results
  | "confirm" // spoken confirmation of a pending voice proposal (pause only)
  | "cancel" // "never mind" / "cancel"
  | "sensitive_refused" // approval, permission, shell, credential, scope, owner claims: never by voice
  | "redirect_unsupported" // free-form Agent Talk/Redirect: explicitly unavailable in T10
  | "voice_close" // T12: "end voice", "stop listening": closes this voice session (capability-reducing only)
  | "device_action_unsupported" // T12: "open notes", "save it on the desktop": voice never acts on the computer
  | "empty";

export type VoiceProposal = {
  id: string;
  action: "agent.pause" | "agent.resume" | "agent.stop" | "mission.stop";
  /** T12: what the proposal acts on. Absent means "agent" (T10 proposals). For "mission", agentId/agentName carry the Mission id/title. */
  subject?: "agent" | "mission";
  agentId: string;
  agentName: string;
  revision: number;
  /** "voice_or_screen": a spoken "confirm" or the on-screen button; "screen": only the workstation on-screen button. */
  confirmVia: "voice_or_screen" | "screen";
  createdAt: number;
  expiresAt: number;
  hostEpoch: string;
};

export type VoiceTiming = {
  turnId: string;
  /** What started the turn ("typed" for a text turn) and how its capture ends: a receipt for live diagnosis, never authority. */
  source?: string;
  endpointing?: "manual" | "vad" | null;
  /** The worker's capture.stopped reason for this turn: "end" (listen.end), "vad", "max" (the cap), "abort", "mute". */
  captureStopReason?: string | null;
  activatedAt: number | null;
  captureStartedAt: number | null;
  firstAudioAt: number | null;
  firstPartialAt: number | null;
  speechEndAt: number | null;
  finalAt: number | null;
  admittedAt: number | null;
  firstTokenAt: number | null;
  firstTtsReadyAt: number | null;
  firstPlaybackAt: number | null;
  /** The routed inference (or Host-facts answer) finished producing text. */
  inferenceCompletedAt: number | null;
  /** The whole turn finished: playback drained (or the answer was delivered as text when TTS failed). */
  completedAt: number | null;
};

export type VoiceInterruptReceipt = {
  turnId: string;
  gen: number;
  requestedAt: number;
  source: "button" | "hotkey" | "push_to_talk" | "mute" | "host_disconnect" | "session_close" | "new_turn" | "acoustic" | "speech_stop" | "timeout";
  workerResetMs: number | null;
  /** Elapsed cancel wait, whether or not the reset was acknowledged. */
  workerCancelWaitMs?: number | null;
  /** Unknown before a receipt, true if the bounded wait expired without reset acknowledgment. */
  workerResetPending?: boolean | null;
  meterSilentMs: number | null;
  droppedChunks: number;
  inferenceStopped: boolean | null;
  /** Canonical stop acknowledgment is not proof that a remote inference server stopped computing. */
  inferenceCancellation?: "not_requested" | "requested" | "acknowledged" | "failed";
  lateEventsDropped: number;
  wasPlaying: boolean;
};

/**
 * T12: one hands-free acoustic barge-in, end to end. Worker-monotonic values (`*Mono`) share one clock, so
 * `detectionToSilenceMs` = silentMono - detectMono is exact; `onsetToSilenceMs` = silentMono - onsetMono adds the onset
 * window. Neither includes the capture pipeline delay before the worker sees a frame; that is measured separately and
 * reported as an estimate, never folded in silently. Null means not measured (e.g. nothing was audible).
 */
export type VoiceBargeInReceipt = {
  inputTurnId: string;
  outputTurnId: string;
  gen: number;
  onsetMono: number | null;
  detectMono: number | null;
  pauseRequestMono: number | null;
  silentMono: number | null;
  detectionToSilenceMs: number | null;
  onsetToSilenceMs: number | null;
  wasAudible: boolean | null;
  /** pending: output is held for the user; resumed: it was a backchannel/noise; interrupted: the old answer was cancelled. */
  outcome: "pending" | "resumed" | "interrupted";
  reason: string;
  decidedAt: number | null;
  /** Transcripts dropped during this input turn because they matched Bunny's own recent speech (echo). */
  echoRejected: number;
};

/**
 * Authority notes: `muted` is the authoritative microphone-mute flag; state "MUTED" is shown only while muted and
 * nothing else is active. `voice.session.open` while a session is open with a different mode switches the mode in place
 * (same session id, same worker). `snapshot.level.at` and every timestamp are Host epoch milliseconds.
 */
export type VoiceSnapshot = {
  protocol: typeof VOICE_PROTOCOL;
  /** False when no session is open: microphone and speaker handles are closed and no worker runs. */
  open: boolean;
  sessionId: string | null;
  hostEpoch: string | null;
  principal: "workstation" | null;
  mode: VoiceMode;
  state: VoiceState;
  /** Real capture truth: the worker confirmed the input device is open for the current turn. */
  capturing: boolean;
  /** Real playback truth: the worker confirmed audio is being written to the output device. */
  playing: boolean;
  /** Independent input identity; turnId/generation continue to identify the conversational output. */
  inputTurnId?: string | null;
  /**
   * T12 hands-free (full-duplex) truth. `active`: the worker confirmed the echo-cancelled microphone is open. `starting`:
   * duplex.start sent, not yet confirmed. `releasing`: stop sent, release not yet acknowledged (capture truth stays on).
   * `grantExpiresAt`: the explicit user start that permits the microphone to be (re)opened; null = no live grant, so
   * nothing reopens the microphone until the user starts hands-free again. `stopped`: why the last duplex session ended
   * ("user", "mute", "idle", "lifetime", "error", "worker_exit", "close", "mode") with its time; a receipt, never authority.
   */
  duplex?: {
    available: boolean;
    active: boolean;
    aec: string | null;
    reference: string | null;
    fixture: boolean;
    releasing?: boolean;
    starting?: boolean;
    grantExpiresAt?: number | null;
    stopped?: { reason: string; at: number } | null;
  };
  /** T12: Bunny's reply is held (paused, not cancelled) while the controller decides whether the user is taking the turn. */
  outputHeld?: boolean;
  turnDecision?: { action: "pause" | "resume" | "interrupt" | "accept" | "drop"; reason: string; speechMs: number; at: number } | null;
  /** T12: the most recent hands-free acoustic barge-in receipt (see VoiceBargeInReceipt). */
  lastBargeIn?: VoiceBargeInReceipt | null;
  muted: boolean;
  /** Last real input level (0..1) with its receipt time; null when not capturing. Clients animate only from this. */
  level: { rms: number; peak: number; speech: boolean; at: number } | null;
  turnId: string | null;
  generation: number;
  partial: string | null;
  finalTranscript: string | null;
  turnKind: VoiceTurnKind | null;
  answer: string | null;
  answerSource: "model" | "host_facts" | "refusal" | null;
  /** Inference route of the current chat turn, as the router reported it. Model may be "UNKNOWN", never invented. */
  route: { taskId: string; provider: string; model: string } | null;
  proposal: VoiceProposal | null;
  clarification: { question: string; candidates: { id: string; name: string }[]; expiresAt: number } | null;
  /** One-shot UI request the clients may honor (open a workspace); carries no authority. */
  uiIntent: { seq: number; kind: "open_agentic" | "open_agent" | "open_approvals"; agentId: string | null } | null;
  devices: { input: VoiceEndpointState | null; output: VoiceEndpointState | null; micPrivacy: "allow" | "deny" | "unknown" };
  engines: { stt: string | null; tts: string | null; local: true };
  error: { code: VoiceErrorCode | "WORKER_EXITED" | "WORKER_INTEGRITY" | "NOT_WINDOWS"; message: string } | null;
  lastInterrupt: VoiceInterruptReceipt | null;
  /** Who ended the last session (a client-declared label such as "button" or "island_exit"); a receipt, never authority. */
  lastClose: { source: string; at: number } | null;
  timing: VoiceTiming | null;
  createdAt: number | null;
  updatedAt: number;
  /** M-A-3 T13: monotonic per-process revision, advanced on every state touch and close, so clients can order snapshots. */
  revision?: number;
  /**
   * M-A-3 T13: a random id of the Host process that wrote this snapshot. A restarted Host starts its revision again, so a
   * client that holds a snapshot from another instance must take the new one whatever its revision says.
   */
  instance?: string;
  /**
   * M-A-3 T13: the companion expression companionState derives from these facts, re-derived at every read. `since` is the
   * instant this state was entered (it holds while the state is unchanged). A change of state advances `revision`.
   */
  companion?: { state: CompanionState; reason: string; since: number };
};

/** Host actions (POST /command). All are workstation-only: none is listed in DEVICE_RIGHTS. */
export const VOICE_ACTIONS = new Set([
  "voice.state",
  "voice.devices",
  "voice.session.open",
  "voice.session.close",
  "voice.listen.start",
  "voice.listen.end",
  "voice.interrupt",
  "voice.mute",
  "voice.text",
  "voice.control.confirm",
  "voice.control.cancel",
]);
/** Voice actions that must work while the Host is degraded: stopping audio and releasing devices never waits. */
export const VOICE_SAFE_ACTIONS = ["voice.state", "voice.interrupt", "voice.mute", "voice.session.close", "voice.control.cancel"] as const;

/** Bounds (§37). */
export const VOICE_LIMITS = {
  maxSessions: 1,
  maxTurnCaptureMs: 30_000,
  /** A listen.start during TRANSCRIBING waits this long for the previous final before it is refused (never a DEVICE_BUSY). */
  transcribeWaitMs: 8_000,
  maxTranscriptChars: 2_000,
  maxSpokenChunkChars: 400,
  maxQueuedChunks: 24,
  maxAnswerChars: 4_000,
  maxHistoryTurns: 6,
  handsFreeIdleMs: 60_000,
  /** T12: an explicit hands-free start grants at most this long; renewal needs a new user start. */
  duplexGrantMs: 30 * 60_000,
  /** T12: with no user speech and no Bunny output for this long, the echo-cancelled microphone is released (grant revoked). */
  duplexIdleMs: 120_000,
  /** T12: a held reply resumes when no interrupt-grade evidence arrives within this long after the last speech activity. */
  heldResumeMs: 1_200,
  /** T12: a reply is never held longer than this; past it the old answer is cancelled rather than resumed stale. */
  heldMaxMs: 6_000,
  /** T12: transcript-to-own-speech token overlap at or above this is treated as echo and dropped. */
  echoOverlap: 0.6,
  /** T12: how far back Bunny's own spoken chunks are kept for the echo comparison. */
  echoWindowMs: 12_000,
  /** T12: spoken Mission drafts are rate-limited; at most this many voice drafts may await review at once. */
  voiceDraftMinIntervalMs: 30_000,
  maxPendingVoiceDrafts: 3,
  /** T12 RES-04: at most this many spoken questions may wait for approval on the Host screen at once; beyond it nothing is submitted. */
  maxWaitingVoiceTasks: 3,
  /** T12: a spoken follow-up ("did it finish?", "the second one") resolves against the last Host-facts subject this long. */
  referentTtlMs: 180_000,
  proposalTtlMs: 30_000,
  clarificationTtlMs: 30_000,
  workerStdinSoftBudget: 384 * 1024, // the F04 interactive budget is 512 KiB cumulative per group; relaunch at idle before it
  workerReadyTimeoutMs: 8_000,
  inferenceTimeoutMs: 60_000,
  /** Recognizer confidence below this is "not heard": Bunny asks again and nothing is routed. */
  minFinalConfidence: 0.15,
  /** Agent controls and spoken confirmations need at least this recognizer confidence (typed turns count as 1). */
  minControlConfidence: 0.4,
} as const;
