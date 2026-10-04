import type { ActionManifest, CapabilityAvailability, CapabilityResult } from "../types.ts";
import type { CapabilityAdapter, ExecutionContext } from "./bus.server.ts";
import { resolveCommand, runCommand, tail } from "./process.server.ts";
import { scopedPath } from "../paths.server.ts";

const input = (name: string, type: ActionManifest["inputs"][number]["type"], required: boolean, description: string) => ({ name, type, required, description });

/**
 * GitHub through the user's own `gh` CLI session. Bunny never reads or stores the token; it only runs
 * read-only `gh` queries in an approved repository folder. Mutations are declared but not implemented.
 */
export class GitHubCapability implements CapabilityAdapter {
  manifest = {
    id: "github", version: "1.0.0", description: "Read-only GitHub queries through the locally signed-in gh CLI.", locality: "remote" as const, platforms: "any" as const,
    events: ["capability.completed", "capability.failed"], cost: { kind: "external_service" as const, note: "GitHub API calls under the user's gh session; no model tokens." }, adapter: "gh CLI",
    actions: [
      { id: "github.pr_list", description: "Open pull requests for the repository in the working folder.", risk: "READ", inputs: [input("cwd", "string", false, "Repository folder."), input("limit", "number", false, "Max (20).")], outputs: "{ pulls: { number, title, state, url, author }[] }", evidence: "gh pr list JSON.", timeoutMs: 30_000, implemented: true },
      { id: "github.issue_list", description: "Open issues for the repository in the working folder.", risk: "READ", inputs: [input("cwd", "string", false, "Repository folder."), input("limit", "number", false, "Max (20).")], outputs: "{ issues: { number, title, state, url }[] }", evidence: "gh issue list JSON.", timeoutMs: 30_000, implemented: true },
      { id: "github.repo_view", description: "Repository name, default branch and visibility.", risk: "READ", inputs: [input("cwd", "string", false, "Repository folder.")], outputs: "{ nameWithOwner, defaultBranch, visibility, url }", evidence: "gh repo view JSON.", timeoutMs: 30_000, implemented: true },
      { id: "github.pr_create", description: "Create a pull request (contract only in M-A-0).", risk: "EXTERNAL_SIDE_EFFECT", hardApproval: true, inputs: [input("title", "string", true, "Title."), input("body", "string", false, "Body.")], outputs: "{ url }", evidence: "PR URL.", timeoutMs: 60_000, implemented: false },
      { id: "github.comment", description: "Comment on an issue or PR (contract only in M-A-0).", risk: "EXTERNAL_SIDE_EFFECT", hardApproval: true, inputs: [input("number", "number", true, "Issue/PR number."), input("body", "string", true, "Comment.")], outputs: "{ url }", evidence: "Comment URL.", timeoutMs: 60_000, implemented: false },
    ] satisfies ActionManifest[],
  };
  async health(): Promise<{ availability: CapabilityAvailability; detail: string }> {
    const gh = resolveCommand("gh");
    if (!gh) return { availability: "unavailable", detail: "GitHub CLI (gh) is not installed." };
    const status = await runCommand("gh", ["auth", "status", "--hostname", "github.com"], { cwd: process.cwd(), signal: new AbortController().signal, timeoutMs: 15_000, owned: true, owner: { action: "github.auth-status" } }).catch(() => null);
    if (!status) return { availability: "unavailable", detail: "gh could not be run." };
    // gh prints account details; only the verdict is kept, never the token line.
    return status.exitCode === 0 ? { availability: "available", detail: "gh is signed in to github.com (token stays in gh's own store)." } : { availability: "unconfigured", detail: "gh is installed but not signed in. Run `gh auth login` yourself; Bunny does not sign in for you." };
  }
  async execute(action: string, params: Record<string, unknown>, context: ExecutionContext): Promise<CapabilityResult> {
    const cwd = typeof params.cwd === "string" && params.cwd ? scopedPath(context.cwd, params.cwd, context.roots) : context.cwd;
    const limit = String(Math.max(1, Math.min(50, Number(params.limit ?? 20) || 20)));
    const args: Record<string, string[]> = {
      "github.pr_list": ["pr", "list", "--json", "number,title,state,url,author", "--limit", limit],
      "github.issue_list": ["issue", "list", "--json", "number,title,state,url", "--limit", limit],
      "github.repo_view": ["repo", "view", "--json", "nameWithOwner,defaultBranchRef,visibility,url"],
    };
    if (!args[action]) return { ok: false, status: "unsupported", summary: `${action} is not implemented in M-A-0.`, output: null, evidence: [] };
    // gh can inspect the repository through child Git processes. Contain the
    // connector root at creation so those children inherit the same boundary.
    const result = await runCommand("gh", args[action], { cwd, signal: context.signal, timeoutMs: Math.min(context.timeoutMs, 30_000), owned: true, owner: { missionId: context.missionId, stepId: context.stepId, capabilityRunId: context.capabilityRunId, dataDirectory: context.dataDirectory, records: context.processOwnership, action } });
    if (result.exitCode !== 0) return { ok: false, status: "failed", summary: `gh failed: ${tail(result.stderr, 300)}`, output: null, evidence: [`gh ${args[action].join(" ")} in ${cwd} → exit ${result.exitCode}`], errorCategory: "capability_failed" };
    let data: unknown; try { data = JSON.parse(result.stdout); } catch { return { ok: false, status: "failed", summary: "gh returned unreadable JSON.", output: null, evidence: [], errorCategory: "capability_failed" }; }
    const count = Array.isArray(data) ? `${data.length} item(s)` : "repository details";
    return { ok: true, status: "succeeded", summary: `GitHub: ${count}.`, output: action === "github.pr_list" ? { pulls: data } : action === "github.issue_list" ? { issues: data } : data, evidence: [`gh ${args[action].slice(0, 2).join(" ")} in ${cwd} at ${new Date().toISOString()}`] };
  }
}

/** Contract every future communication backend (SMS, WhatsApp Business API, email, telephony) implements. */
export interface CommunicationProvider {
  id: string;
  channel: "sms" | "whatsapp" | "email" | "voice" | "chat";
  configured(): Promise<boolean>;
  sendMessage?(to: string, body: string): Promise<{ id: string }>;
  receiveMessages?(since: number): Promise<{ id: string; from: string; body: string; at: number }[]>;
  startCall?(to: string): Promise<{ callId: string }>;
  speak?(callId: string, text: string): Promise<void>;
  listen?(callId: string, timeoutMs: number): Promise<{ text: string }>;
  hangUp?(callId: string): Promise<void>;
  transcript?(callId: string): Promise<{ at: number; speaker: string; text: string }[]>;
}

type ConnectorSpec = { id: string; description: string; actions: { id: string; description: string; risk: ActionManifest["risk"]; hard?: boolean; inputs: ActionManifest["inputs"] }[]; detail: string };
const SPECS: ConnectorSpec[] = [
  { id: "email", description: "Email (IMAP/SMTP or provider API).", detail: "No email account is connected to this Host. Bunny does not sign in to accounts or scrape mail.", actions: [
    { id: "email.read", description: "Read recent messages.", risk: "READ", inputs: [input("folder", "string", false, "Folder.")] },
    { id: "email.send", description: "Send a message.", risk: "EXTERNAL_SIDE_EFFECT", hard: true, inputs: [input("to", "string", true, "Recipient."), input("subject", "string", true, "Subject."), input("body", "string", true, "Body.")] } ] },
  { id: "calendar", description: "Calendar (provider API).", detail: "No calendar is connected to this Host.", actions: [
    { id: "calendar.list", description: "List events.", risk: "READ", inputs: [input("from", "string", false, "ISO start.")] },
    { id: "calendar.create", description: "Create an appointment.", risk: "EXTERNAL_SIDE_EFFECT", hard: true, inputs: [input("title", "string", true, "Title."), input("start", "string", true, "ISO start.")] },
    { id: "calendar.cancel", description: "Cancel an appointment.", risk: "DESTRUCTIVE", hard: true, inputs: [input("id", "string", true, "Event id.")] } ] },
  { id: "messaging", description: "Chat messaging (Slack and similar official APIs).", detail: "No messaging workspace is connected. Personal messaging UIs are never automated as a substitute.", actions: [
    { id: "messaging.send_message", description: "Send a chat message.", risk: "EXTERNAL_SIDE_EFFECT", hard: true, inputs: [input("to", "string", true, "Channel or user."), input("body", "string", true, "Message.")] },
    { id: "messaging.receive_message", description: "Receive recent messages.", risk: "READ", inputs: [input("since", "number", false, "Epoch ms.")] } ] },
  { id: "sms", description: "SMS through a telephony provider API.", detail: "No SMS provider is configured.", actions: [
    { id: "sms.send_message", description: "Send an SMS.", risk: "EXTERNAL_SIDE_EFFECT", hard: true, inputs: [input("to", "string", true, "Number."), input("body", "string", true, "Text.")] },
    { id: "sms.receive_message", description: "Receive SMS.", risk: "READ", inputs: [] } ] },
  { id: "whatsapp", description: "WhatsApp Business Platform (official API only).", detail: "No WhatsApp Business API account is configured. WhatsApp Web is never automated.", actions: [
    { id: "whatsapp.send_message", description: "Send a WhatsApp message.", risk: "EXTERNAL_SIDE_EFFECT", hard: true, inputs: [input("to", "string", true, "Number."), input("body", "string", true, "Text.")] },
    { id: "whatsapp.receive_message", description: "Receive WhatsApp messages.", risk: "READ", inputs: [] } ] },
  { id: "phone", description: "Voice calls through a telephony backend.", detail: "No telephony provider is configured. Bunny will not simulate calls.", actions: [
    { id: "phone.start_call", description: "Place a call.", risk: "EXTERNAL_SIDE_EFFECT", hard: true, inputs: [input("to", "string", true, "Number.")] },
    { id: "phone.receive_call", description: "Answer an incoming call.", risk: "EXTERNAL_SIDE_EFFECT", hard: true, inputs: [] },
    { id: "phone.speak", description: "Speak text into an active call.", risk: "EXTERNAL_SIDE_EFFECT", hard: true, inputs: [input("callId", "string", true, "Call."), input("text", "string", true, "Text.")] },
    { id: "phone.listen", description: "Transcribe the caller.", risk: "READ", inputs: [input("callId", "string", true, "Call.")] },
    { id: "phone.hang_up", description: "End a call.", risk: "EXTERNAL_SIDE_EFFECT", inputs: [input("callId", "string", true, "Call.")] },
    { id: "phone.transcript", description: "Call transcript.", risk: "READ", inputs: [input("callId", "string", true, "Call.")] } ] },
];

/**
 * A connector whose contract exists but which has no configured backend on this Host. It reports
 * `unconfigured` and every action reports the same; nothing is simulated.
 */
export class UnconfiguredConnector implements CapabilityAdapter {
  spec: ConnectorSpec; provider: CommunicationProvider | null;
  constructor(spec: ConnectorSpec, provider: CommunicationProvider | null = null) {
    this.spec = spec; this.provider = provider;
    this.manifest = {
      id: spec.id, version: "0.1.0", description: spec.description, locality: "remote", platforms: "any", events: [`${spec.id}.received`],
      cost: { kind: "external_service", note: "Depends on the provider once configured." }, adapter: "none configured",
      actions: spec.actions.map((action) => ({ id: action.id, description: action.description, risk: action.risk, hardApproval: action.hard, inputs: action.inputs, outputs: "Provider-specific.", evidence: "Provider message/call id.", timeoutMs: 60_000, implemented: false })),
    };
  }
  manifest: CapabilityAdapter["manifest"];
  async health() { return { availability: "unconfigured" as const, detail: this.spec.detail }; }
  async execute(action: string): Promise<CapabilityResult> {
    return { ok: false, status: "unconfigured", summary: `${action}: ${this.spec.detail}`, output: null, evidence: [], errorCategory: "capability_unavailable" };
  }
}
export function communicationConnectors(): UnconfiguredConnector[] { return SPECS.map((spec) => new UnconfiguredConnector(spec)); }
