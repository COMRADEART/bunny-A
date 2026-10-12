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
  /** T12 F4: what a follow-up asks about (finished, running, progress, doing, verification); absent otherwise. */
  focus?: string;
  /** T12-AUTH-04: "pause" or "resume" aimed at a Mission. Missions have no voice pause or resume; the answer says so. */
  missionVerb?: string;
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

/**
 * T12-AUTH-01: the one inflection-aware lexicon of destructive, publishing, configuration, transfer, execution and approval
 * verbs. Each stem matches as \bstem\w*\b, so "deleting", "wiping", "force pushing", "reinstalling" and "publishing" count the
 * same as their base forms. SENSITIVE (chat), EXEC and the draft check (draftAction) all read this table, so a draft and a chat
 * turn judge the same words. A stem that is also an ordinary status word ("running", "changed", "shared") is never judged by
 * itself: a status use with no object is not sensitive (STATUS_WORD_USE), and an imperative with its object is (EXEC).
 */
// T12-AUTH-01 (round 2): "merg" covers merge, merges, merging and merger. Collision-prone stems are whole inflections, so
// "changelog", "startup" and "dropdown" are not sensitive words.
const DIRECT_SENSITIVE_ALTS = ["delet\\w*", "eras\\w*", "wip\\w*", "destroy\\w*", "purg\\w*", "push\\w*", "publish\\w*", "deploy\\w*", "overwrit\\w*", "revert\\w*", "merg\\w*", "commit\\w*", "upload\\w*", "releas\\w*"];
const SENSITIVE_ALTS = [
  "delet\\w*", "wip\\w*", "eras\\w*", "destroy\\w*", "purg\\w*", "push\\w*", "publish\\w*", "deploy\\w*", "launch\\w*", "drop(?:s|ped|ping)?", "kill\\w*", "terminat\\w*",
  "overwrit\\w*", "revert\\w*", "reinstall\\w*", "reboot\\w*", "format\\w*", "chang(?:e|es|ed|ing)", "modif\\w*", "configur\\w*", "send\\w*", "shar(?:e|es|ed|ing)", "upload\\w*",
  "releas\\w*", "ship\\w*", "commit\\w*", "merg\\w*", "install\\w*", "uninstall\\w*", "run(?:s|ning)?", "execut\\w*", "approv\\w*", "grant\\w*", "authori[sz]\\w*",
];
const DIRECT_SENSITIVE_WORD = new RegExp(String.raw`\b(?:${DIRECT_SENSITIVE_ALTS.join("|")})\b`);
const SENSITIVE_WORD = new RegExp(String.raw`\b(?:${SENSITIVE_ALTS.join("|")})\b`);
/**
 * A status use of a shared stem with no object: "is the agent running", "the step was changed", "still running right now",
 * "pause the running agent called Builder" (the Agent noun is the object of the control, not of the status word).
 */
const STATUS_WORD_USE = /\b(?:run|running|runs|chang(?:e|es|ed|ing)|shar(?:e|es|ed|ing))\b(?=\s*(?:$|[?!.,;]|\s(?:in|on|at|for|since|from|recently|yet|still|now|right|already|currently|today|lately|agents?|missions?|tasks?|team)\b))/g;
/** Review round 3: "are you running any tasks" asks for status; its progressive "running" is not a command. */
const RUNNING_QUESTION = /\bare you running (?:any|some) (?:tasks?|missions?|jobs?|work)\b/g;
/** An agent, mission or task stop ("kill the research agent") is a stop proposal, never a lexicon hit. */
const AGENT_STOP_USE = /\b(?:kill|kills|killed|killing|terminat\w*)\s+(?:(?:the|my|this|that|a|an)\s+)?(?:[\w'-]+\s+)?(?:agents?|missions?|tasks?)\b/g;

/** True when the wording uses a lexicon word in a sensitive sense. Shared by the chat path and the draft path. */
function sensitiveWord(text: string): boolean {
  return SENSITIVE_WORD.test(text.replace(RUNNING_QUESTION, " ").replace(STATUS_WORD_USE, " ").replace(AGENT_STOP_USE, " "));
}

// Sensitive phrasing: approvals, permissions, shell/commands, deletion, publishing, settings and credentials,
// scope and mission widening, owner or administrator claims, safety overrides and prompt-injection phrasings.
const SENSITIVE: RegExp[] = [
  // fixcheck#0: direct approval and permission verbs in every inflection (allowed, permitted, authorized, approves, granted).
  /\b(approv(?:e|es|ed|ing)|allow(?:s|ed|ing)?|grant(?:s|ed|ing)?|authori[sz](?:e|es|ed|ing)|permit(?:s|ted|ting)?|unblock(?:s|ed|ing)?|whitelist(?:s|ed|ing)?)\b/,
  /\bgive (me |it |the agent |bunny |them )?(access|permission|permissions|power|rights)\b/,
  /\b(run|execute|exec|launch|invoke|start|open)\b.{0,60}\b(command|commands|shell|script|scripts|code|powershell|cmd|bash|terminal|program|executable|npm|git|python|node|rm|del|curl|installer)\b/,
  /\b(powershell|cmd\.exe|bash|shell command|terminal command|sudo|rm|rmdir|del|format c|rm -rf)\b(?!\w)/,
  // T12-AUTH-01: destructive, publishing and overwrite verbs in every inflection. Direct stems only; status words such as
  // "running" or "changed" are judged by their object (below), never by themselves.
  DIRECT_SENSITIVE_WORD,
  /\bremove\b.{0,40}\b(file|files|folder|folders|directory|directories|repo|repository|database|branch|data|everything|all)\b/,
  // T12-AUTH-01: a history rewrite or a forced push, with or without a draft prefix ("git reset hard").
  /\bgit\s+(?:reset|clean|rebase|force|checkout\s+--)\b/,
  // T12-AUTH-01: an outbound email is a send ("email the report", "email my boss"); "check my emails" is not.
  /\b(?:email|mail)\w*\s+(?:the|my|this|that|these|those|a|an|it|them|him|her|everyone)\b/,
  /\b(send|shar|email|mail|share|post|tweet)\w*\b.{0,40}\b(to|outside|externally|online|the internet|anyone|everyone|them|him|her)\b/,
  /\b(chang|switch|set|update|edit|modif|configur|reconfigur|alter)\w*\b.{0,40}\b(provider|providers|settings?|config|configuration|credentials?|password|passwords|token|tokens|api key|key|model|models|permissions?|policy|policies)\b/,
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
  // M-A-3 T11: "let the tester agent through", "let my request go through" name what they approve.
  /\blet (?:the|my|this|that|these|those|our) (?:[\w'-]+ ){0,3}(?:go )?through\b/,
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
  // T12-AUTH-01: imperatives only ("run", "install", "reboot the machine"); the -ing and -ed forms are status words.
  /\b(?:run|runs|execute|executes|launch|install|uninstall|restart|reboot|reinstall|shut ?down|power off|download|spawn|invoke|ship)\s+\S/,
  // T12-AUTH-01: an imperative with a machine or data object: "format", "kill" and "drop" with their targets.
  /\bdrop(?:s|ped|ping)?\s+(?:(?:the|all|my|our|this|that|every)\s+)?(?:[\w'-]+\s+)?(?:tables?|databases?|db|schema|collections?|indexes|index|columns?|rows?|data)\b/,
  // R3-intent#1: starting machine or project work ("start the server", "kick off the build", "ship it").
  /\b(?:start|starts|starting|kick off|kicks off|fire up|spin up|boot up|boot)\s+(?:(?:the|my|this|that|a|an|our)\s+)?(?:[\w'-]+\s+)?(?:server|servers|build|builds|app|application|service|services|process|tests?|suite|deployment|deploy|container|containers|vm|machine|script|job|jobs|pipeline|program|installer|update|upgrade|backup|sync|upload|download)\b/,
  /\bship (?:it|this|that|the (?:build|release|app|code|update))\b/,
  // "kill the agent" is an agent stop (authz#2), so kill and terminate refuse only when no agent or mission is named.
  /\b(?:kill(?:s|ed|ing)?|terminat(?:e|es|ed|ing)?)\s+(?!(?:(?:the|my|this|that|a|an)\s+)?(?:[\w'-]+\s+)?(?:agents?|missions?|tasks?)\b)\S/,
  /\b(?:build|test|deploy|compile)\s+(?:the|my|this|that)\s+(?:project|repo|repository|app|code|server|tests?|suite|package|machine|service|computer)\b/,
  /\bformat\s+(?:(?:the|my|this|that)\s+)?(?:drive|disk|partition|usb|volume|[a-z]:)/,
  /\btype\b.{0,40}\b(?:into|in)\b.{0,20}\b(?:terminal|shell|powershell|cmd|console|command prompt|prompt)\b/,
];

const PLAN_TARGET = String.raw`(?:plans?|teams?|missions?|agents?|reviewer|tester|planner|researcher|implementer|documenter|coordinator|tasks?|checks?|review|requirements?)`;
const PLAN_GO: RegExp[] = [
  new RegExp(String.raw`\b(?:go ahead|proceed|start|begin|launch|kick off|continue)\b(?: with| on)?(?: the| my| this| that)? (?:[\w'-]+ )?${PLAN_TARGET}\b`),
  new RegExp(String.raw`\blet\b.{0,30}\b${PLAN_TARGET}\b.{0,20}\b(?:go ahead|proceed|start|begin|continue)\b`),
  new RegExp(String.raw`\b(?:make|mark|set|force|flag)\b.{0,30}\b${PLAN_TARGET}\b.{0,20}\b(?:pass|passed|passing|succeed|succeeded|green|complete|completed|done|verified|ok)\b`),
  new RegExp(String.raw`\b(?:make|mark|set|force)\b.{0,30}\b(?:pass|passed|succeed|succeeded|complete|completed|verified)\b`),
  new RegExp(String.raw`\b(?:revise|replan|re-plan|redo|rewrite)\b.{0,20}\b${PLAN_TARGET}\b`),
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
/** T12-AUTH-04: a pause or resume whose object is a Mission ("pause the mission", "resume the mission alpha"). */
const MISSION_PAUSE = /^(pause|resume|continue|unpause|halt)\b.*\bmissions?\b/;
const LEAD_YES = /^(?:yes|yeah|yep|sure|ok|okay)[ ,]+(?=(?:pause|resume|continue|stop|halt|unpause)\b)/;

const STATUS: RegExp[] = [
  /\bwhat (is|are|am|'s) (my |the |your |its |this )?(agent|bunny|you|it|task|mission|current task|current step|work)\b.{0,20}\b(doing|working on|up to|currently|running)\b/,
  /\bwhat are you (working on|doing|up to)\b/,
  /\bwhat('s| is) (the )?(current|active) (task|step|status|work|job)\b/,
  /\b(is|are) (my |the )?(agent|agents|bunny|you|mission|task)s?\b.{0,12}\b(paused|running|stopped|done|finished|idle|working|complete|completed|blocked|waiting)\b/,
  /^(status|agent status|mission status|how('s| is) (it|the agent|my agent) going)$/,
  /\b(agent|mission) status\b/,
  // T12 live: "is any task you're running there now?", "is anything running?", "are you running any tasks?"
  /\b(?:is|are) (?:there )?anything (?:still )?(?:running|working|active|in progress)(?: (?:right now|now|at the moment|currently))?$/,
  /\b(?:is|are) (?:there )?any (?:tasks?|agents?|missions?|jobs?|work)\b.{0,24}\b(?:running|working|active|in progress)\b/,
  /\bare you (?:running|doing|working on) (?:any|some) (?:tasks?|missions?|jobs?|work)(?: (?:right now|now|at the moment|currently))?$/,
  // T12 live: "tell me whether the task is done" (whisper also heard "where the task is done").
  /\b(?:whether|if|where) (?:the |my |that |this )?(?:tasks?|missions?|agents?|work|job) (?:is|are|has|have)\b.{0,12}\b(?:done|finished|complete|completed|over|running|working)\b/,
];
const VERIFY = [
  /\b(did|do|does|have|has|were|was|are|is)\b.{0,30}\b(tests?|checks?|verification|builds?|typecheck|lint|suite|specs?)\b.{0,30}\b(pass|passed|passing|fail|failed|failing|green|red|succeed|succeeded)\b/,
  /\b(any|are there|is there|were there)\b.{0,20}\b(tests?|checks?|failures?|failing tests?)\b.{0,20}\b(fail|failed|failing|failures?|pass)\b/,
  /\bverification (results?|status|outcome|report)\b/,
  /\b(tests?|checks?) (fail|failed|failing|pass|passed|passing)\b/,
  /\b(failing|failed) (tests?|checks?)\b/,
  /\bare there (any )?(failing|failed)\b/,
];
/**
 * M-A-3 T11: questions about an Agent team. The answer's subject travels in the intent target: "count", "finished",
 * "failed" or "role:<role>". Every answer is built from canonical Host facts and Host labels, never model prose.
 */
const ROLE_VERB: [RegExp, string][] = [
  [/\b(testing|verifying|tester|test)\b/, "tester"], [/\b(reviewing|reviewer|review)\b/, "reviewer"], [/\b(planning|planner)\b/, "planner"],
  [/\b(researching|researcher|research)\b/, "researcher"], [/\b(implementing|implementer|implementation|building)\b/, "implementer"],
  [/\b(documenting|documenter|documentation|writing)\b/, "documenter"], [/\b(coordinating|coordinator)\b/, "coordinator"],
];
const TEAM_COUNT = /\bhow many (?:agents?|team members?|members)\b.{0,24}\b(?:working|running|active|busy|going)\b/;
const TEAM_ROLE_WHO = /\b(?:which|who|what) (?:agent|team member|member|one)\b.{0,12}\b(?:testing|verifying|reviewing|planning|researching|implementing|building|documenting|writing|coordinating)\b|^who(?:'s| is) (?:testing|verifying|reviewing|planning|researching|implementing|documenting|coordinating)\b/;
const TEAM_ROLE_WHAT = /\bwhat(?: is|'s| are) (?:the |my )?(?:planning|planner|research|researcher|review|reviewer|test|tester|testing|implementer|implementation|documenter|documentation|coordinator) agents?\b.{0,24}\b(?:doing|working on|up to)\b/;
// "is the mission done" stays the T10 status answer; only has/did forms and questions naming the team come here.
const TEAM_FINISHED = /\b(?:has|have|did) (?:the |my )?(?:team|mission|agents|team mission)\b.{0,12}\b(?:finish|finished|complete|completed|end|ended|done)\b|\bis (?:the |my )?team\b.{0,12}\b(?:finished|done|complete|completed)\b/;
const TEAM_FAILED = [/\b(?:which|what|any) (?:tasks?|steps?)\b.{0,12}\b(?:failed|fail|failing)\b/, /\bdid (?:any|the) (?:tasks?|steps?) fail\b/];
const MISSION_DONE = /\b(?:has|have|did|is|are|was|were|does) (?:the |my |that |this )?missions?\b.{0,20}\b(?:finish|finished|finishing|complete|completed|done|stopped|ended|over)\b/;
function teamQuestion(normalized: string): string | null {
  if (TEAM_COUNT.test(normalized)) return "count";
  if (TEAM_ROLE_WHO.test(normalized) || TEAM_ROLE_WHAT.test(normalized)) {
    const tail = normalized.replace(/^.*?\b(?:agent|member|one|who)s?\b/, "") || normalized;
    const role = ROLE_VERB.find(([re]) => re.test(TEAM_ROLE_WHAT.test(normalized) ? normalized : tail))?.[1];
    return role ? `role:${role}` : null;
  }
  if (TEAM_FAILED.some((re) => re.test(normalized))) return "failed";
  // T12 F5: "is the mission done" is a completion question too; the answer reads every canonical Mission (see answerTeam).
  if (MISSION_DONE.test(normalized) && !/\b(team|agents?)\b/.test(normalized)) return "finished";
  if (TEAM_FINISHED.test(normalized)) return "finished";
  return null;
}

/** Review round 3: make + a qualified agent noun ("make the reviewer agent ..."); bare roles stay out. */
const MAKE_REDIRECT = /\bmake\s+(?:the|my|this|that|our)\s+(?:[\w'-]+\s+){0,2}?agents?\b/;
/** T12 live: the whole turn asks to end voice. Anchored, so "stop listening to the tester" is not a close. */
const VOICE_CLOSE = /^(?:(?:end|close|stop|exit|quit|turn off|switch off|shut off|shut down)\s+(?:the\s+|this\s+)?(?:voice|listening|mic|microphone|hands[- ]?free)(?:\s+(?:session|chat|mode|conversation))?|stop listening|(?:you can )?stop listening to me)(?:\s+(?:now|please|bunny|thanks|thank you))*$/;
/**
 * T12 live: an imperative to act on the computer ("open notes", "and save it on desktop", "create a file"). Voice has no
 * computer tools; these get a fixed answer instead of the chat model, which once answered "Done." to "end voice now".
 */
const DEVICE_OBJECT = "(?:apps?|applications?|programs?|notes?|notepad|files?|folders?|documents?|docs?|desktop|downloads|browser|chrome|edge|firefox|tabs?|emails?|e-mails?|mail|messages?|texts?|windows?|settings|word|excel|powerpoint|terminal|command prompt|powershell|spotify|music|websites?|web pages?|screenshots?|calendar|reminders?|alarms?|timers?)";
/**
 * Review round 3: the computer object must be the verb's own direct object (at most one determiner and one modifier between
 * them), so "open notes" or "set a timer" is an action while "make a list of good apps" or "create a summary of the
 * documents" stays chat. Agent-addressed wording is never a computer action (it is a redirect; see classifyTranscript).
 */
const DEVICE_ACTION: RegExp[] = [
  new RegExp(`^(?:and |then |also )?(?:(?:can|could|would|will) you |please )?(?:open|launch|start up|close|save|create|make|delete|remove|send|email|text|type|download|install|play|move|copy|rename|edit|set|turn on|turn off|switch to|go to)(?: (?:up|on|off))?(?: (?:a|an|the|my|this|that|new|some|your))?(?: (?:a|an|the|my|this|that|new|some|your))?(?: [\\w'-]+)? ${DEVICE_OBJECT}\\b`),
  /^(?:and |then |also )?(?:(?:can|could|would|will) you |please )?(?:save|put|store|write|copy|move|export) (?:it|that|this|them|those|the \w+)\b.{0,20}\b(?:on|to|in|into) (?:the |my )?(?:desktop|disk|drive|downloads|documents|folder|file)\b/,
];

/**
 * T12 live + review rounds 3-5: model text that claims something was done. The spoken-chat model is tool-free and has no Host
 * facts, so such a sentence is never true; the session replaces it (see SPOKEN_ACTION_CLAIM_TEXT). Round 5 judges by subject
 * rather than by phrase lists: in every clause, Bunny ("I", "we", "Bunny") doing an action in any tense is a claim unless it is
 * negated or hypothetical; so is an Agent, Mission or user item reported as done ("The agent has stopped.", "Email sent.",
 * "Saved to your desktop."). General statements ("Word saves it once a file has been saved"), denials ("I deleted nothing")
 * and figurative uses ("I opened with the main point", "I ran the numbers", "I set up a plan") are not claims.
 */
const ACTION_WORD = new RegExp(`^(?:open|sav|delet|remov|send|sent|email|e-mail|text|messag|call|phon|launch|install|uninstall|reinstall|approv|execut|run|ran|start|stop|paus|resum|clos|end|enabl|disabl|turn|shut|switch|restart|reboot|deploy|push|publish|merg|commit|shar|copi|copy|backed|backing|kill|terminat|clear|empti|empty|refresh|post|order|bought|buy|purchas|pay|paid|transfer|set|book|schedul|add|creat|upload|download|mut|unmut|renam|mov|archiv|forward|repli|reply|print|revert|wip|format|updat|upgrad|configur|chang|cancel|grant|submit|lock|unlock|activat|deactivat|reset|fil|confirm|reject|halt|authori[sz]|resolv|deni|deny|dismiss|accept|declin|abort|suspend|block|unblock|permit|cut|pull|put|handl|gave|give|giv)(?:e|es|ed|d|s|ing|ied|ies|y|ped|ping|ted|ting|led|ling|red|ring|ned|ning|en)?$`);
// Words that end the search for Bunny's verb: a negation or a hypothetical makes the clause no claim.
const CLAIM_STOP = /^(?:'d|not|n't|never|no|cannot|can't|couldn't|can|could|would|wouldn't|should|shouldn't|might|may|must|don't|didn't|doesn't|won't|haven't|hasn't|hadn't|isn't|aren't|wasn't|unable|if|whether|recommend|suggest|think|believe|know|see|understand|like|love|want|need|hope|wish|feel|used|try|tried|trying)$/;
// Fillers allowed between Bunny and the verb ("I've just gone ahead and paused it", "I have, in fact, shut it down").
const CLAIM_FILLER = /^(?:'ve|'ll|'m|'re|have|has|had|am|is|are|was|were|been|will|shall|just|already|now|then|also|went|gone|go|going|got|get|did|do|ahead|and|in|fact|actually|successfully|quickly|finally|instead|for|you|to|managed|able|right|away)$/;
// Figurative or non-action uses after the verb ("opened with", "ran into", "ended up", "changed my mind", "set up a plan").
const NOT_ACTION_AFTER = /^(?:nothing|none|no|neither|with|into|across|up|out|over|through|together|forward|the numbers|my mind|attention|a lot|some thought|it this way|it simply|it like)\b/;
const BUNNY = /^(?:i|we|bunny|i've|i'll|i'm|i'd|we've|we'll|we're|we'd)$/;
const DONE_SUBJECT = "(?:(?:the|your|my|this|that) )?(?:[\\w'-]+ )?(?:agents?|missions?|tasks?|team|timers?|alarms?|reminders?|emails?|messages?|texts?|files?|folders?|documents?|notes?|apps?|session|voice|server|process|commits?|branch|meetings?|events?|appointments?|orders?|requests?|reports?|drafts?|backups?|updates?|approvals?|permissions?|deploy(?:ment)?s?|builds?)(?: [\\w'-]+){0,4}?";
const DONE_PARTICIPLE = "(?:opened|saved|created|closed|ended|deleted|removed|sent|launched|installed|approved|cancell?ed|executed|started|stopped|paused|resumed|enabled|disabled|set|booked|added|scheduled|updated|granted|muted|unmuted|turned (?:on|off)|switched (?:on|off)|shut down|restarted|deployed|pushed|published|merged|shared|copied|backed up|cleared|emptied|posted|ordered|paid|transferred|uploaded|downloaded|e-?mailed|texted|forwarded|submitted|finished|completed|made|renamed|moved|archived|printed|terminated|killed|halted|aborted|suspended|rejected|denied|confirmed|resolved|authori[sz]ed|accepted|declined|blocked|handled|taken care of)";
const GENERAL_AFTER = "(?!\\s+(?:automatically|by default|by most|by many|by the (?:app|system|editor)|when|whenever|once|if|unless|until|before|after|every|each|regularly|periodically))";
const DONE_CLAIMS: RegExp[] = [
  // Round 6: elliptical completions ("Finished.", "Consider it done.", "It's all taken care of.", "I've taken care of it.").
  /^(?:finished|done and dusted|consider it done|(?:it'?s|that'?s|it is|that is|everything is|everything'?s) (?:all )?(?:taken care of|handled|sorted(?: out)?|done)|all (?:taken care of|handled|sorted|done))[\s.!]*$/,
  /\b(?:i|we|bunny)(?:'ve| have| has| just| already)* (?:taken care of|handled|sorted out|dealt with) (?:it|that|this|them|everything|the)\b/,
  // Round 6: Bunny doing something to any object right now ("Opening the report for you now.", "Launching Word for you.").
  /^(?:opening|sending|launching|restarting|starting|stopping|pausing|saving|deleting|closing|ending|emailing|e-mailing|scheduling|creating|deploying|pushing|approving|cancell?ing|running|installing|uninstalling|uploading|downloading|forwarding|posting|booking|ordering|muting|shutting) (?:the |a |an |your |my )?[\w'-]+(?: [\w'-]+){0,3}? (?:for you|now|right now|right away|immediately)\b/,
  // "The agent has stopped.", "Your reminder has been created for 9 AM.", "The timer is set for five minutes."
  new RegExp(`\\b${DONE_SUBJECT}(?:'s| has| have| had| is| are| was| were| got)?(?: now| just| already| all| been| successfully)* ${DONE_PARTICIPLE}\\b${GENERAL_AFTER}`),
  // "It's been saved.", "It has been sent."
  new RegExp(`\\b(?:it|that|this|everything|all)(?:'s| has| have| had) (?:now |just |already )?been ${DONE_PARTICIPLE}\\b${GENERAL_AFTER}`),
  // "It's paused now.", "That is saved to your desktop."
  new RegExp(`^(?:it|that|this|everything)(?:'s| is| was)(?: now| all)? ${DONE_PARTICIPLE}\\b${GENERAL_AFTER}(?=\\s+(?:for|to|on|in|at|now|successfully|as requested)\\b|[\\s.!]*$)`),
  // "Email sent.", "Reminder set for nine.", "Saved to your desktop.", "Emailed to Sam."
  new RegExp(`^(?:the |your |my )?(?:[\\w'-]+ )?(?:emails?|messages?|texts?|reminders?|alarms?|timers?|files?|folders?|notes?|documents?|meetings?|events?|appointments?|orders?|requests?|reports?|drafts?|backups?|commits?|updates?) ${DONE_PARTICIPLE}\\b(?=\\s+(?:for|to|on|in|at)\\b|[\\s.!]*$)`),
  new RegExp(`^${DONE_PARTICIPLE} (?:it |that |them )?(?:to|for|on|in)\\b`),
  // "Done.", "All set.", "Confirm, paused.", "Stopped."
  /^(?:(?:it'?s|it is|that'?s|that is|all|agent|the agent)\s+)?(?:done|all set|paused|stopped|approved|resumed|started|cancell?ed|saved|opened|closed|deleted|executed|granted|sent|scheduled|booked)[\s.!]*$/,
  // A clause that opens with Bunny's own past action: "Paused the agent.", "Opened it for you.", "Stopped it."
  new RegExp(`^${DONE_PARTICIPLE} (?:it|that|this|them|the|your|a|an)\\b`),
  // "Ending voice now.", "Closing voice.", "ending the voice session"
  /^(?:ending|closing|opening|stopping|pausing|saving|starting|launching|deleting|approving|sending|e-?mailing|setting|creating|cancell?ing|resuming|restarting|deploying|pushing|scheduling|muting|renaming|sharing|running) (?:it|that|this|them|now|voice|the voice|your|the session|this session|the agent|the mission)\b(?!\s+(?:is|are|was|can|could|takes|will|would|may|might|should)\b)/,
];

/** True when Bunny is the subject of an action verb in this clause (any tense), not negated or hypothetical. */
function bunnyActs(clause: string): boolean {
  const words = clause.replace(/[^a-z0-9'\s-]/g, " ").replace(/\b(i|we)'(ve|ll|m|d|re)\b/g, "$1 '$2").split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    if (!BUNNY.test(words[i])) continue;
    // A hypothetical or conditional ("if I opened it", "once we save it") is not a claim.
    if (i > 0 && /^(?:if|when|once|whenever|unless|before|after|until|should|whether)$/.test(words[i - 1])) continue;
    for (let j = i + 1; j < Math.min(words.length, i + 8); j++) {
      const w = words[j];
      if (CLAIM_STOP.test(w)) break;
      if (CLAIM_FILLER.test(w)) continue;
      if (ACTION_WORD.test(w)) {
        const rest = words.slice(j + 1).join(" ");
        if (NOT_ACTION_AFTER.test(rest) && !/^back(?:ed|ing)$/.test(w)) break;
        return true;
      }
      break;
    }
  }
  return false;
}

/** Round 6: a Host-state phrase inside a question, a negation or a condition reports nothing as done. */
const DONE_QUALIFIED = /\b(?:can't|cannot|not|whether|if|unless|don't|doesn't|unknown|unclear|check|once|when|until|after|before|ask|see if|find out)\b/;

export function claimsAction(text: string): boolean {
  const t = text.toLowerCase().replace(/[’`]/g, "'").replace(/[—–]/g, ",").replace(/\s+/g, " ").trim();
  for (const sentence of t.split(/(?<=[.!?])\s+/)) {
    // The whole sentence too, so a parenthetical ("I have, in fact, shut it down") never splits Bunny from its verb.
    if (bunnyActs(sentence.replace(/[,;:]/g, " "))) return true;
    if (DONE_CLAIMS.some((re) => re.test(sentence.trim()) && !DONE_QUALIFIED.test(sentence))) return true;
    // Every clause is judged on its own, so a lead-in ("Good news,", "Alright then,") never hides a claim.
    for (const raw of sentence.split(/[,;:]\s*/)) {
      const clause = raw.trim().replace(/^(?:(?:and|so|then|now|well|okay|ok|sure|alright|right|yes|yeah|great|perfect|done|good news)\s+)+/, "");
      if (!clause) continue;
      if (bunnyActs(clause) || DONE_CLAIMS.some((re) => re.test(clause) && !DONE_QUALIFIED.test(clause))) return true;
    }
  }
  return false;
}

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
  // T12 F7: a named role or a qualified agent is addressed too ("ask the implementation agent to ...", "tell the tester to ...").
  /\b(tell|ask|have|get|order|instruct|direct)\s+(?:the|my|this|that|our)\s+(?:[\w'-]+\s+){0,2}?(?:agents?|testers?|reviewers?|planners?|researchers?|implementers?|documenters?|coordinators?)\b/,
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
  /\blet (?:the|my|this|that|these|those|our) (?:[\w'-]+ ){0,3}(?:go )?through\b/,
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
  // T12-AUTH-01 (round 2): the chat path reads the same lexicon as the draft path, so one verb gets one verdict.
  if (sensitiveWord(normalized)) return true;
  if (SYN_WINDOW.some((re) => re.test(normalized))) return true;
  if (SYN_STANDALONE.some((re) => re.test(normalized))) return true;
  if (EXEC.some((re) => re.test(normalized))) return true;
  // M-A-3 T11 (review SURF-04): going ahead with, passing or revising a plan/team/Agent is a workstation decision.
  if (PLAN_GO.some((re) => re.test(normalized))) return true;
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

/**
 * T12 F1: "stop talking" phrasings silence Bunny's speech only. The bare words and the objects talking, speaking, that and
 * "this" are speech stops; anything that names an Agent or a Mission is a control and is classified below.
 */
const SPEECH_STOP_SILENCE = /^(?:wait|hold on|hang on|be quiet|quiet|shush|stop talking|stop speaking|stop that|stop this|that's enough|enough|never mind that)(?:\s+(?:please|now|a (?:second|moment|sec)|for a (?:second|moment|sec)))?$/;
/** T12 F1: "stop" and "stop it" alone are ambiguous: the session asks whether to silence Bunny or stop an Agent, and executes nothing. */
const SPEECH_STOP_AMBIGUOUS = /^stop(?: it)?(?:\s+(?:please|now))?$/;

function speechStop(normalized: string, proposalPending: boolean): "silence" | "ambiguous" | null {
  // R4 D2: with a proposal pending, "never mind that" is still the cancel of that proposal.
  if (proposalPending && normalized === "never mind that") return null;
  if (SPEECH_STOP_AMBIGUOUS.test(normalized)) return "ambiguous";
  return SPEECH_STOP_SILENCE.test(normalized) ? "silence" : null;
}

/** T12 F2: a Mission named by its noun. Any Agent noun in the same utterance keeps it an Agent control. */
const AGENT_NOUN = /\b(agents?|tasks?|team members?|tester|reviewer|planner|researcher|implementer|documenter|coordinator|implementation|testing|reviewing|planning)\b/;
const MISSION_CONTROL = /^(?:stop|cancel|abort|end|kill|terminate)\s+(?:(?:the|my|this|that|current|active|running|ongoing)\s+)*(?:([\w'-]+)\s+)?(?:mission|missions)\b\s*(.*)$/;

/** The target words of a Mission control ("alpha" for "stop the mission alpha"), or null when the utterance is not one. */
function missionControlRest(normalized: string): string | null {
  const match = MISSION_CONTROL.exec(normalized);
  if (!match || AGENT_NOUN.test(normalized)) return null;
  return `${match[1] ?? ""} ${match[2] ?? ""}`;
}

/**
 * T12 F3: a spoken request to DRAFT a Mission ("prepare a plan for the dashboard project"). It is judged before the
 * mission-noun and release rules, which it passes by its own wording. A question, an Agent addressee, an authority claim,
 * or any approve, run, start, launch, deploy, publish, push or delete word keeps it refused or redirected. Returns the
 * objective (3-200 characters) or null.
 */
// T12 live re-check: whisper heard "Prepare a plan" as "Prepare to plan"; "to" is accepted between the verb and "plan".
const DRAFT = /\b(prepare|draft|sketch|outline|write up|make|create|plan)\s+(?:(?:a|an|the|my|me|new|another|to)\s+)*(?:plan|mission|missions)\b\s*(?:(?:for|to|about|that|on|of)\s+)?(.+)$/;
// T12-AUTH-01: "release" is not a subject word; "prepare a plan to release the app" is judged as the sensitive verb it is.
const DRAFT_SUBJECT_WORDS = /\b(mission|missions|delegate)\b/g;
/**
 * T12 F3 (round 2): a draft that also asks to start, begin, proceed, go live, activate, enable or to use any word of the shared
 * lexicon (run, execute, approve, deploy, publish, push, delete, wipe, change, send, kill, drop, release ...) is refused. The
 * mission-noun rule is not enough on its own: "create a mission and start it" loses its noun to the subject-word strip, so the
 * action words are judged on the whole wording, in every inflection.
 */
// T12-AUTH-01 (round 2): whole inflections, so "startup pitch" is a draft subject and not a start request.
const DRAFT_START = /\b(?:start(?:s|ed|ing)?|begin(?:s|ning)?|began|proceed(?:s|ed|ing)?|go live|activate[sd]?|activating|enable[sd]?|enabling)\b/;
/** A draft that asks to start or to use a sensitive lexicon word, in any inflection. */
function draftAction(normalized: string): boolean {
  return DRAFT_START.test(normalized) || sensitiveWord(normalized);
}

function draftObjective(normalized: string): string | null {
  if (QUESTION.test(normalized)) return null;
  const match = DRAFT.exec(normalized);
  if (!match) return null;
  const objective = match[2].replace(/[\s.!?,;:]+$/, "").trim();
  if (objective.length < 3 || objective.length > 200) return null;
  if (AGENT_NOUN.test(normalized)) return null;
  if (draftAction(normalized)) return null;
  if (AUTHORITY.some((re) => re.test(normalized))) return null;
  // The draft's own nouns are its subject, not authority; every other rule judges the rest of the wording as usual.
  if (isSensitive(normalized.replace(DRAFT_SUBJECT_WORDS, " "))) return null;
  return objective;
}

/**
 * T12 F4: follow-up questions about the last Host-facts subject. "Did it finish?" and "what about the second one?" are Host
 * facts, never chat. The subject itself is resolved by the session against live rows; this only reads the wording.
 */
const ORDINAL_WORD = "(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)";
const ORDINAL_FOLLOW_A = new RegExp(String.raw`^(?:and |what about |how about )(?:the )?${ORDINAL_WORD}(?: one| agent| mission| task)?\b`);
const ORDINAL_FOLLOW_B = new RegExp(String.raw`^(?:is|are|did|has|have|was|were) (?:the )?${ORDINAL_WORD} (?:one|agent|mission|task)\b`);
const PRONOUN = String.raw`(?:it|that|this|they|them|those|these|that one|this one)`;
const PRONOUN_FOLLOW: RegExp[] = [
  new RegExp(String.raw`\b(?:did|has|have) ${PRONOUN} (?:finish|finished|complete|completed|end|ended|stop|stopped)\b`),
  new RegExp(String.raw`\bis ${PRONOUN} (?:still )?(?:done|finished|complete|completed|running|working|paused|stopped)\b`),
  new RegExp(String.raw`\bhow far along (?:is|are) ${PRONOUN}\b`),
  new RegExp(String.raw`\bwhat(?:'s| is| are) ${PRONOUN} (?:doing|up to|working on)\b`),
  new RegExp(String.raw`\b(?:did|do|does) (?:the )?(?:tests?|checks?|verification|build|typecheck|suite) (?:pass|passed|passing|fail|failed|failing) for ${PRONOUN}\b`),
];
const NAME_FOLLOW = /^(?:and |what about |how about )(?:the )?([a-z][\w'-]*(?: [\w'-]+){0,2})$/;
const NOT_A_NAME = /^(?:you|it|that|this|them|they|we|me|now|then|there|here|else|the rest|everything|tests?|build|weather|time|price)$/;

type FollowUp = { focus: string; ordinal: number | null; name: string };

/** What the follow-up asks about: finished, running, progress, doing or verification. */
function followUpFocus(text: string): string {
  if (/\bhow far\b/.test(text)) return "progress";
  if (/\b(tests?|checks?|verification|build|typecheck|suite|pass|passed|fail|failed)\b/.test(text)) return "verification";
  if (/\b(doing|up to|working on)\b/.test(text)) return "doing";
  if (/\b(still running|running|still working|working|going|paused|stopped)\b/.test(text)) return "running";
  return "finished";
}

function followUp(normalized: string): FollowUp | null {
  const ordinal = ORDINAL_FOLLOW_A.exec(normalized) ?? ORDINAL_FOLLOW_B.exec(normalized);
  if (ordinal) return { focus: followUpFocus(normalized), ordinal: ordinalOf(ordinal[1]), name: "" };
  if (PRONOUN_FOLLOW.some((re) => re.test(normalized))) return { focus: followUpFocus(normalized), ordinal: null, name: "" };
  const named = NAME_FOLLOW.exec(normalized);
  if (named && !NOT_A_NAME.test(named[1])) return { focus: followUpFocus(normalized), ordinal: null, name: named[1] };
  return null;
}

export function classifyTranscript(
  transcript: string,
  options: { proposalPending?: boolean } = {},
): VoiceIntent {
  const normalized = normalizeTranscript(transcript);
  const make = (kind: VoiceTurnKind, target = "", ordinal: number | null = null, focus?: string): VoiceIntent => ({ kind, target, ordinal, normalized, ...(focus ? { focus } : {}) });
  if (!normalized) return make("empty");
  const pending = options.proposalPending === true;
  // fixcheck#0: the filler stripper removes a leading "ok"/"okay", so "okay it" is checked on the raw wording too.
  const raw = transcript.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ").trim().replace(/[\s.!?,;:]+$/, "");
  // T12 F3: a Mission draft is judged before the sensitive mission-noun rules (see draftObjective).
  const draft = draftObjective(normalized);
  if (draft !== null) return make("mission_draft", draft);
  // T12 F3 (round 2): a draft request that also asks to start or approve it is refused, never chatted or drafted.
  if (!QUESTION.test(normalized) && DRAFT.test(normalized) && draftAction(normalized)) return make("sensitive_refused");
  // V41: a free-form redirect of a running agent is explicitly unsupported; authority claims inside it are still refused.
  if (!QUESTION.test(normalized) && REDIRECT.some((re) => re.test(normalized)) && !AUTHORITY.some((re) => re.test(normalized) || re.test(raw))) return make("redirect_unsupported");
  if (isSensitive(normalized) || (!QUESTION.test(normalized) && isSensitive(raw))) return make("sensitive_refused");
  // R4 D2: with a proposal pending, a turn that opens with a refusal ("No, what is the agent doing?") still cancels it, as
  // it did before the barge-in lead word was dropped; the question that follows is not answered in that turn.
  if (pending && NEGATION_LEAD.test(normalizeTranscript(transcript, false))) return make("cancel");
  if (pending && (CONFIRM.test(normalized) || isConfirmLead(normalized))) return make("confirm");
  // T12 F1: a speech stop is classified before any control or chat; it silences Bunny and nothing else.
  const speech = speechStop(normalized, pending);
  if (speech) return make("speech_stop", speech);
  // T12 live: "end voice", "stop listening" close the voice session; ending only removes capability, so it needs no screen.
  // Review round 3: inner punctuation never defeats an explicit close ("End voice, please.").
  if (VOICE_CLOSE.test(normalized.replace(/[,.!?;:]+/g, " ").replace(/\s+/g, " ").trim())) return make("voice_close");
  // T12 F2: "stop/cancel/abort/end the mission" never becomes an Agent stop.
  const missionRest = missionControlRest(normalized);
  if (missionRest !== null) {
    const { target, ordinal } = targetOf(missionRest);
    return make("mission_control", target, ordinal);
  }
  const stop = stopRest(normalized);
  if (stop !== null) {
    const { target, ordinal } = targetOf(stop);
    return make("agent_control", target, ordinal);
  }
  if (CANCEL.test(normalized)) return make("cancel");
  if (CONFIRM.test(normalized) && !pending) return make("confirm");
  if (OPEN_UI.some((re) => re.test(normalized))) return make("open_ui");
  // T12 live: requests to act on the computer get a fixed answer; the tool-free chat model never sees (or "does") them.
  // Review round 3: an Agent-addressed instruction is a redirect, never a computer action.
  if (!QUESTION.test(normalized) && !AGENT_NOUN.test(normalized) && DEVICE_ACTION.some((re) => re.test(normalized))) return make("device_action_unsupported");
  const team = teamQuestion(normalized);
  if (team) return make("agent_team", team);
  // T12 F4: follow-ups resolve against the last Host-facts subject; they are never chat.
  const follow = followUp(normalized);
  if (follow) return make("agent_followup", follow.name, follow.ordinal, follow.focus);
  if (STATUS.some((re) => re.test(normalized))) return make("agent_status");
  if (VERIFY.some((re) => re.test(normalized))) return make("agent_verification");
  if (MODEL.some((re) => re.test(normalized))) return make("agent_model");
  if (APPROVALS.some((re) => re.test(normalized))) return make("agent_approvals");
  if (LAST_MISSION.some((re) => re.test(normalized))) return make("agent_last_mission");
  // T12-AUTH-04: "pause the mission" or "resume the mission" is a Mission control, never an Agent pause or resume. Missions are
  // paused per Agent or on the Windows Host screen, so the answer says that and no proposal is made.
  const missionPause = MISSION_PAUSE.exec(normalized);
  if (missionPause && !AGENT_NOUN.test(normalized)) return { ...make("mission_control"), missionVerb: missionPause[1] };
  // "yes pause it" without a pending proposal is an ordinary control phrase; the leading "yes" is only a lead-in.
  const control = CONTROL.exec(pending ? normalized : normalized.replace(LEAD_YES, ""));
  if (control) {
    const { target, ordinal } = targetOf(control[2] ?? "");
    return make("agent_control", target, ordinal);
  }
  // Review rounds 3/4: "make the reviewer agent check the documents" is a redirect too. It is matched only here, after the
  // sensitive check, so "make the reviewer agent push to main" stays a refusal.
  if (!QUESTION.test(normalized) && (REDIRECT.some((re) => re.test(normalized)) || MAKE_REDIRECT.test(normalized))) return make("redirect_unsupported");
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
