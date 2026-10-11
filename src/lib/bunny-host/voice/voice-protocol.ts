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

export const VOICE_PROTOCOL = "bunny-voice/1" as const;

/** Worker-side identity of an audio endpoint. `index` is the winmm device index; -1 is the Windows default (WAVE_MAPPER). */
export type VoiceDevice = { index: number; name: string; channels?: number };
export type VoiceEndpointState = { name: string | null; muted: boolean | null; volume: number | null; present: boolean };

// ---------------------------------------------------------------------------------------------------------------
// Host -> worker (stdin). Every line is one object; unknown ops are answered with {ev:"error",code:"UNKNOWN_OP"}.
// ---------------------------------------------------------------------------------------------------------------
export type WorkerCommand =
  | { op: "devices" }
  /** Open the input device and start recognition for exactly one turn. Refused while playback is active (half duplex). */
  | { op: "capture.start"; turn: string; gen: number; device: number; endpointing: "manual" | "vad"; maxMs: number }
  /** Manual end of turn (push-to-talk release): stop capture, flush the recognizer, emit stt.final or stt.none. */
  | { op: "capture.end"; turn: string; gen: number }
  /** Discard the turn: stop capture and recognition, emit no final. */
  | { op: "capture.abort"; gen: number }
  /** Synthesize one ordered chunk and queue it for playback. `seq` starts at 0 per turn and is strictly increasing. */
  | { op: "speak"; turn: string; gen: number; seq: number; text: string; device: number; voice: string | null }
  /** Barge-in: waveOutReset, drop every queued or synthesizing chunk with gen <= `gen`, report measured silence. */
  | { op: "speak.cancel"; gen: number }
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
    }
  | { ev: "devices"; inputs: VoiceDevice[]; outputs: VoiceDevice[]; defaultInput: VoiceEndpointState; defaultOutput: VoiceEndpointState; micPrivacy: "allow" | "deny" | "unknown" }
  | { ev: "device.changed"; defaultInput: VoiceEndpointState; defaultOutput: VoiceEndpointState }
  | { ev: "capture.started"; turn: string; gen: number; device: VoiceDevice; sampleRate: 16000; channels: 1 }
  | { ev: "capture.first_audio"; turn: string; gen: number }
  | { ev: "level"; turn: string; gen: number; rms: number; peak: number; speech: boolean }
  | { ev: "vad"; turn: string; gen: number; state: "speech_start" | "speech_end" | "noise_only" | "no_speech" }
  | { ev: "stt.partial"; turn: string; gen: number; text: string }
  | { ev: "stt.final"; turn: string; gen: number; text: string; confidence: number }
  | { ev: "stt.none"; turn: string; gen: number; reason: "no_speech" | "noise_only" | "rejected" | "aborted" | "timeout" }
  | { ev: "capture.stopped"; turn: string; gen: number; reason: "end" | "abort" | "vad" | "max" | "mute" | "error" | "shutdown"; bufferedPeakBytes: number }
  | { ev: "capture.error"; turn: string | null; gen: number | null; code: VoiceErrorCode; message: string }
  | { ev: "tts.ready"; turn: string; gen: number; seq: number; audioMs: number; synthMs: number }
  | { ev: "playback.started"; turn: string; gen: number; seq: number }
  | { ev: "playback.chunk_done"; turn: string; gen: number; seq: number }
  | { ev: "playback.idle"; turn: string; gen: number }
  | { ev: "playback.error"; turn: string | null; gen: number | null; code: VoiceErrorCode; message: string }
  /**
   * Barge-in receipt. `resetMs`: time spent inside waveOutReset. `meterSilentMs`: from the cancel request until the
   * render endpoint peak meter (IAudioMeterInformation) read below the silence threshold, i.e. measured audible stop.
   * `wasPlaying` false means nothing was audible when the cancel arrived.
   */
  | { ev: "speak.cancelled"; gen: number; wasPlaying: boolean; resetMs: number; meterSilentMs: number | null; droppedChunks: number; /** speak commands dropped since the previous receipt because their gen was already cancelled. */ staleDropped?: number }
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
  | "open_ui" // open Agentic workspace / show results
  | "confirm" // spoken confirmation of a pending voice proposal (pause only)
  | "cancel" // "never mind" / "cancel"
  | "sensitive_refused" // approval, permission, shell, credential, scope, owner claims: never by voice
  | "redirect_unsupported" // free-form Agent Talk/Redirect: explicitly unavailable in T10
  | "empty";

export type VoiceProposal = {
  id: string;
  action: "agent.pause" | "agent.resume" | "agent.stop";
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
  source: "button" | "hotkey" | "push_to_talk" | "mute" | "host_disconnect" | "session_close" | "new_turn";
  workerResetMs: number | null;
  meterSilentMs: number | null;
  droppedChunks: number;
  inferenceStopped: boolean | null;
  lateEventsDropped: number;
  wasPlaying: boolean;
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
