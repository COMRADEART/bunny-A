/**
 * MA4-S2-T6 — Connector Registry, OAuth Scope Governance & Untrusted Content Boundary Enforcement.
 * Every connector declares its provider, supported operations, authentication mechanism, required scopes,
 * data categories, read/write classification, side-effect guarantees, idempotency support, revocation method,
 * audit trail, and error/recovery behavior.
 *
 * Per §T6-F: SyntheticWorkspace contract tests never masquerade as live OAuth provider qualification.
 * Without authorized live test accounts/credentials, live external providers remain disabled and report BLOCKED.
 */

export type ConnectorId = "files" | "browser" | "email" | "calendar" | "docs";

export type OperationClassification = "read" | "draft" | "write_consequential";

export type ConnectorOperationSpec = {
  kind: string;
  operation: string;
  classification: OperationClassification;
  requiredScopes: readonly string[];
  dataCategories: readonly string[];
  sideEffectGuarantee: string;
  idempotency: "none" | "key" | "conditional";
  requiresExplicitApproval: boolean;
  untrustedOutput: boolean;
  recoveryBehavior: "safe_retry" | "verify_by_idempotency_key" | "verify_by_version_cas" | "owner_reconcile_required";
};

export type ConnectorRegistryEntry = {
  connectorId: ConnectorId;
  displayName: string;
  providerType: "local_host" | "controlled_chromium" | "delegated_oauth2";
  authenticationMechanism: "windows_host_acl" | "isolated_session_profile" | "oauth2_pkce_vault_scoped";
  enabledInProductionByDefault: boolean;
  liveQualificationStatus: "QUALIFIED_LOCAL" | "BLOCKED_NO_LIVE_OAUTH_ACCOUNT";
  liveBlockerReason: string | null;
  revocationMethod: string;
  auditTrail: string;
  operations: readonly ConnectorOperationSpec[];
};

export const CONNECTOR_REGISTRY: Readonly<Record<ConnectorId, ConnectorRegistryEntry>> = {
  files: {
    connectorId: "files",
    displayName: "Local Approved Folders",
    providerType: "local_host",
    authenticationMechanism: "windows_host_acl",
    enabledInProductionByDefault: true,
    liveQualificationStatus: "QUALIFIED_LOCAL",
    liveBlockerReason: null,
    revocationMethod: "Remove folder in Tasks -> Folders Bunny-A may read (`connector.roots.set`); takes effect immediately before the next step.",
    auditTrail: "Every file read, stat, list, write, or patch is recorded in ActionLedger with SHA-256 content hashes and automatic pre-write backups.",
    operations: [
      {
        kind: "file.read",
        operation: "read",
        classification: "read",
        requiredScopes: ["files.read:registered_root"],
        dataCategories: ["local_file_text"],
        sideEffectGuarantee: "Read-only; rejects symlinks, junctions, traversal (..), and unregistered or protected paths.",
        idempotency: "none",
        requiresExplicitApproval: false,
        untrustedOutput: true,
        recoveryBehavior: "safe_retry",
      },
      {
        kind: "file.stat",
        operation: "stat",
        classification: "read",
        requiredScopes: ["files.read:registered_root"],
        dataCategories: ["local_file_metadata"],
        sideEffectGuarantee: "Read-only metadata check inside registered folder.",
        idempotency: "none",
        requiresExplicitApproval: false,
        untrustedOutput: true,
        recoveryBehavior: "safe_retry",
      },
      {
        kind: "file.apply",
        operation: "write",
        classification: "write_consequential",
        requiredScopes: ["files.write:registered_root"],
        dataCategories: ["local_file_text"],
        sideEffectGuarantee: "Stages backup before atomic write; bound to exact approved payloadSha256.",
        idempotency: "conditional",
        requiresExplicitApproval: true,
        untrustedOutput: false,
        recoveryBehavior: "verify_by_version_cas",
      },
    ],
  },
  browser: {
    connectorId: "browser",
    displayName: "Controlled Chromium Browser",
    providerType: "controlled_chromium",
    authenticationMechanism: "isolated_session_profile",
    enabledInProductionByDefault: true,
    liveQualificationStatus: "QUALIFIED_LOCAL",
    liveBlockerReason: null,
    revocationMethod: "Revoke domain grant or close browser session via ActionBroker; blocks loopback, RFC1918 private networks, file://, and non-HTTPS schemes.",
    auditTrail: "Records visited URL, extracted selector, form fields, and payloadSha256 in ActionLedger.",
    operations: [
      {
        kind: "browser.open",
        operation: "navigate",
        classification: "read",
        requiredScopes: ["browser.navigate:allowed_domain"],
        dataCategories: ["web_page_text"],
        sideEffectGuarantee: "GET navigation only on permitted HTTPS origin; blocks private/loopback IPs in production.",
        idempotency: "none",
        requiresExplicitApproval: false,
        untrustedOutput: true,
        recoveryBehavior: "safe_retry",
      },
      {
        kind: "browser.submit",
        operation: "submit",
        classification: "write_consequential",
        requiredScopes: ["browser.submit:allowed_domain"],
        dataCategories: ["web_form_submission"],
        sideEffectGuarantee: "Requires explicit approval bound to target origin, action, and form payloadSha256; never auto-replays after crash.",
        idempotency: "none",
        requiresExplicitApproval: true,
        untrustedOutput: false,
        recoveryBehavior: "owner_reconcile_required",
      },
    ],
  },
  email: {
    connectorId: "email",
    displayName: "Email Connector (Provider-Neutral / OAuth2)",
    providerType: "delegated_oauth2",
    authenticationMechanism: "oauth2_pkce_vault_scoped",
    enabledInProductionByDefault: false,
    liveQualificationStatus: "BLOCKED_NO_LIVE_OAUTH_ACCOUNT",
    liveBlockerReason: "No authorized non-production Gmail / Microsoft Graph OAuth client credentials and test accounts are provisioned in this environment.",
    revocationMethod: "Disconnect account in CredentialVault (`vault.revoke(provider, account)`) and delete service grant; active tasks fail closed immediately.",
    auditTrail: "Records account ID, recipient list, subject, bodySha256, and provider messageId/draftId; raw OAuth tokens never enter prompts, logs, or receipts.",
    operations: [
      {
        kind: "email.list",
        operation: "list",
        classification: "read",
        requiredScopes: ["mail.read.metadata"],
        dataCategories: ["email_headers", "email_snippets"],
        sideEffectGuarantee: "Read-only folder listing (at most 50 messages).",
        idempotency: "none",
        requiresExplicitApproval: false,
        untrustedOutput: true,
        recoveryBehavior: "safe_retry",
      },
      {
        kind: "email.read",
        operation: "read",
        classification: "read",
        requiredScopes: ["mail.read.body"],
        dataCategories: ["email_headers", "email_body"],
        sideEffectGuarantee: "Read-only message fetch; output marked untrusted so prompt injection inside an email cannot trigger consequential actions.",
        idempotency: "none",
        requiresExplicitApproval: false,
        untrustedOutput: true,
        recoveryBehavior: "safe_retry",
      },
      {
        kind: "email.draft",
        operation: "create-draft",
        classification: "draft",
        requiredScopes: ["mail.compose.draft"],
        dataCategories: ["email_draft"],
        sideEffectGuarantee: "Creates an unsent draft (`sent: false`) keyed by idempotencyKey; never delivers mail.",
        idempotency: "key",
        requiresExplicitApproval: false,
        untrustedOutput: false,
        recoveryBehavior: "verify_by_idempotency_key",
      },
      {
        kind: "email.send",
        operation: "send",
        classification: "write_consequential",
        requiredScopes: ["mail.send"],
        dataCategories: ["email_outbound"],
        sideEffectGuarantee: "Irreversible external delivery; requires explicit user approval bound to exact recipients, subject, and bodySha256.",
        idempotency: "key",
        requiresExplicitApproval: true,
        untrustedOutput: false,
        recoveryBehavior: "verify_by_idempotency_key",
      },
    ],
  },
  calendar: {
    connectorId: "calendar",
    displayName: "Calendar Connector (Provider-Neutral / OAuth2)",
    providerType: "delegated_oauth2",
    authenticationMechanism: "oauth2_pkce_vault_scoped",
    enabledInProductionByDefault: false,
    liveQualificationStatus: "BLOCKED_NO_LIVE_OAUTH_ACCOUNT",
    liveBlockerReason: "No authorized non-production Google Calendar / Microsoft Graph OAuth client credentials and test accounts are provisioned in this environment.",
    revocationMethod: "Disconnect account in CredentialVault and revoke calendar service grant.",
    auditTrail: "Records account ID, event window, attendee list, and eventId in ActionLedger.",
    operations: [
      {
        kind: "calendar.events",
        operation: "list",
        classification: "read",
        requiredScopes: ["calendar.read"],
        dataCategories: ["calendar_events"],
        sideEffectGuarantee: "Read-only window query (at most 31 days).",
        idempotency: "none",
        requiresExplicitApproval: false,
        untrustedOutput: true,
        recoveryBehavior: "safe_retry",
      },
      {
        kind: "calendar.availability",
        operation: "free-busy",
        classification: "read",
        requiredScopes: ["calendar.read.freebusy"],
        dataCategories: ["calendar_availability"],
        sideEffectGuarantee: "Read-only free/busy slot calculation.",
        idempotency: "none",
        requiresExplicitApproval: false,
        untrustedOutput: true,
        recoveryBehavior: "safe_retry",
      },
      {
        kind: "calendar.propose",
        operation: "propose",
        classification: "draft",
        requiredScopes: ["calendar.read"],
        dataCategories: ["calendar_proposal"],
        sideEffectGuarantee: "Computes conflicts and preview (`created: false`) without notifying attendees.",
        idempotency: "none",
        requiresExplicitApproval: false,
        untrustedOutput: false,
        recoveryBehavior: "safe_retry",
      },
      {
        kind: "calendar.create",
        operation: "create",
        classification: "write_consequential",
        requiredScopes: ["calendar.write.events"],
        dataCategories: ["calendar_invite_outbound"],
        sideEffectGuarantee: "Notifies attendees; requires explicit approval bound to title, start, end, and attendees.",
        idempotency: "none",
        requiresExplicitApproval: true,
        untrustedOutput: false,
        recoveryBehavior: "owner_reconcile_required",
      },
    ],
  },
  docs: {
    connectorId: "docs",
    displayName: "Cloud Documents Connector (Provider-Neutral / OAuth2)",
    providerType: "delegated_oauth2",
    authenticationMechanism: "oauth2_pkce_vault_scoped",
    enabledInProductionByDefault: false,
    liveQualificationStatus: "BLOCKED_NO_LIVE_OAUTH_ACCOUNT",
    liveBlockerReason: "No authorized non-production Google Drive / OneDrive OAuth client credentials and test accounts are provisioned in this environment.",
    revocationMethod: "Disconnect account in CredentialVault and revoke docs service grant.",
    auditTrail: "Records account ID, docId, expectedVersion, newVersion, and contentSha256.",
    operations: [
      {
        kind: "docs.list",
        operation: "list",
        classification: "read",
        requiredScopes: ["docs.read.metadata"],
        dataCategories: ["document_metadata"],
        sideEffectGuarantee: "Read-only document metadata listing.",
        idempotency: "none",
        requiresExplicitApproval: false,
        untrustedOutput: true,
        recoveryBehavior: "safe_retry",
      },
      {
        kind: "docs.read",
        operation: "read",
        classification: "read",
        requiredScopes: ["docs.read.content"],
        dataCategories: ["document_content"],
        sideEffectGuarantee: "Read-only document fetch; marked untrusted to prevent indirect prompt injection.",
        idempotency: "none",
        requiresExplicitApproval: false,
        untrustedOutput: true,
        recoveryBehavior: "safe_retry",
      },
      {
        kind: "docs.write",
        operation: "replace",
        classification: "write_consequential",
        requiredScopes: ["docs.write.content"],
        dataCategories: ["document_content"],
        sideEffectGuarantee: "Compare-and-swap on `expectedVersion`; refuses stale overwrites and requires hash-bound approval.",
        idempotency: "conditional",
        requiresExplicitApproval: true,
        untrustedOutput: false,
        recoveryBehavior: "verify_by_version_cas",
      },
    ],
  },
};

const FORBIDDEN_BROAD_SCOPES = new Set([
  "*",
  "full_access",
  "https://mail.google.com/",
  "https://www.googleapis.com/auth/drive",
  "Directory.ReadWrite.All",
  "Mail.ReadWrite.All",
]);

/**
 * Validates that a connector registration satisfies all T6-A capability and least-privilege rules.
 */
export function validateConnectorRegistration(entry: ConnectorRegistryEntry): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!entry.revocationMethod.trim()) errors.push("Missing revocationMethod.");
  if (!entry.auditTrail.trim()) errors.push("Missing auditTrail.");
  if (!entry.operations.length) errors.push("Connector must declare at least one operation.");

  for (const op of entry.operations) {
    if (!op.requiredScopes.length) {
      errors.push(`${op.kind}: must declare at least one narrow scope.`);
    }
    for (const scope of op.requiredScopes) {
      if (FORBIDDEN_BROAD_SCOPES.has(scope)) {
        errors.push(`${op.kind}: forbidden broad/wildcard scope "${scope}".`);
      }
    }
    if (op.classification === "write_consequential" && !op.requiresExplicitApproval) {
      errors.push(`${op.kind}: write_consequential operation must require explicit approval.`);
    }
    if (op.classification === "read" && !op.untrustedOutput) {
      errors.push(`${op.kind}: read operation from external/file source must mark output as untrusted.`);
    }
  }

  if (entry.providerType === "delegated_oauth2" && entry.enabledInProductionByDefault) {
    errors.push(`${entry.connectorId}: delegated OAuth2 connectors must be disabled by default until explicitly authorized.`);
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Verifies that an OAuth grant covers the operation's required narrow scopes, has not expired or been revoked,
 * and belongs to the exact target account (preventing cross-account confused-deputy execution).
 */
export function verifyOAuthOperationAuthorization(input: {
  operationKind: string;
  requestedAccount: string;
  grant: {
    account: string;
    grantedScopes: readonly string[];
    expiresAt: number;
    revoked: boolean;
  } | null;
  now: number;
}): { allowed: boolean; reason: string | null } {
  const op = Object.values(CONNECTOR_REGISTRY)
    .flatMap((c) => c.operations)
    .find((o) => o.kind === input.operationKind);
  if (!op) return { allowed: false, reason: `Unknown operation "${input.operationKind}".` };
  if (!input.grant) return { allowed: false, reason: `No OAuth grant found for account "${input.requestedAccount}".` };
  if (input.grant.revoked) return { allowed: false, reason: `OAuth grant for "${input.grant.account}" has been revoked.` };
  if (input.grant.expiresAt <= input.now) return { allowed: false, reason: `OAuth grant for "${input.grant.account}" has expired.` };
  if (input.grant.account !== input.requestedAccount) {
    return {
      allowed: false,
      reason: `Cross-account confused-deputy blocked: grant is for "${input.grant.account}", not "${input.requestedAccount}".`,
    };
  }
  const missing = op.requiredScopes.filter((s) => !input.grant!.grantedScopes.includes(s));
  if (missing.length > 0) {
    return { allowed: false, reason: `Missing required narrow scope(s): ${missing.join(", ")}.` };
  }
  return { allowed: true, reason: null };
}
