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

/**
 * Live finding (Part B): a spoken barge-in often starts with an interruption word ("Stop. What is the capital of France?").
 * The barge-in itself already stopped the speech, so that lead word is dropped when a question follows it. Without a
 * following question ("stop", "stop the agent", "stop what you are doing") nothing is stripped and the phrase is
 * classified as before. Dropping the lead can only turn a control proposal into a question, never the reverse.
 */
const INTERRUPT_LEAD = /^(?:stop|wait|hold on|hang on|sorry|actually|no|nope)\b[\s,.!?:;-]*/;
const NOT_A_QUESTION_AFTER_LEAD = /^what (?:you(?:'re| are)?|u)\b/;
const NEGATION_LEAD = /^(?:no|nope)\b/;

export function normalizeTranscript(text: string, stripLead = true): string {
  let t = text.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3; i++) {
    const before = t;
    t = t.replace(WAKE, "").replace(FILLER, "").trim();
    const lead = stripLead ? INTERRUPT_LEAD.exec(t) : null;
    if (lead) {
      const rest = t.slice(lead[0].length).trim();
      if (rest && QUESTION.test(rest) && !NOT_A_QUESTION_AFTER_LEAD.test(rest)) t = rest;
    }
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
  // fixcheck#0: direct approval and permission verbs in every inflection (allowed, permitted, authorized, approves, granted).
  /\b(approv(?:e|es|ed|ing)|allow(?:s|ed|ing)?|grant(?:s|ed|ing)?|authori[sz](?:e|es|ed|ing)|permit(?:s|ted|ting)?|unblock(?:s|ed|ing)?|whitelist(?:s|ed|ing)?)\b/,
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
  // authz#0: "let it through" and "let it go through" are approvals with or without a target.
  /\blet (?:it |that |this |them )?(?:go )?through\b/,
];

// Approval SYNONYMS (fixcheck#0, truth#3, authz#0). Each counts only with an approval-like target within 30 characters,
// in either order ("accept it", "it's okayed", "green-light the request", "rubber-stamp that"). Idioms that stand alone
// are in SYN_STANDALONE. Plain questions about them ("how do I enable it?", "should I accept it?") stay chat (fixcheck#4).
const SYN_VERB = String.raw`(?:accept(?:s|ed|ing)?|agree(?:s|d)? to|revok(?:e|es|ed|ing)|sign[- ]?off|signs off|signed off|signing off|proceed(?:s|ed|ing)?|enabl(?:e|es|ed|ing)|unlock(?:s|ed|ing)?|green[- ]?light(?:s|ed|ing)?|greenlight(?:s|ed)?|okayed|ratif(?:y|ies|ied|ying)|endorse(?:s|d|ing)?|sanction(?:s|ed|ing)?|consent(?:s|ed|ing)?|rubber[- ]?stamp(?:s|ed|ing)?|give (?:the |a |an |my )?go[- ]?ahead|okay to|ok to|alright to|all right to|okay with|ok with|fine with|say yes to|go ahead with|let (?:it |that |this |them )?(?:go )?through)`;
const SYN_TARGET = String.raw`(?:it|that|this|them|these|those|one|ones|approval|approvals|approve|permission|permissions|access|request|requests|pending|proposal|proposals|authori[sz]ation|authority|consent|tool|tools|command|commands|agent|agents|mission|missions|everything|all|through)`;
const SYN_WINDOW: RegExp[] = [
  new RegExp(String.raw`\b${SYN_VERB}\b.{0,30}\b${SYN_TARGET}\b`),
  new RegExp(String.raw`\b${SYN_TARGET}\b.{0,30}\b${SYN_VERB}\b`),
];
const SYN_STANDALONE: RegExp[] = [
  /\bmake it so\b/,
  /\bgo for it\b/,
  /\bi (?:hereby )?consent\b/,
  /\bsign (?:it|that|this|them) off\b/,
  /\bgive (?:the |a |an |my |your )?go[- ]?ahead\b/,
  // R3-intent#3: the bare "okay it" idiom is an approval only as the whole utterance; "okay, the agent is paused" or
  // "ok the agent, pause it" are an acknowledgement and a control.
  /^(?:ok|okay|alright|all right|fine)(?:[\s,]+(?:to|with))?[\s,]+(?:it|them|those|these|this one|the request|the approval|the tool|the command)$/,
];

/**
 * A genuine information question is answered as chat (fixcheck#4); direct approval verbs are refused anyway.
 * R3-intent#0: a request wrapped as a question ("why don't you restart the server", "should you accept the request",
 * "how about you install it", "is it okay to ratify it", "can you run ...") is NOT an information question.
 */
const QUESTION = /^(?:how (?:do|does|did|can|could|should|would) (?:i|we|one|it|this|that)\b|how (?:to|does|is|are|was|were|much|many|long|often)\b|what\b|which\b|who\b|when\b|where\b|why (?:is|are|was|were|does|do|did)\b(?! not\b)(?! you\b)|should (?:i|we)\b|(?:is|are|was|were|does|did) (?!you\b)\S|explain\b|define\b|(?:can|could) you (?:explain|tell me|describe)\b|tell me (?:how|what|why|whether|if)\b)/;

/** authz#1: imperative command execution against the machine or a project, with or without a listed noun. */
const EXEC: RegExp[] = [
  /\b(?:run|execute|launch|install|uninstall|restart|reboot|shut ?down|power off|download|spawn|invoke)\s+\S/,
  // R3-intent#1: starting machine or project work ("start the server", "kick off the build", "ship it").
  /\b(?:start|starts|starting|kick off|kicks off|fire up|spin up|boot up|boot)\s+(?:(?:the|my|this|that|a|an|our)\s+)?(?:[\w'-]+\s+)?(?:server|servers|build|builds|app|application|service|services|process|tests?|suite|deployment|deploy|container|containers|vm|machine|script|job|jobs|pipeline|program|installer|update|upgrade|backup|sync|upload|download)\b/,
  /\bship (?:it|this|that|the (?:build|release|app|code|update))\b/,
  // "kill the agent" is an agent stop (authz#2), so kill and terminate refuse only when no agent or mission is named.
  /\b(?:kill|terminate)\s+(?!(?:(?:the|my|this|that|a|an)\s+)?(?:[\w'-]+\s+)?(?:agents?|missions?|tasks?)\b)\S/,
  /\b(?:build|test|deploy|compile)\s+(?:the|my|this|that)\s+(?:project|repo|repository|app|code|server|tests?|suite|package|machine|service|computer)\b/,
  /\bformat\s+(?:(?:the|my|this|that)\s+)?(?:drive|disk|partition|usb|volume|[a-z]:)/,
  /\btype\b.{0,40}\b(?:into|in)\b.{0,20}\b(?:terminal|shell|powershell|cmd|console|command prompt|prompt)\b/,
];

/** authz#2: "cancel/abort/kill/terminate the <agent|mission|task>" is an agent stop proposal, never a spoken cancellation. */
const STOP_NAMED = /^(?:cancel|abort|kill|terminate)\s+(?:(?:the|my|this|that|a|an)\s+)?(?:([\w'-]+)\s+)?(?:agents?|missions?|tasks?)\b\s*(.*)$/;
const STOP_ORDINAL = /^(?:cancel|abort|kill|terminate)\s+(?:(?:the|my)\s+)?((?:first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|one|two|three|four|five|number (?:one|two|three|four|five))\b.*)$/;
/** Another cancel object ("cancel the upload") is not a voice action; a cancel of a pending pause or proposal is. */
const CANCEL_OBJECT = /^(?:cancel|abort|kill|terminate)\s+\S/;
const CANCEL_OK_OBJECT = /^(?:cancel|abort|kill|terminate)\s+(?:(?:the|my|this|that)\s+)?(?:(?:pending|current|active|last)\s+)?(?:proposal|pause|confirmation|request to pause|it|that|this|please|now)\b/;

/** The object text of a stop alias ("the research agent" gives "research "), or null when the utterance is not one. */
function stopRest(normalized: string): string | null {
  const named = STOP_NAMED.exec(normalized);
  if (named) return `${named[1] ?? ""} ${named[2] ?? ""}`;
  const ordinal = STOP_ORDINAL.exec(normalized);
  if (ordinal) return ordinal[1];
  return null;
}

const CONFIRM = /^(?:yes|yeah|yep|yup|confirm|confirmed|do it|go ahead|sure|affirmative|correct)\b(?:\s+(?:it|that|please|now))?$/;
const CONFIRM_LEAD = /^(?:yes|yeah|yep|yup|confirm|confirmed|do it|go ahead|sure)\b/;
/** What may follow a confirm lead-in and still be a confirmation: filler, or the pending pause repeated. Anything else is not. */
const CONFIRM_TAIL = /^(?:(?:it|that|this|please|now|thanks|thank you|okay|ok|sure|yes|yeah|go|ahead|do it|then|pause|halt)\b[\s,.!?]*)*$/;
const CANCEL = /^(?:cancel(?:\s+(?:it|that|this|please|now|the (?:(?:pending|current|active|last) )?(?:proposal|pause|confirmation)))*\s*$|(?:never mind|nevermind|forget it|forget that|no|nope|no thanks|don't|do not)(?=$|[\s,.!?;:]))/;

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
  // Any instruction addressed to the agent itself ("have the agent build the docs instead") is a redirect.
  /\b(tell|ask|make|have|get|order|instruct|direct) (the |my |this |that )?agents?\b/,
  /\bchange the plan\b/,
  /\bredirect\b/,
  /\binstead,? (do|make|build|try|write|change|use)\b/,
  /\b(talk to|speak to|chat with) (the |my )?agent\b/,
];

/**
 * Authority claims and approval semantics that are refused even inside a redirect phrasing ("tell the agent to approve
 * it", "tell the agent I am the owner"). Generic action words ("tell the agent to also deploy") stay a redirect.
 */
const AUTHORITY: RegExp[] = [
  SENSITIVE[0],
  /\bgive (me |it |the agent |bunny |them )?(access|permission|permissions|power|rights)\b/,
  /\b(password|passwords|passcode|secret|secrets|credential|credentials|api key|access token|bearer token)\b/,
  /\b(i am|i'm|this is|i was|as|i'm the|i am the)\b.{0,12}\b(the )?(owner|admin|administrator|root|superuser|operator|developer)\b/,
  /\b(override|bypass|disable|turn off|ignore|skip|circumvent)\b.{0,50}\b(safety|security|rules?|guards?|guardrails?|restrictions?|policy|policies|checks?|approvals?|sandbox|containment|limits?|instructions?|protections?|authorization)\b/,
  /\bignore (all |any )?(previous|prior|earlier|your|the above)\b/,
  /\b(you are now|pretend|act as|jailbreak|developer mode|unrestricted)\b/,
  /\bon behalf of\b/,
];

/** A confirm lead-in ("yes", "confirm") counts only when nothing contradicting follows it ("yes, but not that one" does not). */
export function isConfirmLead(normalized: string): boolean {
  const lead = CONFIRM_LEAD.exec(normalized);
  if (!lead) return false;
  const rest = normalized.slice(lead[0].length).replace(/^[\s,.!?;:-]+/, "");
  return CONFIRM_TAIL.test(rest);
}

/** Whether the utterance asks for something sensitive. Direct verbs always count; synonyms and commands not in question form. */
function isSensitive(normalized: string): boolean {
  if (SENSITIVE.some((re) => re.test(normalized))) return true;
  if (QUESTION.test(normalized)) return false;
  if (SYN_WINDOW.some((re) => re.test(normalized))) return true;
  if (SYN_STANDALONE.some((re) => re.test(normalized))) return true;
  if (EXEC.some((re) => re.test(normalized))) return true;
  return CANCEL_OBJECT.test(normalized) && !CANCEL_OK_OBJECT.test(normalized) && stopRest(normalized) === null;
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

/**
 * The control target words and the ordinal, both kept (authz#3). The session resolves a named target first and uses the
 * ordinal to pick by position only when no name matches, or asks which one when the name and the position disagree.
 */
function targetOf(rest: string): { target: string; ordinal: number | null } {
  const ordinal = ordinalOf(rest);
  const cleaned = rest
    .replace(/\b(the|my|this|that|current|active|running|ongoing|present|agent|agents|mission|missions|task|tasks|bunny|it|one|named|called|please|now|for me|up|first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|two|three|four|five|number)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { target: cleaned, ordinal };
}

export function classifyTranscript(
  transcript: string,
  options: { proposalPending?: boolean } = {},
): VoiceIntent {
  const normalized = normalizeTranscript(transcript);
  const make = (kind: VoiceTurnKind, target = "", ordinal: number | null = null): VoiceIntent => ({ kind, target, ordinal, normalized });
  if (!normalized) return make("empty");
  // fixcheck#0: the filler stripper removes a leading "ok"/"okay", so "okay it" is checked on the raw wording too.
  const raw = transcript.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ").trim().replace(/[\s.!?,;:]+$/, "");
  // V41: a free-form redirect of a running agent is explicitly unsupported; authority claims inside it are still refused.
  if (!QUESTION.test(normalized) && REDIRECT.some((re) => re.test(normalized)) && !AUTHORITY.some((re) => re.test(normalized) || re.test(raw))) return make("redirect_unsupported");
  if (isSensitive(normalized) || (!QUESTION.test(normalized) && isSensitive(raw))) return make("sensitive_refused");
  // R4 D2: with a proposal pending, a turn that opens with a refusal ("No, what is the agent doing?") still cancels it, as
  // it did before the barge-in lead word was dropped; the question that follows is not answered in that turn.
  if (options.proposalPending && NEGATION_LEAD.test(normalizeTranscript(transcript, false))) return make("cancel");
  if (options.proposalPending && (CONFIRM.test(normalized) || isConfirmLead(normalized))) return make("confirm");
  const stop = stopRest(normalized);
  if (stop !== null) {
    const { target, ordinal } = targetOf(stop);
    return make("agent_control", target, ordinal);
  }
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
  if (!QUESTION.test(normalized) && REDIRECT.some((re) => re.test(normalized))) return make("redirect_unsupported");
  return make("chat");
}

/** The spoken control verb, mapped to the agent action it proposes. A cancel of an agent, mission or task is a stop. */
export function controlAction(normalized: string): "agent.pause" | "agent.resume" | "agent.stop" | null {
  if (stopRest(normalized) !== null) return "agent.stop";
  const match = CONTROL.exec(normalized.replace(LEAD_YES, ""));
  if (!match) return null;
  const verb = match[1];
  if (verb === "pause" || verb === "halt") return "agent.pause";
  if (verb === "resume" || verb === "continue" || verb === "unpause") return "agent.resume";
  if (verb === "stop") return "agent.stop";
  return null;
}
