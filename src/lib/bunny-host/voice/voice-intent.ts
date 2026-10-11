/**
 * M-A-3 T10: deterministic intent classification of a FINAL transcript. No model is involved.
 *
 * Voice is never an execution authority: this only chooses which Host path a spoken turn takes. Sensitive phrasing is
 * checked first and always wins over a control phrase ("stop the agent and run rm -rf" is sensitive_refused).
 */
import type { VoiceTurnKind } from "./voice-protocol.ts";

export type VoiceIntent = {
  kind: VoiceTurnKind;
  /** Free words naming the control target ("alpha", "second one"); "" means "this agent". */
  target: string;
  /** 1-based ordinal when the speaker picked by position ("the second one"). */
  ordinal: number | null;
  /** Normalized transcript after wake-word and filler removal. */
  normalized: string;
};

const WAKE = /^(?:(?:hey|ok|okay)\s+)?(?:bunny|bunnie|bunni|honey bunny)\b[\s,.!?:]*/;
const FILLER = /^(?:(?:um+|uh+|hmm+|er+|ah+|like|so|well|please|hey|ok|okay)\b[\s,.!?:]*)+/;

export function normalizeTranscript(text: string): string {
  let t = text.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3; i++) {
    const before = t;
    t = t.replace(WAKE, "").replace(FILLER, "").trim();
    if (t === before) break;
  }
  return t.replace(/[\s.!?,;:]+$/, "").trim();
}

const ORDINALS: [RegExp, number][] = [
  [/\b(first|1st|one|number one)\b/, 1],
  [/\b(second|2nd|two|number two)\b/, 2],
  [/\b(third|3rd|three|number three)\b/, 3],
  [/\b(fourth|4th|four|number four)\b/, 4],
  [/\b(fifth|5th|five|number five)\b/, 5],
];

// Sensitive phrasing: approvals, permissions, shell/commands, deletion, publishing, settings and credentials,
// scope and mission widening, owner or administrator claims, safety overrides and prompt-injection phrasings.
const SENSITIVE: RegExp[] = [
  /\b(approve|approved|approving|allow|grant|authori[sz]e|permit|unblock|whitelist)\b/,
  /\bgive (me |it |the agent |bunny |them )?(access|permission|permissions|power|rights)\b/,
  /\b(run|execute|exec|launch|invoke|start|open)\b.{0,60}\b(command|commands|shell|script|scripts|code|powershell|cmd|bash|terminal|program|executable|npm|git|python|node|rm|del|curl|installer)\b/,
  /\b(powershell|cmd\.exe|bash|shell command|terminal command|sudo|rm|rmdir|del|format c|rm -rf)\b(?!\w)/,
  /\b(delete|erase|wipe|destroy|purge)\b/,
  /\bremove\b.{0,40}\b(file|files|folder|folders|directory|directories|repo|repository|database|branch|data|everything|all)\b/,
  /\b(push|publish|deploy|commit|merge|upload|release)\b/,
  /\b(send|email|mail|share|post|tweet)\b.{0,40}\b(to|outside|externally|online|the internet|anyone|everyone|them|him|her)\b/,
  /\b(change|switch|set|update|edit|modify|configure|reconfigure|alter)\b.{0,40}\b(provider|providers|settings?|config|configuration|credentials?|password|passwords|token|tokens|api key|key|model|models|permissions?|policy|policies)\b/,
  /\b(password|passwords|passcode|secret|secrets|credential|credentials|api key|access token|bearer token)\b/,
  /\b(widen|expand|extend|increase|broaden|add)\b.{0,30}\b(scope|access|permissions?|authority|reach)\b/,
  /\bscope\b/,
  /\b(new|another|start a|create a|make a|launch a)\b.{0,20}\bmission\b/,
  /\bdelegate\b/,
  /\b(i am|i'm|this is|i was|as|i'm the|i am the)\b.{0,12}\b(the )?(owner|admin|administrator|root|superuser|operator|developer)\b/,
  /\bowner\b.{0,10}\b(here|now|speaking)\b/,
  /\b(override|bypass|disable|turn off|ignore|skip|circumvent)\b.{0,50}\b(safety|security|rules?|guards?|guardrails?|restrictions?|policy|policies|checks?|approvals?|sandbox|containment|limits?|instructions?|protections?|authorization)\b/,
  /\bignore (all |any )?(previous|prior|earlier|your|the above)\b/,
  /\b(you are now|pretend|act as|jailbreak|developer mode|unrestricted)\b/,
  /\bon behalf of\b/,
];
// Approval synonyms: accept, agree, proceed, revoke, sign off, enable, "okay to", "let it through", "go ahead with".
// Refused when one co-occurs with an approval-like target (it, that, the request, the approval, pending...), in either
// order, so a plain question such as "what does accept mean?" stays chat. Confirmations ("yes", "confirm it") are not listed.
const APPROVAL_ACTION = String.raw`(?:accept|accepts|accepted|accepting|agree|agrees|agreed|agreeing|revoke|revokes|revoked|revoking|sign off|signs off|signed off|signing off|sign-off|proceed|proceeds|proceeded|proceeding|enable|enables|enabled|enabling|let (?:it |that |this |them )?through|okay to|ok to|alright to|all right to|go ahead with|go ahead and)`;
const APPROVAL_TARGET = String.raw`(?:it|that|this|them|these|those|one|ones|approval|approvals|approve|permission|permissions|access|request|requests|pending|proposal|proposals|authorization|authorisation|authority|consent|sign-off|tool|tools|everything|all|through)`;
SENSITIVE.push(new RegExp(String.raw`\b${APPROVAL_ACTION}\b.{0,30}\b${APPROVAL_TARGET}\b`));
SENSITIVE.push(new RegExp(String.raw`\b${APPROVAL_TARGET}\b.{0,30}\b${APPROVAL_ACTION}\b`));
SENSITIVE.push(/\blet (?:it |that |this |them )?through\b/);

const CONFIRM = /^(?:yes|yeah|yep|yup|confirm|confirmed|do it|go ahead|sure|affirmative|correct)\b(?:\s+(?:it|that|please|now))?$/;
const CONFIRM_LEAD = /^(?:yes|yeah|yep|yup|confirm|confirmed|do it|go ahead|sure)\b/;
/** What may follow a confirm lead-in and still be a confirmation: filler, or the pending pause repeated. Anything else is not. */
const CONFIRM_TAIL = /^(?:(?:it|that|this|please|now|thanks|thank you|okay|ok|sure|yes|yeah|go|ahead|do it|then|pause|halt)\b[\s,.!?]*)*$/;
const CANCEL = /^(?:cancel|never mind|nevermind|forget it|forget that|no|nope|no thanks|don't|do not)\b/;

const CONTROL = /^(pause|resume|continue|stop|halt|unpause)\b\s*(.*)$/;
const LEAD_YES = /^(?:yes|yeah|yep|sure|ok|okay)[ ,]+(?=(?:pause|resume|continue|stop|halt|unpause)\b)/;

const STATUS: RegExp[] = [
  /\bwhat (is|are|am|'s) (my |the |your |its |this )?(agent|bunny|you|it|task|mission|current task|current step|work)\b.{0,20}\b(doing|working on|up to|currently|running)\b/,
  /\bwhat are you (working on|doing|up to)\b/,
  /\bwhat('s| is) (the )?(current|active) (task|step|status|work|job)\b/,
  /\b(is|are) (my |the )?(agent|agents|bunny|you|mission|task)s?\b.{0,12}\b(paused|running|stopped|done|finished|idle|working|complete|completed|blocked|waiting)\b/,
  /^(status|agent status|mission status|how('s| is) (it|the agent|my agent) going)$/,
  /\b(agent|mission) status\b/,
];
const VERIFY = [
  /\b(did|do|does|have|has|were|was|are|is)\b.{0,30}\b(tests?|checks?|verification|builds?|typecheck|lint|suite|specs?)\b.{0,30}\b(pass|passed|passing|fail|failed|failing|green|red|succeed|succeeded)\b/,
  /\b(any|are there|is there|were there)\b.{0,20}\b(tests?|checks?|failures?|failing tests?)\b.{0,20}\b(fail|failed|failing|failures?|pass)\b/,
  /\bverification (results?|status|outcome|report)\b/,
  /\b(tests?|checks?) (fail|failed|failing|pass|passed|passing)\b/,
  /\b(failing|failed) (tests?|checks?)\b/,
  /\bare there (any )?(failing|failed)\b/,
];
const MODEL = [/\bwhich model\b/, /\bwhat model\b/, /\bmodel (is|are) (it|being used|working|running|active)\b/];
const APPROVALS = [/\bwhat needs my approval\b/, /\bpending approvals?\b/, /\bwhat('s| is| are) waiting\b/, /\bdo i have (any )?(pending )?approvals?\b/, /\b(any|my) approvals?\b/];
const LAST_MISSION = [/\b(last|previous|latest|most recent) mission\b/, /\bwhat happened (in|during|on) (my |the )?(last |previous )?mission\b/];
const OPEN_UI = [
  /\b(open|show|go to|take me to|bring up)\b.{0,30}\b(agentic|workspace|agent|agents|results?|mission|missions|dashboard|screen|workstation)\b/,
  /\bshow me (its|the|their|my) results\b/,
];
const REDIRECT = [
  /\b(tell|ask|make|have|get) (the |my |bunny |it |that )?(agent|bunny|it|them)\b.{0,30}\b(to|that|and)\b/,
  /\bchange the plan\b/,
  /\bredirect\b/,
  /\binstead,? (do|make|build|try|write|change|use)\b/,
  /\b(talk to|speak to|chat with) (the |my )?agent\b/,
];

/** A confirm lead-in ("yes", "confirm") counts only when nothing contradicting follows it ("yes, but not that one" does not). */
export function isConfirmLead(normalized: string): boolean {
  const lead = CONFIRM_LEAD.exec(normalized);
  if (!lead) return false;
  const rest = normalized.slice(lead[0].length).replace(/^[\s,.!?;:-]+/, "");
  return CONFIRM_TAIL.test(rest);
}

/** The ordinal word that appears first in the text ("the second one" is 2, not 1). */
function ordinalOf(text: string): number | null {
  let best: { at: number; n: number } | null = null;
  for (const [re, n] of ORDINALS) {
    const match = re.exec(text);
    if (match && (!best || match.index < best.at)) best = { at: match.index, n };
  }
  return best?.n ?? null;
}

function targetOf(rest: string): { target: string; ordinal: number | null } {
  const ordinal = ordinalOf(rest);
  const cleaned = rest
    .replace(/\b(the|my|this|that|agent|agents|mission|missions|task|tasks|bunny|it|one|named|called|please|now|for me|up|please)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { target: ordinal !== null && cleaned.length <= 16 ? "" : cleaned, ordinal };
}

export function classifyTranscript(
  transcript: string,
  options: { proposalPending?: boolean } = {},
): VoiceIntent {
  const normalized = normalizeTranscript(transcript);
  const make = (kind: VoiceTurnKind, target = "", ordinal: number | null = null): VoiceIntent => ({ kind, target, ordinal, normalized });
  if (!normalized) return make("empty");
  if (SENSITIVE.some((re) => re.test(normalized))) return make("sensitive_refused");
  if (options.proposalPending && (CONFIRM.test(normalized) || isConfirmLead(normalized))) return make("confirm");
  if (options.proposalPending && CANCEL.test(normalized)) return make("cancel");
  if (CANCEL.test(normalized)) return make("cancel");
  if (CONFIRM.test(normalized) && !options.proposalPending) return make("confirm");
  if (OPEN_UI.some((re) => re.test(normalized))) return make("open_ui");
  if (STATUS.some((re) => re.test(normalized))) return make("agent_status");
  if (VERIFY.some((re) => re.test(normalized))) return make("agent_verification");
  if (MODEL.some((re) => re.test(normalized))) return make("agent_model");
  if (APPROVALS.some((re) => re.test(normalized))) return make("agent_approvals");
  if (LAST_MISSION.some((re) => re.test(normalized))) return make("agent_last_mission");
  // "yes pause it" without a pending proposal is an ordinary control phrase; the leading "yes" is only a lead-in.
  const control = CONTROL.exec(options.proposalPending ? normalized : normalized.replace(LEAD_YES, ""));
  if (control) {
    const { target, ordinal } = targetOf(control[2] ?? "");
    return make("agent_control", target, ordinal);
  }
  if (REDIRECT.some((re) => re.test(normalized))) return make("redirect_unsupported");
  return make("chat");
}

/** The spoken control verb, mapped to the agent action it proposes. */
export function controlAction(normalized: string): "agent.pause" | "agent.resume" | "agent.stop" | null {
  const match = CONTROL.exec(normalized);
  if (!match) return null;
  const verb = match[1];
  if (verb === "pause" || verb === "halt") return "agent.pause";
  if (verb === "resume" || verb === "continue" || verb === "unpause") return "agent.resume";
  if (verb === "stop") return "agent.stop";
  return null;
}
