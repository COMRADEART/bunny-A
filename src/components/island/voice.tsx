import { useEffect, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from "react";
import { Mic, MicOff, Send, Square, Volume2, VolumeX } from "lucide-react";
import { useIsland } from "@/store/use-island";
import { BunnyOrb } from "./motion";
import {
  answerSourceLabel,
  bargeInNote,
  clarificationView,
  draftPartial,
  emptyTurnNote,
  endpointLabel,
  outputNote,
  handsFreeOn,
  handsFreeStatus,
  HANDS_FREE_NOTICE,
  levelBars,
  nextVoiceMode,
  proposalView,
  routeLabel,
  talkButtonLabel,
  VOICE_PRIVACY_NOTE,
  VOICE_TYPED_MAX,
  voiceControls,
  voiceListening,
  voiceStatus,
  voiceSpeaking,
  type VoiceTone,
} from "./voice-model";

const TONE_CLASS: Record<VoiceTone, string> = {
  idle: "",
  ok: "is-ok",
  busy: "is-busy",
  warn: "is-warn",
  error: "is-error",
};

/** A clock that ticks only while a voice session is open, so freshness copy moves without a new Host answer. */
function useVoiceClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * The voice surface. Every visible state is a Host snapshot (or a timestamp derived from one); nothing here captures
 * audio itself. The local Bunny voice worker owns the microphone and speaker through the Host.
 */
export function VoicePanel({ onEnded }: { onEnded?: () => void }) {
  const store = useIsland();
  const voice = store.voice;
  const open = !!voice?.open;
  const now = useVoiceClock(open);
  const [typed, setTyped] = useState("");
  const workstation = store.viewer?.kind !== "device";
  const status = voiceStatus({
    snapshot: voice,
    receivedAt: store.voiceReceivedAt,
    now,
    supported: store.voiceSupported,
    workstation,
  });
  const controls = voiceControls({
    snapshot: voice,
    receivedAt: store.voiceReceivedAt,
    now,
    supported: store.voiceSupported,
    workstation,
    typedText: typed,
  });
  const live = voiceListening(voice, store.voiceReceivedAt, now);
  const speaking = voiceSpeaking(voice, store.voiceReceivedAt, now);
  const bars = levelBars(voice, now);
  const draft = draftPartial(voice);
  const route = routeLabel(voice?.route ?? null);
  const proposal = proposalView(voice?.proposal ?? null, now);
  const clarification = clarificationView(voice?.clarification ?? null, now);
  const emptyNote = emptyTurnNote(voice);
  const speakerNote = outputNote(voice);
  const orb = live ? "listening" : voice?.state === "PROCESSING" ? "routing" : speaking ? "working" : "idle";
  const pressed = store.voicePressing;
  // Holding talk while Bunny speaks or thinks is barge-in: the Host cancels that turn and starts a new capture.
  // A held reply is barge-in too: the hold is cancelled by the user's own speech or Interrupt.
  const bargeIn = speaking || voice?.state === "PROCESSING" || voice?.outputHeld === true;
  const handsFree = handsFreeOn(voice);
  // The caption follows the Host's capture truth, not the press flag: a turn the Host ended on silence stops saying Listening.
  const talkLabel = talkButtonLabel({ pressed, live, bargeIn, handsFree });
  const handsFreeRow = handsFreeStatus(voice);
  const receipt = bargeInNote(voice);

  const pointerStart = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !controls.pushToTalk) return;
    void store.listenStart();
  };
  const pointerEnd = () => {
    void store.listenEnd();
  };
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.repeat) return;
    if (event.key === " ") {
      event.preventDefault();
      if (controls.pushToTalk) void store.listenStart();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (pressed) void store.listenEnd();
      else if (controls.pushToTalk) void store.listenStart();
    }
  };
  const keyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === " ") {
      event.preventDefault();
      void store.listenEnd();
    }
  };
  const submitTyped = (event: FormEvent) => {
    event.preventDefault();
    if (!controls.typedSend) return;
    void store.sendVoiceText(typed);
    setTyped("");
  };
  const endSession = async () => {
    await store.closeVoice();
    onEnded?.();
  };

  if (!open) {
    return (
      <section className="voice-panel t8-surface" aria-label="Voice">
        <BunnyOrb state="idle" large />
        <h2>Voice</h2>
        <p role="status" aria-live="polite" className={`voice-status ${TONE_CLASS[status.tone]}`}>
          {status.label}
        </p>
        {store.voiceNotice ? <p className="voice-notice">{store.voiceNotice}</p> : null}
        <button
          type="button"
          className="btn primary voice-start"
          disabled={!controls.startSession}
          onClick={() => void store.openVoice("push_to_talk")}
        >
          <Mic size={16} aria-hidden="true" />
          Start voice
        </button>
        <p className="voice-privacy">{VOICE_PRIVACY_NOTE}</p>
      </section>
    );
  }

  return (
    <section className="voice-panel t8-surface" aria-label="Voice session">
      <BunnyOrb state={orb} large />
      <p className="voice-device" aria-hidden="true">
        Microphone: {endpointLabel(voice?.devices.input ?? null)}
      </p>
      <button
        type="button"
        className={`voice-talk${pressed ? " is-pressed" : ""}`}
        aria-pressed={pressed}
        aria-label={handsFree ? talkLabel : pressed ? "Release to finish" : "Hold to talk"}
        disabled={handsFree || (!controls.pushToTalk && !pressed)}
        onPointerDown={pointerStart}
        onPointerUp={pointerEnd}
        onPointerCancel={pointerEnd}
        onPointerLeave={pointerEnd}
        onKeyDown={keyDown}
        onKeyUp={keyUp}
        onContextMenu={(event) => event.preventDefault()}
      >
        <Mic size={22} aria-hidden="true" />
        <span>{talkLabel}</span>
      </button>
      <span className={`voice-wave${live ? " is-live" : ""}`} aria-hidden="true">
        {bars.map((value, index) => (
          <i key={index} style={{ height: `${Math.round(value * 100)}%` }} />
        ))}
      </span>
      <p role="status" aria-live="polite" className={`voice-status ${TONE_CLASS[status.tone]}`}>
        {status.label}
      </p>
      {handsFreeRow ? (
        <p className={`voice-status voice-handsfree ${TONE_CLASS[handsFreeRow.tone]}`} aria-label="Hands-free status">
          {handsFreeRow.label}
        </p>
      ) : null}
      {receipt ? <p className="voice-notice" aria-label="Last barge-in">{receipt}</p> : null}
      {store.voiceNotice ? <p className="voice-notice">{store.voiceNotice}</p> : null}
      {draft ? (
        <p className="voice-draft" aria-label="Draft from speech, not sent">
          {draft}
        </p>
      ) : null}
      {voice?.finalTranscript ? (
        <div className="voice-heard">
          <p className="eyebrow">You said</p>
          <p>{voice.finalTranscript}</p>
        </div>
      ) : null}
      {emptyNote ? <p className="voice-notice">{emptyNote}</p> : null}
      {speakerNote ? <p className="voice-notice" role="status">{speakerNote}</p> : null}
      {voice?.answer ? (
        <div className="voice-answer">
          {answerSourceLabel(voice.answerSource) ? (
            <p className="eyebrow">{answerSourceLabel(voice.answerSource)}</p>
          ) : null}
          <p>{voice.answer}</p>
          {route ? <p className="voice-route">{route}</p> : null}
        </div>
      ) : null}
      {voice?.turnKind === "redirect_unsupported" ? (
        <p className="voice-notice">Talk and Redirect are not available by voice.</p>
      ) : null}
      {proposal ? (
        <div className="voice-proposal" role="group" aria-label="Confirm agent change">
          <p>{proposal.title}</p>
          <p className="voice-notice">{proposal.hint}</p>
          <div className="voice-actions">
            <button
              type="button"
              className="btn primary"
              disabled={!store.canAct() || !voice?.proposal}
              onClick={() => voice?.proposal && void store.confirmVoiceProposal(voice.proposal.id)}
            >
              {proposal.confirmLabel}
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => voice?.proposal && void store.cancelVoiceProposal(voice.proposal.id)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {clarification ? (
        <div className="voice-clarify">
          <p>{clarification.question}</p>
          <ul aria-label="Possible agents">
            {clarification.candidates.map((candidate) => (
              <li key={candidate.id}>{candidate.name}</li>
            ))}
          </ul>
          <p className="voice-notice">Type the agent name to choose.</p>
        </div>
      ) : null}
      <div className="voice-actions">
        {controls.handsFreeStartShown ? (
          <button
            type="button"
            className="btn primary"
            disabled={!controls.handsFreeStart}
            onClick={() => void store.startHandsFree()}
          >
            <Mic size={14} aria-hidden="true" />
            Start hands-free
          </button>
        ) : null}
        {controls.finishTurn ? (
          <button type="button" className="btn secondary" onClick={() => void store.finishVoiceTurn()}>
            Finish my turn
          </button>
        ) : null}
        <button
          type="button"
          className="btn secondary"
          disabled={!controls.interrupt}
          onClick={() => void store.voiceInterrupt()}
        >
          <Square size={14} aria-hidden="true" />
          Interrupt
        </button>
        <button
          type="button"
          className="btn secondary"
          aria-pressed={voice?.muted === true}
          disabled={!controls.mute}
          onClick={() => void store.setVoiceMute(!(voice?.muted === true))}
        >
          {voice?.muted ? <VolumeX size={14} aria-hidden="true" /> : <Volume2 size={14} aria-hidden="true" />}
          {controls.muteLabel} microphone
        </button>
        <button
          type="button"
          className="btn secondary"
          aria-pressed={handsFreeOn(voice)}
          disabled={!controls.handsFree}
          onClick={() => void store.setVoiceMode(nextVoiceMode(voice))}
        >
          <MicOff size={14} aria-hidden="true" />
          Hands-free {handsFreeOn(voice) ? "on" : "off"}
        </button>
        <button type="button" className="btn secondary" disabled={!controls.endSession} onClick={() => void endSession()}>
          End session
        </button>
      </div>
      {handsFree ? <p className="voice-notice">{HANDS_FREE_NOTICE}</p> : null}
      <form className="voice-typed" onSubmit={submitTyped}>
        <label className="sr-only" htmlFor="voice-typed-input">
          Type your question instead
        </label>
        <input
          id="voice-typed-input"
          value={typed}
          maxLength={VOICE_TYPED_MAX}
          placeholder="Or type your question"
          onChange={(event) => setTyped(event.target.value)}
        />
        <button type="submit" className="btn secondary" disabled={!controls.typedSend}>
          <Send size={14} aria-hidden="true" />
          Send
        </button>
      </form>
      <p className="voice-privacy">{VOICE_PRIVACY_NOTE}</p>
    </section>
  );
}
