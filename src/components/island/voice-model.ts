import type {
  VoiceEndpointState,
  VoiceErrorCode,
  VoiceMode,
  VoiceProposal,
  VoiceSnapshot,
  VoiceTurnKind,
} from "../../lib/bunny-host/voice/voice-protocol.ts";

/** A snapshot received this recently is live; older means the poll (or dashboard feed) stopped answering. */
export const VOICE_FRESH_MS = 1500;
export const VOICE_STALE_MS = 5000;
export const VOICE_TYPED_MAX = 2000;
export const VOICE_PRIVACY_NOTE =
  "Voice is processed on this PC by Windows speech (no audio leaves your computer).";
export const VOICE_UNSUPPORTED = "Voice needs the updated Bunny Host.";
export const VOICE_WORKSTATION_ONLY = "Voice runs on the workstation only.";

export type VoiceTone = "idle" | "ok" | "busy" | "warn" | "error";
export type VoiceStatus = { label: string; tone: VoiceTone; live: boolean };

/** A worker/Host error code, as the copy the user sees. Never includes audio or transcript content. */
export function voiceErrorMessage(code: VoiceErrorCode | "WORKER_EXITED" | "WORKER_INTEGRITY" | "NOT_WINDOWS"): string {
  switch (code) {
    case "ENDPOINT_MUTED":
      return "Microphone is muted in Windows";
    case "PERMISSION_DENIED":
      return "Microphone access is off in Windows privacy settings";
    case "DEVICE_UNAVAILABLE":
      return "No microphone is available. Connect one or type your question instead.";
    case "DEVICE_BUSY":
      return "The microphone is in use by another app.";
    case "DEVICE_LOST":
      return "The microphone disconnected. Reconnect it and try again.";
    case "FORMAT_UNSUPPORTED":
      return "This microphone format is not supported.";
    case "STT_UNAVAILABLE":
      return "Speech recognition is unavailable. Type your question instead.";
    case "TTS_UNAVAILABLE":
      return "Spoken replies are unavailable. Answers appear as text.";
    case "BUSY_PLAYBACK":
      return "Bunny is speaking. Interrupt first.";
    case "BUSY_TRANSCRIBING":
      return "Still working out what you said. Try again in a moment.";
    case "MUTED":
      return "Microphone is muted in Bunny.";
    case "BUFFER_LIMIT":
      return "That was too long to hear. Try a shorter question.";
    case "TIMEOUT":
      return "Voice timed out. Try again.";
    case "WORKER_EXITED":
      return "The voice component stopped. Start voice again.";
    case "WORKER_INTEGRITY":
      return "The local voice component failed its integrity check.";
    case "NOT_WINDOWS":
      return "Voice needs Windows.";
    case "UNKNOWN_OP":
    case "INTERNAL":
      return "Voice hit an internal error.";
    default:
      return "Voice hit an error.";
  }
}

export function voiceMuted(snapshot: VoiceSnapshot | null): boolean {
  return !!snapshot && (snapshot.muted || snapshot.state === "MUTED" || snapshot.devices.input?.muted === true);
}

/** Real capture truth: the worker confirmed the device is open and a fresh snapshot says so. */
export function voiceListening(snapshot: VoiceSnapshot | null, receivedAt: number, now: number): boolean {
  return !!snapshot && snapshot.open && snapshot.capturing && now - receivedAt < VOICE_FRESH_MS;
}

/** Real playback truth only: the worker confirmed audio is being written, in a snapshot received fresh. */
export function voiceSpeaking(snapshot: VoiceSnapshot | null, receivedAt: number, now: number): boolean {
  return !!snapshot && snapshot.playing && now - receivedAt < VOICE_FRESH_MS;
}

/**
 * One status line for the whole panel. `supported` false means the Host predates voice; `workstation` false means a
 * paired device, which never runs voice. Order matters: a stale or errored session must not read as "Ready".
 */
export function voiceStatus(input: {
  snapshot: VoiceSnapshot | null;
  receivedAt: number;
  now: number;
  supported: boolean | null;
  workstation: boolean;
}): VoiceStatus {
  const { snapshot, receivedAt, now } = input;
  if (input.supported === false) return { label: VOICE_UNSUPPORTED, tone: "warn", live: false };
  if (!input.workstation) return { label: VOICE_WORKSTATION_ONLY, tone: "idle", live: false };
  if (!snapshot) return { label: "Voice is off", tone: "idle", live: false };
  if (snapshot.open && now - receivedAt > VOICE_STALE_MS)
    return { label: "Reconnecting…", tone: "warn", live: false };
  if (snapshot.error) return { label: voiceErrorMessage(snapshot.error.code), tone: "error", live: false };
  if (snapshot.devices.micPrivacy === "deny")
    return { label: voiceErrorMessage("PERMISSION_DENIED"), tone: "error", live: false };
  if (snapshot.muted || snapshot.state === "MUTED") return { label: voiceErrorMessage("MUTED"), tone: "warn", live: false };
  if (snapshot.devices.input?.muted === true)
    return { label: voiceErrorMessage("ENDPOINT_MUTED"), tone: "warn", live: false };
  if (snapshot.state === "DEVICE_UNAVAILABLE")
    return { label: voiceErrorMessage("DEVICE_UNAVAILABLE"), tone: "error", live: false };
  if (!snapshot.open) return { label: "Voice is off", tone: "idle", live: false };
  if (voiceSpeaking(snapshot, receivedAt, now)) return { label: "Speaking", tone: "busy", live: true };
  if (voiceListening(snapshot, receivedAt, now)) return { label: "Listening…", tone: "ok", live: true };
  switch (snapshot.state) {
    case "ARMING":
      return { label: "Opening microphone…", tone: "busy", live: false };
    case "LISTENING":
      return { label: "Waiting for microphone…", tone: "warn", live: false };
    case "TRANSCRIBING":
      return { label: "Finishing your words…", tone: "busy", live: false };
    case "PROCESSING":
      return { label: "Thinking…", tone: "busy", live: false };
    case "SPEAKING":
      return { label: "Starting speech…", tone: "busy", live: false };
    case "INTERRUPTED":
      return { label: "Interrupted. Ready for your next question.", tone: "idle", live: false };
    case "ERROR":
      return { label: "Voice hit an error.", tone: "error", live: false };
    case "IDLE":
    default:
      return { label: "Ready. Hold the button to talk.", tone: "ok", live: false };
  }
}

/**
 * Level bars come only from the real snapshot level. Freshness is the level's own Host epoch-ms timestamp (level.at)
 * against the local clock, so a poll that keeps answering with an old level cannot keep the bars moving.
 * No level, stale level or not capturing means flat bars.
 */
export function levelBars(snapshot: VoiceSnapshot | null, now: number, count = 9): number[] {
  const level = snapshot?.level;
  if (!snapshot || !snapshot.capturing || !level || now - level.at >= VOICE_FRESH_MS)
    return Array.from({ length: count }, () => 0);
  const base = Math.min(1, Math.max(0, level.peak * 0.7 + level.rms * 0.3));
  return Array.from({ length: count }, (_, i) => {
    const shape = 0.55 + 0.45 * Math.sin(((i + 1) / (count + 1)) * Math.PI);
    return Math.round(Math.min(1, base * shape) * 100) / 100;
  });
}

/** "Answered by ollama · qwen2.5…" or "model unknown" when the router could not name the model. */
export function routeLabel(route: VoiceSnapshot["route"]): string | null {
  if (!route) return null;
  if (route.model === "UNKNOWN") return `Answered by ${route.provider} · model unknown`;
  const model = route.model.length > 32 ? `${route.model.slice(0, 31)}…` : route.model;
  return `Answered by ${route.provider} · ${model}`;
}

export function answerSourceLabel(source: VoiceSnapshot["answerSource"]): string | null {
  switch (source) {
    case "model":
      return "From the model";
    case "host_facts":
      return "From Bunny facts";
    case "refusal":
      return "Not done by voice";
    default:
      return null;
  }
}

/** Partial speech is a draft only: shown while capturing, never executed and never sent. */
export function draftPartial(snapshot: VoiceSnapshot | null): string | null {
  if (!snapshot || !snapshot.partial) return null;
  if (snapshot.state !== "LISTENING" && snapshot.state !== "TRANSCRIBING") return null;
  const text = snapshot.partial.trim();
  return text ? text : null;
}

export type ProposalView = {
  title: string;
  confirmLabel: string;
  hint: string;
  confirmByVoice: boolean;
  proposalId: string;
};

export function proposalView(proposal: VoiceProposal | null, now: number): ProposalView | null {
  if (!proposal || now >= proposal.expiresAt) return null;
  const verb = proposal.action === "agent.pause" ? "Pause" : proposal.action === "agent.resume" ? "Resume" : "Stop";
  const confirmByVoice = proposal.confirmVia === "voice_or_screen";
  return {
    title: `${verb} ${proposal.agentName}?`,
    confirmLabel: `Confirm ${verb.toLowerCase()}`,
    hint: confirmByVoice ? "Say “confirm” or press Confirm." : "Confirm on screen. Voice cannot confirm this.",
    confirmByVoice,
    proposalId: proposal.id,
  };
}

export function clarificationView(
  clarification: VoiceSnapshot["clarification"],
  now: number,
): { question: string; candidates: { id: string; name: string }[] } | null {
  if (!clarification || now >= clarification.expiresAt) return null;
  return { question: clarification.question, candidates: clarification.candidates.slice(0, 8) };
}

export const TURN_KIND_LABEL: Record<VoiceTurnKind, string> = {
  chat: "Question",
  agent_status: "Agent status",
  agent_verification: "Verification",
  agent_model: "Agent model",
  agent_approvals: "Approvals",
  agent_last_mission: "Last mission",
  agent_team: "Agent team",
  agent_control: "Agent control",
  open_ui: "Open view",
  confirm: "Confirmation",
  cancel: "Cancelled",
  sensitive_refused: "Not allowed by voice",
  redirect_unsupported: "Talk/Redirect is not available by voice",
  empty: "No speech heard",
};

/** Explicit, honest copy for turns that heard nothing usable. Silence is never shown as a command. */
export function emptyTurnNote(snapshot: VoiceSnapshot | null): string | null {
  if (!snapshot || snapshot.finalTranscript) return null;
  return snapshot.turnKind === "empty" ? "No speech heard. Nothing was sent." : null;
}

export type VoiceControls = {
  open: boolean;
  startSession: boolean;
  pushToTalk: boolean;
  interrupt: boolean;
  mute: boolean;
  handsFree: boolean;
  endSession: boolean;
  typedSend: boolean;
  muteLabel: string;
};

/**
 * Talk button caption. "Listening" is shown only while the Host confirms capture (live), never from the press flag
 * alone: a held button whose turn the Host already ended on silence must not keep claiming capture.
 */
export function talkButtonLabel(input: { pressed: boolean; live: boolean; bargeIn: boolean }): string {
  if (input.live) return "Listening… release to finish";
  if (input.pressed) return "Keep holding…";
  return input.bargeIn ? "Hold to interrupt and talk" : "Hold to talk, or hold Space";
}

/** Request payloads for the Host voice actions. The keys are the Host contract (http.server.ts voice dispatch). */
export const voiceRequest = {
  confirm: (proposalId: string): { proposalId: string } => ({ proposalId }),
  mute: (on: boolean): { on: boolean } => ({ on }),
} as const;

/** Which controls may act now. Only real states enable talk and interrupt. */
export function voiceControls(input: {
  snapshot: VoiceSnapshot | null;
  receivedAt: number;
  now: number;
  supported: boolean | null;
  workstation: boolean;
  typedText: string;
}): VoiceControls {
  const { snapshot, receivedAt, now } = input;
  const available = input.supported !== false && input.workstation;
  const open = !!snapshot?.open;
  const stale = open && now - receivedAt > VOICE_STALE_MS;
  const deviceBlocked =
    !snapshot ||
    voiceMuted(snapshot) ||
    snapshot.state === "DEVICE_UNAVAILABLE" ||
    snapshot.devices.micPrivacy === "deny";
  const working = snapshot?.state === "TRANSCRIBING" || snapshot?.state === "PROCESSING";
  const fresh = now - receivedAt < VOICE_FRESH_MS;
  return {
    open,
    startSession: available && !open,
    // Push-to-talk is barge-in: holding it while Bunny speaks or thinks makes the Host cancel that turn and listen.
    // Only a device that is blocked or already capturing refuses a press.
    pushToTalk: available && open && !stale && !deviceBlocked && !snapshot?.capturing,
    interrupt: available && open && fresh && (voiceSpeaking(snapshot, receivedAt, now) || snapshot?.state === "PROCESSING"),
    mute: available && open,
    handsFree: available && open,
    endSession: available && open,
    typedSend: available && input.typedText.trim().length > 0 && input.typedText.trim().length <= VOICE_TYPED_MAX && !working,
    muteLabel: voiceMuted(snapshot) ? "Unmute" : "Mute",
  };
}

/** The Host's canonical mode, shown as a toggle. Hands-free is an explicit opt-in only. */
export function handsFreeOn(snapshot: VoiceSnapshot | null): boolean {
  return snapshot?.mode === "hands_free";
}

export function nextVoiceMode(snapshot: VoiceSnapshot | null): VoiceMode {
  return handsFreeOn(snapshot) ? "push_to_talk" : "hands_free";
}

/** Clean a typed fallback before it is sent as voice.text. */
export function typedFallbackText(raw: string): string | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text || text.length > VOICE_TYPED_MAX) return null;
  return text;
}

/** The last uiIntent seq acted on, scoped to the Host epoch that numbered it. */
export type UiSeen = { epoch: string; seq: number } | null;

/**
 * uiIntent is one-shot per seq. The first snapshot a page sees only seeds the seen seq (a stale intent from before a
 * reload must not navigate); later new seqs produce one target. The Host numbers intents per process, so a new Host
 * epoch restarts at seq 1: the seen seq is scoped to its epoch and a new epoch starts from 0, never from the old seq.
 *
 * Destinations: open_agentic and open_agent open the Agentic sheet (focused on agentId when the Host names one).
 * open_approvals also opens the Agentic sheet: there is no approvals sheet, and the per-task Approval view lives on the
 * decision sheet keyed by a task id that the intent does not carry, so it cannot be addressed from here.
 */
export type UiTarget = { sheet: "agentic"; agentFocus: string | null };
export function uiTargetFor(kind: NonNullable<VoiceSnapshot["uiIntent"]>["kind"], agentId: string | null): UiTarget {
  if (kind === "open_approvals") return { sheet: "agentic", agentFocus: null };
  return { sheet: "agentic", agentFocus: agentId };
}
export function planUiIntent(
  intent: VoiceSnapshot["uiIntent"],
  seen: UiSeen,
  epoch: string,
): { seen: UiSeen; target: UiTarget | null } {
  if (seen === null) return { seen: { epoch, seq: intent ? intent.seq : 0 }, target: null };
  const floor = seen.epoch === epoch ? seen.seq : 0;
  if (!intent || intent.seq <= floor) return { seen: { epoch, seq: floor }, target: null };
  return { seen: { epoch, seq: intent.seq }, target: uiTargetFor(intent.kind, intent.agentId) };
}

/** Pure read of a voice payload from an untyped Host reply. Rejects anything not carrying the contract protocol. */
export function parseVoiceSnapshot(value: unknown): VoiceSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<VoiceSnapshot>;
  if (candidate.protocol !== "bunny-voice/1" || typeof candidate.open !== "boolean") return null;
  if (typeof candidate.state !== "string" || !candidate.devices || typeof candidate.devices !== "object") return null;
  return candidate as VoiceSnapshot;
}

/** A newer snapshot replaces the held one; a new Host epoch always replaces it. */
export function acceptVoiceSnapshot(current: VoiceSnapshot | null, next: VoiceSnapshot): boolean {
  if (!current) return true;
  if (current.hostEpoch !== next.hostEpoch) return true;
  return next.updatedAt >= current.updatedAt;
}

/** Truthful output note: playback can be "playing" into a muted or zero-volume Windows endpoint, which is inaudible. */
export function outputNote(snapshot: VoiceSnapshot | null): string | null {
  const output = snapshot?.devices.output;
  if (!output || !output.present) return null;
  if (output.muted === true || output.volume === 0) return "Speakers are muted in Windows. Bunny's replies are shown as text.";
  return null;
}

export function endpointLabel(endpoint: VoiceEndpointState | null): string {
  if (!endpoint) return "Unknown";
  if (!endpoint.present) return "Not present";
  return endpoint.name ?? "Default device";
}
