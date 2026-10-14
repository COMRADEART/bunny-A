import { useState } from "react";
import { useIsland } from "@/store/use-island";
import {
  NOTIFICATION_FREQUENCY,
  REPLY_LANGUAGES,
  VERBOSITY,
  type FeedbackRating,
  type NotificationFrequency,
  type ReplyLanguage,
  type SpeakerId,
  type Verbosity,
} from "@/lib/bunny-host/voice/voice-personalization";

const VERBOSITY_LABEL: Record<Verbosity, string> = { brief: "Brief", normal: "Normal", detailed: "Detailed" };
const FREQUENCY_LABEL: Record<NotificationFrequency, string> = { all: "Everything", important: "Only what needs me", none: "None" };
const RATING_LABEL: Record<FeedbackRating, string> = { too_long: "Too long", too_short: "Too short", good: "Just right" };

function usePersonalization() {
  const store = useIsland();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async (action: string, data: Record<string, unknown>, done: string) => {
    setBusy(true);
    setStatus("");
    const result = await store.personalizationCommand(action, data, setStatus);
    setBusy(false);
    if (result) setStatus(done);
  };
  return { store, status, send, disabled: busy || !store.canAct() };
}

const unavailable = (kind: string | undefined) =>
  kind === "device" ? "Voice preferences are set on the workstation (Windows Host)." : "Voice preferences need the updated Bunny Host.";

/**
 * M-A-3 T13.3 Gate G (§21): Settings → Voice. How Bunny and each Personal Agent answer by voice, which installed voice
 * reads each one, and explicit answer ratings. Bunny suggests changes from ratings and interruptions; only the owner
 * applies them. No conversation text or audio is kept for this.
 */
export function VoicePersonalization() {
  const { store, status, send, disabled } = usePersonalization();
  const view = store.voicePersonalization;
  if (!view) return <p className="caption">{unavailable(store.viewer?.kind)}</p>;
  const nameOf = (id: SpeakerId) => view.speakers.find((row) => row.id === id)?.name ?? id;
  const setPreferences = (preferences: Record<string, unknown>, done = "Saved.") => void send("personalization.preferences", { preferences }, done);
  return (
    <>
      <div className="setting-row">
        <div>
          <strong>Bunny's answer length</strong>
          <p>Each Personal Agent answers in its own interaction style, set on its card.</p>
        </div>
        <select aria-label="Bunny's answer length" value={view.preferences.verbosity} disabled={disabled} onChange={(event) => setPreferences({ verbosity: event.target.value })}>
          {VERBOSITY.map((value) => (
            <option key={value} value={value}>
              {VERBOSITY_LABEL[value]}
            </option>
          ))}
        </select>
      </div>
      <div className="setting-row">
        <div>
          <strong>Reply language</strong>
          <p>The language spoken answers use. Speech recognition still uses the recognizer installed on this PC.</p>
        </div>
        <select aria-label="Reply language" value={view.preferences.replyLanguage ?? ""} disabled={disabled} onChange={(event) => setPreferences({ replyLanguage: event.target.value || null })}>
          <option value="">Same as I speak</option>
          {(Object.keys(REPLY_LANGUAGES) as ReplyLanguage[]).map((code) => (
            <option key={code} value={code}>
              {REPLY_LANGUAGES[code]}
            </option>
          ))}
        </select>
      </div>
      {view.speakers.map((speaker) => (
        <div className="setting-row" key={speaker.id}>
          <div style={{ minWidth: 0 }}>
            <strong>{speaker.name}</strong>
            <p>
              {VERBOSITY_LABEL[speaker.verbosity]} answers ({speaker.source === "agent style" ? "from its interaction style" : "your choice above"})
            </p>
          </div>
          <select
            aria-label={`${speaker.name} voice`}
            value={speaker.voice ?? ""}
            disabled={disabled || view.installedVoices.length === 0}
            onChange={(event) => setPreferences({ voices: { [speaker.id]: event.target.value || null } })}
          >
            <option value="">Default voice</option>
            {view.installedVoices.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      ))}
      {view.installedVoices.length === 0 ? <p className="caption">Open voice once to list the voices installed on this PC.</p> : null}

      <h3 style={{ marginTop: 16 }}>Feedback</h3>
      <div className="setting-row">
        <div style={{ minWidth: 0 }}>
          <strong>Rate the last spoken answer</strong>
          <p>
            {view.lastAnswer
              ? `${nameOf(view.lastAnswer.speaker)} · ${view.lastAnswer.chars} characters${view.lastAnswer.interrupted ? " · you interrupted it" : ""}`
              : "No spoken model answer yet in this Host run."}
          </p>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(Object.keys(RATING_LABEL) as FeedbackRating[]).map((rating) => (
            <button
              key={rating}
              className="btn secondary"
              disabled={disabled || !view.lastAnswer}
              onClick={() => void send("personalization.feedback", { turnId: view.lastAnswer!.turnId, rating }, "Thanks. Rating saved.")}
            >
              {RATING_LABEL[rating]}
            </button>
          ))}
        </div>
      </div>
      <div className="setting-row">
        <div>
          <strong>Remember my feedback</strong>
          <p>
            Off: ratings last until Bunny Host restarts. On: ratings are kept on this PC (rating and speaker only, never what was said).
            {view.storedFeedback ? ` ${view.storedFeedback} kept.` : ""}
          </p>
        </div>
        <button
          className="switch"
          role="switch"
          aria-checked={view.preferences.rememberFeedback}
          aria-label="Remember my feedback"
          disabled={disabled}
          onClick={() => setPreferences({ rememberFeedback: !view.preferences.rememberFeedback }, view.preferences.rememberFeedback ? "Stored feedback deleted." : "Saved.")}
        >
          <span />
        </button>
      </div>
      {view.feedback.length || view.interruptions.length ? (
        <ul className="ai-capabilities" aria-label="Feedback so far">
          {view.feedback.map((row) => (
            <li key={`f-${row.speaker}`}>
              {nameOf(row.speaker)}: {row.tooLong} too long, {row.tooShort} too short, {row.good} just right
            </li>
          ))}
          {view.interruptions.map((row) => (
            <li key={`i-${row.speaker}`}>
              {nameOf(row.speaker)}: you interrupted {row.interrupted} of the last {row.answers} answers
            </li>
          ))}
        </ul>
      ) : null}
      {view.advice.map((advice) => (
        <div className="setting-row" key={`a-${advice.speaker}`}>
          <div style={{ minWidth: 0 }}>
            <strong>
              Suggestion for {nameOf(advice.speaker)}: {VERBOSITY_LABEL[advice.suggested].toLowerCase()} answers
            </strong>
            <p>{advice.reason}</p>
          </div>
          {advice.speaker === "bunny" ? (
            <button className="btn secondary" disabled={disabled} onClick={() => setPreferences({ verbosity: advice.suggested }, "Answer length changed.")}>
              Apply
            </button>
          ) : (
            <span className="caption">Change its interaction style on its card.</span>
          )}
        </div>
      ))}
      <button className="btn secondary" disabled={disabled} onClick={() => void send("personalization.feedback.forget", {}, "Feedback forgotten.")}>
        Forget all feedback
      </button>
      <p className="caption">
        Speaking pace and how readily Bunny yields to interruptions are not adjustable yet. Bunny never records conversations or uses them for training.
      </p>
      <p className="caption" role="status" aria-live="polite">
        {status}
      </p>
    </>
  );
}

/** Notification frequency for browser notifications from this Host (in-app attention is unchanged). */
export function NotificationFrequencySetting() {
  const { store, status, send, disabled } = usePersonalization();
  const view = store.voicePersonalization;
  if (!view) return null;
  return (
    <>
      <div className="setting-row">
        <div>
          <strong>Notification frequency</strong>
          <p>"Only what needs me": approvals, questions, failures and thermal warnings.</p>
        </div>
        <select
          aria-label="Notification frequency"
          value={view.preferences.notificationFrequency}
          disabled={disabled}
          onChange={(event) => void send("personalization.preferences", { preferences: { notificationFrequency: event.target.value } }, "Saved.")}
        >
          {NOTIFICATION_FREQUENCY.map((value) => (
            <option key={value} value={value}>
              {FREQUENCY_LABEL[value]}
            </option>
          ))}
        </select>
      </div>
      {status ? <p className="caption" role="status">{status}</p> : null}
    </>
  );
}
