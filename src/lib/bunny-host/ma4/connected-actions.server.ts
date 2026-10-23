import { join } from "node:path";
import type { ZodObject, ZodRawShape } from "zod";
import type { HostDatabase } from "../persistence.server.ts";
import type { HostContainment } from "../failure.server.ts";
import { ActionLedger, brokered, type Connector } from "./action-broker.server.ts";
import { FileRootRegistry, fileConnectors } from "./connectors/files.server.ts";
import { BrowserSessions, browserConnectors } from "./connectors/browser.server.ts";
import { serviceConnectors, type ServiceProvider } from "./connectors/services.server.ts";
import type { CatalogEntry } from "./connected-workflow.server.ts";
import type { Executor } from "./task-runtime.server.ts";

/**
 * MA4-S2-T2 Host wiring of connected actions. Every connector is registered here, wrapped by the broker; there is no
 * other path from a task step to a file, a page or an account. Production registers local files and the controlled
 * browser. Service adapters are registered only when a provider is supplied — this milestone supplies only the recorded
 * synthetic workspace, through a test-only Host seam — so no live account is ever reachable.
 */
export type ConnectedOptions = {
  /** Test-only: synthetic local sites on 127.0.0.1. Production never browses loopback or private networks. */
  allowLoopback?: boolean;
  /** Test-only: a recorded synthetic provider. Absent in production (no live provider in this milestone). */
  services?: ServiceProvider | null;
  headless?: boolean;
};

const summaryOf = (c: Connector<never>["contract"]) => `${c.operation} ${c.resource} via ${c.connector}${c.category === "read_only" ? " (read-only)" : ""}`;
const inputsOf = (c: Connector<never>["contract"]) => {
  const schema = c.input as unknown as Partial<ZodObject<ZodRawShape>> & { _def?: { schema?: Partial<ZodObject<ZodRawShape>> } };
  const shape = schema.shape ?? schema._def?.schema?.shape; // a refined object keeps its shape one level down
  return shape ? Object.keys(shape) : [];
};

export function connectedActions(deps: { db: HostDatabase; dataDirectory: string; protectedPaths: string[]; containment?: HostContainment } & ConnectedOptions) {
  const ledger = new ActionLedger(deps.db);
  const roots = new FileRootRegistry(deps.db, deps.protectedPaths);
  const browser = new BrowserSessions({ dataDirectory: deps.dataDirectory, allowLoopback: deps.allowLoopback ?? false, headless: deps.headless, containment: deps.containment });
  const connectors: Connector<never>[] = [
    ...fileConnectors({ roots, backupDirectory: join(deps.dataDirectory, "connector-backups") }),
    ...browserConnectors(browser),
    ...(deps.services ? serviceConnectors(deps.services) : []),
  ];
  const executors: Executor[] = connectors.map(c => brokered(c, ledger));
  const catalog: CatalogEntry[] = [
    { kind: "local.generate", summary: "write text with a pinned local model (Worker)", inputs: ["prompt", "contextFrom", "maxTokens"], consequential: false },
    { kind: "local.review", summary: "check a step's result against criteria (Reviewer)", inputs: ["criteria", "subjectFrom", "contextFrom"], consequential: false },
    ...connectors.map(c => ({ kind: c.contract.kind, summary: summaryOf(c.contract), inputs: inputsOf(c.contract), consequential: c.contract.consequential })),
  ];
  return { ledger, roots, browser, connectors, executors, catalog, close: () => browser.closeAll() };
}
export type ConnectedActions = ReturnType<typeof connectedActions>;
