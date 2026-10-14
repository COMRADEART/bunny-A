import { createHash, randomUUID } from "node:crypto";
import { analyze, scoreProvider } from "../orch/router.ts";
import { eligibility, inferredConstraints } from "./router.ts";
import type { Mode, ProviderId, ProviderLive, TaskConstraints } from "../orch/types.ts";
import { MINIMUM_SAMPLES, type HostDatabase } from "./persistence.server.ts";
import { ROUTING_POLICY } from "./routing.server.ts";
import {
  SHADOW_MIN_VERIFIED, acceptGate, empiricalPoints, evaluate, propose, repick, shadowGate, shadowSummary, validateWeights,
  type EmpiricalSignal, type Evaluation, type GateResult, type LearningWeights, type LifecycleState, type Outcome, type RecordedCandidate,
  type RecordedDecision, type RoutingLearningView, type ShadowRow,
} from "./routing-feedback.ts";

export type RoutingPolicy={id:string;historyWeight:number;workloadWeight:number;latencyWeight?:number;perTaskType?:boolean};
export type ReplayCase={prompt:string;mode:Mode;constraints?:TaskConstraints;expected:ProviderId};
export const BASE_POLICY:RoutingPolicy={id:"bunny-router-v1",historyWeight:1,workloadWeight:0,latencyWeight:0};
const BASE_WEIGHTS:LearningWeights={historyWeight:1,latencyWeight:0,perTaskType:false};
const LIFECYCLE_MIGRATION="bunny-a.routing-learning.v1";
const PROVIDERS:ProviderId[]=["codex","claude","ollama","opencode","cline","cursor"];
const median=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);const middle=Math.floor(sorted.length/2);return sorted.length%2 ? sorted[middle] : (sorted[middle-1]+sorted[middle])/2;};
export const ROUTING_BENCHMARK:ReplayCase[]=[
  {prompt:"Create a tiny code file",mode:"fast",expected:"codex"},
  {prompt:"Debug a repository architecture with a failing test suite",mode:"deep",expected:"codex"},
  {prompt:"Fix one failing test in a repository",mode:"balanced",expected:"codex"},
  {prompt:"Draft documentation for a public product",mode:"deep",expected:"claude"},
  {prompt:"Compare reasoning approaches and explain tradeoffs",mode:"deep",expected:"claude"},
  {prompt:"Run a shell automation command for a distributed deploy",mode:"deep",expected:"codex",constraints:{requiresTerminal:true}},
  {prompt:"Transform a local only short sentence",mode:"fast",expected:"ollama"},
  {prompt:"Summarize privacy-sensitive text; do not send off machine",mode:"balanced",expected:"ollama"},
  {prompt:"Implement distributed repository architecture in a large context",mode:"deep",expected:"codex"},
  {prompt:"Quick simple uppercase transformation",mode:"fast",expected:"ollama"},
  {prompt:"Research and compare two papers",mode:"deep",expected:"claude"},
];
type LifecycleRow={policy_id:string;state:LifecycleState;proposed_by:"owner"|"evidence";created_at:number;shadow_started_at:number|null;decided_at:number|null;reason:string|null};
type Replay={regressions:number;promotable:boolean;decisions?:Evaluation;gate?:GateResult};
const weightsOf=(policy:RoutingPolicy):LearningWeights=>({historyWeight:policy.historyWeight,latencyWeight:policy.latencyWeight ?? 0,perTaskType:policy.perTaskType === true});
const outcomeOf=(row:{state:string;verification:string|null;provider:string},selected:ProviderId|null):Outcome|null=>
  row.state==="stopped" || row.provider!==selected ? null : row.verification==="passed" ? "passed" : row.verification==="failed" ? "failed" : "unverified";

export class PolicyEngine {
  db:HostDatabase;
  constructor(db:HostDatabase) {
    this.db=db;db.db.exec("CREATE TABLE IF NOT EXISTS policies(id TEXT PRIMARY KEY,record TEXT NOT NULL,replay TEXT,previous_id TEXT); CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
    db.db.prepare("INSERT OR IGNORE INTO policies VALUES(?,?,NULL,NULL)").run(BASE_POLICY.id,JSON.stringify(BASE_POLICY));
    db.db.prepare("INSERT OR IGNORE INTO settings VALUES('active_policy',?)").run(BASE_POLICY.id);
    // T13.3 Gate G: additive lifecycle and shadow tables beside `policies`.
    db.db.exec(`CREATE TABLE IF NOT EXISTS policy_lifecycle(policy_id TEXT PRIMARY KEY,state TEXT NOT NULL,proposed_by TEXT NOT NULL,created_at INTEGER NOT NULL,shadow_started_at INTEGER,decided_at INTEGER,reason TEXT);
      CREATE TABLE IF NOT EXISTS policy_shadow(decision_id TEXT PRIMARY KEY,policy_id TEXT NOT NULL,task_id TEXT NOT NULL,live_provider TEXT NOT NULL,live_model TEXT,shadow_provider TEXT,shadow_model TEXT,created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS policy_shadow_policy ON policy_shadow(policy_id)`);
    db.db.prepare("INSERT OR IGNORE INTO migrations(key) VALUES (?)").run(LIFECYCLE_MIGRATION);
  }
  active():RoutingPolicy {const id=(this.db.db.prepare("SELECT value FROM settings WHERE key='active_policy'").get() as {value:string}).value;return this.policy(id)!;}
  private policy(id:string):RoutingPolicy|null {const row=this.db.db.prepare("SELECT record FROM policies WHERE id=?").get(id) as {record:string}|undefined;return row ? JSON.parse(row.record) : null;}
  private lifecycle(id:string):LifecycleRow|null {return (this.db.db.prepare("SELECT * FROM policy_lifecycle WHERE policy_id=?").get(id) as LifecycleRow|undefined) ?? null;}
  /**
   * The weights live T3 routing uses. Only a policy accepted through the Gate G gate changes them; a policy promoted
   * before Gate G keeps shaping only the legacy decision record, exactly as it did.
   */
  liveWeights():LearningWeights {const active=this.active();return active.id===BASE_POLICY.id || this.lifecycle(active.id)?.state==="accepted" ? weightsOf(active) : BASE_WEIGHTS;}
  adjustment(provider:ProviderLive,prompt:string,mode:Mode,policy=this.active()):number {
    const type=analyze(prompt,mode).task_type;
    return this.db.learned(provider.id,type)*policy.historyWeight-Math.min(0.1,provider.active_jobs*policy.workloadWeight)+this.latencyAdjustment(provider.id,type,mode,policy.latencyWeight ?? 0);
  }
  /** Measured speed relative to other providers on the same task type; zero without enough samples on both sides. */
  latencyAdjustment(id:ProviderId,type:string,mode:Mode,weight:number):number {
    if(!weight) return 0;
    const mine=this.db.latency(id,type);const all=PROVIDERS.map(provider=>this.db.latency(provider,type)).filter((value):value is number=>value!==null);
    if(mine===null || all.length<2) return 0;
    const reference=median(all);
    return Math.max(-1,Math.min(1,(reference-mine)/reference))*weight*(mode === "fast" ? 1 : mode === "balanced" ? 0.5 : 0.2);
  }
  /**
   * The empirical value one set of weights gives a provider (memoized per signal). With the base weights it is exactly
   * the pre-Gate-G lookup: verified history in the "general" bucket, no latency term.
   */
  learningSignal():EmpiricalSignal {
    const learned=new Map<string,number>(),latency=new Map<string,number>();
    return (provider,taskType,mode,weights)=>{
      const type=weights.perTaskType ? taskType : "general";const key=`${provider}|${type}`;
      if(!learned.has(key)) learned.set(key,this.db.learned(provider,type));
      let value=learned.get(key)!*weights.historyWeight;
      if(weights.latencyWeight){const timed=`${key}|${mode}`;if(!latency.has(timed)) latency.set(timed,this.latencyAdjustment(provider,type,mode,1));value+=latency.get(timed)!*weights.latencyWeight;}
      return value;
    };
  }
  choose(test:ReplayCase,providers:ProviderLive[],policy:RoutingPolicy) {
    const constraints=inferredConstraints(test.prompt,test.constraints);const pool=providers.filter(p=>!eligibility(p,constraints));
    return pool.map(provider=>({id:provider.id,score:scoreProvider(provider.id,test.prompt,test.mode,provider)+this.adjustment(provider,test.prompt,test.mode,policy)})).sort((a,b)=>b.score-a.score || a.id.localeCompare(b.id))[0]?.id ?? null;
  }
  private benchmark(policy:RoutingPolicy,providers:ProviderLive[]) {
    const active=this.active();
    const rows=ROUTING_BENCHMARK.map(test=>({...test,current:this.choose(test,providers,active),candidate:this.choose(test,providers,policy)}));
    const currentPass=rows.filter(row=>row.current===row.expected).length,candidatePass=rows.filter(row=>row.candidate===row.expected).length;
    const regressions=rows.filter(row=>row.current===row.expected && row.candidate!==row.expected).length;
    return {datasetHash:createHash("sha256").update(JSON.stringify(ROUTING_BENCHMARK)).digest("hex"),currentPass,candidatePass,regressions,rows};
  }
  /** Recorded live T3 decisions joined to the outcome of the candidate that actually ran (latest decision per Task). */
  recordedDecisions(limit=300):RecordedDecision[] {
    const exists=this.db.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='routing_decisions'").get();
    if(!exists) return [];
    const rows=this.db.db.prepare(`SELECT d.task_id,d.decision,o.task_type,o.mode,o.provider,o.state,o.verification FROM routing_decisions d JOIN outcomes o ON o.task_id=d.task_id
      ORDER BY d.created_at DESC LIMIT ?`).all(limit) as {task_id:string;decision:string;task_type:string;mode:Mode;provider:string;state:string;verification:string|null}[];
    const seen=new Set<string>();const decisions:RecordedDecision[]=[];
    for(const row of rows) {
      if(seen.has(row.task_id)) continue;seen.add(row.task_id);
      let record:{routing_decision_id:string;selected:{provider_id:ProviderId;model_id:string|null}|null;candidates_considered:{provider_id:ProviderId;model_id:string|null;eligible:boolean;score:number|null;components:{name:string;points:number}[]|null}[]};
      try {record=JSON.parse(row.decision);} catch {continue;}
      const selected=record.selected ? {provider:record.selected.provider_id,model:record.selected.model_id} : null;
      decisions.push({decisionId:record.routing_decision_id,taskType:row.task_type,mode:row.mode,selected,outcome:outcomeOf(row,selected?.provider ?? null),candidates:(record.candidates_considered ?? []).map(toRecorded)});
    }
    return decisions;
  }
  benchmarkRegressions(weights:LearningWeights,providers:ProviderLive[]):number {return this.benchmark({id:"probe",workloadWeight:0,...weights},providers).regressions;}
  /** EVALUATE: replays the candidate on the fixed benchmark and on recorded live decisions, then stores it as evaluated. */
  evaluateCandidate(weights:LearningWeights,providers:ProviderLive[],proposedBy:"owner"|"evidence",workloadWeight=0) {
    const active=this.active();const policy:RoutingPolicy={id:randomUUID(),...weights,workloadWeight};
    const benchmark=this.benchmark(policy,providers);
    const decisions=evaluate(this.recordedDecisions(),this.liveWeights(),weights,this.learningSignal(),ROUTING_POLICY.weights.empirical);
    const gate=shadowGate(decisions,benchmark.regressions);
    const replay={...benchmark,promotable:gate.ok,decisions,gate};
    this.db.db.prepare("INSERT INTO policies VALUES(?,?,?,?)").run(policy.id,JSON.stringify(policy),JSON.stringify(replay),active.id);
    this.db.db.prepare("INSERT INTO policy_lifecycle(policy_id,state,proposed_by,created_at,reason) VALUES(?,?,?,?,?)").run(policy.id,"evaluated",proposedBy,Date.now(),gate.ok ? null : gate.reason);
    return {policy,replay};
  }
  candidate(historyWeight:number,workloadWeight:number,providers:ProviderLive[],latencyWeight=0,perTaskType=false) {
    if(!Number.isFinite(workloadWeight)||workloadWeight<0||workloadWeight>0.03) throw new Error("Candidate weights exceed allowed bounds.");
    return this.evaluateCandidate(validateWeights({historyWeight,latencyWeight,perTaskType}),providers,"owner",workloadWeight);
  }
  /** PROPOSE: Bunny suggests the best bounded policy the recorded evidence supports, or says why there is none. */
  proposeFromEvidence(providers:ProviderLive[]) {
    const result=propose(this.recordedDecisions(),this.liveWeights(),this.learningSignal(),ROUTING_POLICY.weights.empirical,(weights)=>this.benchmarkRegressions(weights,providers));
    if(!result.weights) throw new Error(result.reason);
    return this.evaluateCandidate(result.weights,providers,"evidence");
  }
  private replayOf(id:string):Replay|null {const row=this.db.db.prepare("SELECT replay FROM policies WHERE id=?").get(id) as {replay:string|null}|undefined;return row?.replay ? JSON.parse(row.replay) : null;}
  private previousOf(id:string):string|null {return (this.db.db.prepare("SELECT previous_id FROM policies WHERE id=?").get(id) as {previous_id:string|null}|undefined)?.previous_id ?? null;}
  /** SHADOW: the candidate is scored beside every live decision and never affects dispatch. One shadow run at a time. */
  startShadow(id:string) {
    const row=this.lifecycle(id);const replay=this.replayOf(id);
    if(!row || row.state!=="evaluated") throw new Error("Shadow refused: only an evaluated candidate can be shadow tested.");
    if(this.previousOf(id)!==this.active().id) throw new Error("Shadow refused: it was evaluated against a policy that is no longer active.");
    if(!replay?.promotable) throw new Error(`Shadow refused: ${replay?.gate && !replay.gate.ok ? replay.gate.reason : "it did not pass evaluation."}`);
    if(this.shadowPolicy()) throw new Error("Shadow refused: another candidate is already being shadow tested. Accept or reject it first.");
    this.db.db.prepare("UPDATE policy_lifecycle SET state='shadow',shadow_started_at=?,reason=NULL WHERE policy_id=?").run(Date.now(),id);
    return this.policy(id)!;
  }
  shadowPolicy():RoutingPolicy|null {
    const row=this.db.db.prepare("SELECT policy_id FROM policy_lifecycle WHERE state='shadow' ORDER BY shadow_started_at DESC LIMIT 1").get() as {policy_id:string}|undefined;
    return row && this.previousOf(row.policy_id)===this.active().id ? this.policy(row.policy_id) : null;
  }
  /** Records what the shadow policy would have chosen for one live decision, from that decision's own recorded scores. */
  recordShadow(input:{decisionId:string;taskId:string;taskType:string;mode:Mode;candidates:RecordedCandidate[];selected:{provider:ProviderId;model:string|null}|null}) {
    const shadow=this.shadowPolicy();
    if(!shadow || !input.selected) return;
    const signal=this.learningSignal();const weights=weightsOf(shadow);
    const pick=repick(input.candidates,(candidate)=>empiricalPoints(signal(candidate.provider,input.taskType,input.mode,weights),ROUTING_POLICY.weights.empirical));
    this.db.db.prepare("INSERT OR REPLACE INTO policy_shadow VALUES(?,?,?,?,?,?,?,?)").run(input.decisionId,shadow.id,input.taskId,input.selected.provider,input.selected.model,pick?.provider ?? null,pick?.model ?? null,Date.now());
  }
  shadowRows(id:string):ShadowRow[] {
    const rows=this.db.db.prepare(`SELECT s.live_provider,s.live_model,s.shadow_provider,s.shadow_model,o.provider,o.state,o.verification FROM policy_shadow s LEFT JOIN outcomes o ON o.task_id=s.task_id WHERE s.policy_id=?`).all(id) as {live_provider:ProviderId;live_model:string|null;shadow_provider:ProviderId|null;shadow_model:string|null;provider:string|null;state:string|null;verification:string|null}[];
    return rows.map(row=>({live:{provider:row.live_provider,model:row.live_model},shadow:row.shadow_provider ? {provider:row.shadow_provider,model:row.shadow_model} : null,
      outcome:row.provider==null ? null : outcomeOf({provider:row.provider,state:row.state ?? "",verification:row.verification},row.live_provider)}));
  }
  /** ACCEPT: re-evaluated on today's evidence, then the shadow run must have seen enough verified live decisions with no risk. */
  accept(id:string,providers:ProviderLive[]=[]) {
    const row=this.lifecycle(id);const policy=this.policy(id);
    if(!row || !policy || row.state!=="shadow" || this.previousOf(id)!==this.active().id) throw new Error("Promotion gate refused: only the candidate being shadow tested against the active policy can be accepted.");
    const weights=weightsOf(policy);
    const evaluation=evaluate(this.recordedDecisions(),this.liveWeights(),weights,this.learningSignal(),ROUTING_POLICY.weights.empirical);
    const gate=acceptGate(evaluation,this.benchmarkRegressions(weights,providers),shadowSummary(this.shadowRows(id)));
    if(!gate.ok) throw new Error(`Promotion gate refused: ${gate.reason}`);
    const previous=this.active().id;const now=Date.now();
    this.db.db.prepare("UPDATE settings SET value=? WHERE key='active_policy'").run(id);
    this.db.db.prepare("UPDATE policy_lifecycle SET state='accepted',decided_at=?,reason=NULL WHERE policy_id=?").run(now,id);
    this.db.db.prepare("UPDATE policy_lifecycle SET state='superseded',decided_at=? WHERE policy_id=? AND state='accepted'").run(now,previous);
    this.db.event("policy.promoted",null,`Policy ${id}; rollback artifact ${previous}`);return this.active();
  }
  promote(id:string,providers:ProviderLive[]=[]) {return this.accept(id,providers);}
  reject(id:string) {
    const row=this.lifecycle(id);
    if(!row || (row.state!=="evaluated" && row.state!=="shadow")) throw new Error("Only an evaluated or shadow-tested candidate can be rejected.");
    this.db.db.prepare("UPDATE policy_lifecycle SET state='rejected',decided_at=?,reason='Rejected by the owner.' WHERE policy_id=?").run(Date.now(),id);
  }
  rollback() {
    const current=this.active().id;const row=this.db.db.prepare("SELECT previous_id FROM policies WHERE id=?").get(current) as {previous_id:string|null};if(!row.previous_id) throw new Error("No previous policy.");
    this.db.db.prepare("UPDATE settings SET value=? WHERE key='active_policy'").run(row.previous_id);
    const now=Date.now();
    this.db.db.prepare("UPDATE policy_lifecycle SET state='superseded',decided_at=?,reason='Rolled back by the owner.' WHERE policy_id=?").run(now,current);
    this.db.db.prepare("UPDATE policy_lifecycle SET state='accepted',decided_at=? WHERE policy_id=? AND state='superseded'").run(now,row.previous_id);
    this.db.event("policy.rolled_back",null,row.previous_id);return this.active();
  }
  /** OBSERVE plus the lifecycle, for the workstation. Explicit feedback is shown beside verified results and never counted as one. */
  view():RoutingLearningView {
    const active=this.active();const activeRow=this.lifecycle(active.id);
    const candidates=(this.db.db.prepare("SELECT * FROM policy_lifecycle ORDER BY created_at DESC LIMIT 10").all() as LifecycleRow[]).flatMap(row=>{
      const policy=this.policy(row.policy_id);if(!policy) return [];
      const replay=this.replayOf(row.policy_id);
      const shadow=row.state==="evaluated" || row.state==="rejected" && !row.shadow_started_at ? null : shadowSummary(this.shadowRows(row.policy_id));
      const gate=replay?.decisions ? row.state==="shadow" ? acceptGate(replay.decisions,replay.regressions,shadow) : row.state==="evaluated" ? shadowGate(replay.decisions,replay.regressions) : null : null;
      return [{id:row.policy_id,weights:weightsOf(policy),state:row.state,proposedBy:row.proposed_by,createdAt:row.created_at,evaluation:replay?.decisions ?? null,benchmarkRegressions:replay?.regressions ?? null,shadow,gate,reason:row.reason}];
    });
    const observations=(this.db.db.prepare(`SELECT provider,task_type,COUNT(*) samples,SUM(verified) verified,SUM(CASE WHEN verification='failed' THEN 1 ELSE 0 END) verified_failed,
      SUM(CASE WHEN state='stopped' THEN 1 ELSE 0 END) stopped,SUM(COALESCE(retries,0)) repairs,SUM(CASE WHEN state='failed' THEN 1 ELSE 0 END) failed,
      SUM(COALESCE(input_tokens,0)) input_tokens,SUM(COALESCE(output_tokens,0)) output_tokens,SUM(CASE WHEN feedback='positive' THEN 1 ELSE 0 END) positive,
      SUM(CASE WHEN feedback='negative' THEN 1 ELSE 0 END) negative FROM outcomes GROUP BY provider,task_type ORDER BY samples DESC LIMIT 30`).all() as Record<string,number|string>[]).map(row=>{
      const provider=row.provider as ProviderId,taskType=String(row.task_type);
      return {provider,taskType,samples:Number(row.samples),verified:Number(row.verified ?? 0),verifiedFailed:Number(row.verified_failed ?? 0),stopped:Number(row.stopped ?? 0),repairs:Number(row.repairs ?? 0),
        failed:Number(row.failed ?? 0),medianMs:this.medianMs(provider,taskType),inputTokens:Number(row.input_tokens ?? 0),outputTokens:Number(row.output_tokens ?? 0),
        costUsd:provider==="ollama" ? 0 : null,feedback:{positive:Number(row.positive ?? 0),negative:Number(row.negative ?? 0)}};
    });
    return {active:{id:active.id,weights:this.liveWeights(),since:activeRow?.decided_at ?? null,previousId:this.previousOf(active.id)},candidates,observations,minimumSamples:MINIMUM_SAMPLES,shadowMinVerified:SHADOW_MIN_VERIFIED};
  }
  private medianMs(provider:ProviderId,taskType:string):number|null {
    const values=(this.db.db.prepare("SELECT duration_ms d FROM outcomes WHERE provider=? AND task_type=? AND completed=1").all(provider,taskType) as {d:number}[]).map(row=>row.d);
    return values.length ? median(values) : null;
  }
}
/** A recorded (or live) candidate reduced to what replay needs: its final score and the empirical points inside it. */
export function toRecorded(candidate:{provider_id:ProviderId;model_id:string|null;eligible:boolean;score:number|null;components:{name:string;points:number}[]|null}):RecordedCandidate {
  return {provider:candidate.provider_id,model:candidate.model_id,eligible:candidate.eligible,score:candidate.score,empirical:candidate.components?.find(component=>component.name==="empirical")?.points ?? 0};
}
