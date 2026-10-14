import type { HostDatabase } from "../persistence.server.ts";
import {
  FEEDBACK_RATINGS, SPEAKER_IDS, VOICE_PREFERENCES_SETTING, parseVoicePreferences, validateVoicePreferences,
  type FeedbackRating, type FeedbackRow, type SpeakerId, type VoicePreferences,
} from "./voice-personalization.ts";

const MIGRATION = "bunny-a.voice-personalization.v1";
/** Ratings kept, on disk and in memory alike; the oldest are dropped first. */
export const FEEDBACK_MAX = 200;

/**
 * M-A-3 T13.3 Gate G (§21): owner voice preferences and explicit answer ratings. A rating is a speaker, a rating and a
 * time: never the question, the answer or audio. Ratings reach disk only while "remember my feedback" is on; turning it
 * off or choosing "forget" deletes what was stored.
 */
export class VoicePersonalizationStore {
  private readonly db: HostDatabase;
  private session: FeedbackRow[] = [];
  constructor(db: HostDatabase) {
    this.db = db;
    db.db.exec("CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS voice_feedback(id INTEGER PRIMARY KEY AUTOINCREMENT,at INTEGER NOT NULL,speaker TEXT NOT NULL,rating TEXT NOT NULL)");
    db.db.prepare("INSERT OR IGNORE INTO migrations(key) VALUES (?)").run(MIGRATION);
  }
  preferences(): VoicePreferences {
    return parseVoicePreferences((this.db.db.prepare("SELECT value FROM settings WHERE key=?").get(VOICE_PREFERENCES_SETTING) as { value: string } | undefined)?.value);
  }
  setPreferences(input: unknown): VoicePreferences {
    const next = validateVoicePreferences(input, this.preferences());
    this.db.db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(VOICE_PREFERENCES_SETTING, JSON.stringify(next));
    if (!next.rememberFeedback) this.db.db.exec("DELETE FROM voice_feedback");
    return next;
  }
  record(speaker: SpeakerId, rating: FeedbackRating, at: number) {
    if (!SPEAKER_IDS.includes(speaker) || !FEEDBACK_RATINGS.includes(rating)) throw new Error("Unsupported feedback.");
    if (this.preferences().rememberFeedback) {
      this.db.db.prepare("INSERT INTO voice_feedback(at,speaker,rating) VALUES(?,?,?)").run(at, speaker, rating);
      this.db.db.prepare("DELETE FROM voice_feedback WHERE id NOT IN (SELECT id FROM voice_feedback ORDER BY id DESC LIMIT ?)").run(FEEDBACK_MAX);
    } else {
      this.session = [...this.session, { speaker, rating, at }].slice(-FEEDBACK_MAX);
    }
  }
  stored(): FeedbackRow[] {
    return (this.db.db.prepare("SELECT speaker,rating,at FROM voice_feedback ORDER BY id").all() as FeedbackRow[]).map((row) => ({ speaker: row.speaker, rating: row.rating, at: row.at }));
  }
  rows(): FeedbackRow[] {
    return [...this.stored(), ...this.session].slice(-FEEDBACK_MAX);
  }
  forget() {
    this.db.db.exec("DELETE FROM voice_feedback");
    this.session = [];
  }
}
