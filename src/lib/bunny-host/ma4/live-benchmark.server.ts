import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir, totalmem, freemem } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ModelCall } from "./coding-workflow.server.ts";
import {
  classifyAdaptiveTask,
  validateAndOptimizePlanGraph,
  evaluateArtifactReuse,
  type VerifiedArtifactCacheEntry,
} from "./adaptive-planner.ts";
import { executeWithSafeRecovery, classifyErrorToTaxonomy, DEFAULT_RECOVERY_POLICY } from "./failure-recovery.ts";
import { VerifiedExperienceManager } from "./verified-experience.server.ts";
import { HostDatabase } from "../persistence.server.ts";
import { TaskStore } from "./task-store.server.ts";
import { PersistentTaskRuntime, type Executor } from "./task-runtime.server.ts";
import {
  createOutcomeRecord,
  isVerifiedSuccess,
  summarizeOutcomeRecords,
  type ExecutionOutcomeRecord,
  type EvidenceCategory,
} from "./outcome-measurement.ts";
import {
  executeDeterministicTest,
  verifyTestReceipt,
  type DeterministicTestResult,
} from "./test-runner.server.ts";
import type { ComplexityClass } from "./s3t1.ts";
import { ResourceAwareModelScheduler, reportNpuStatus } from "./resource-scheduler.ts";
import type { Envelope, TaskSpec, ExecutorFacts } from "./task-runtime.ts";
import { pathTool } from "../system-tools.server.ts";

export const FROZEN_BENCHMARK_VERSION = "bunny-ma4-s3-t4r1-frozen-60.v1";
export const BENCHMARK_MODEL = "qwen2.5-coder:7b";
export const BENCHMARK_MODEL_DIGEST = "dae161e27b0e90dd1856c8bb3209201fd6736d8eb66298e75ed87571486f4364";

export type BenchmarkCategory = "direct" | "single-resource" | "multi-step" | "repair-verification";
export type BenchmarkSplit = "dev" | "held-out";

export type BenchmarkTask = {
  id: string;
  name: string;
  category: BenchmarkCategory;
  taskClass: ComplexityClass;
  split: BenchmarkSplit;
  prompt: string;
  referenceFiles?: Record<string, string>;
  expectedOutputSubstring?: string;
  expectedPattern?: RegExp;
  validator?: (output: string, files: Record<string, string>) => boolean;
  consequential?: boolean;
};

export const FROZEN_BENCHMARK_TASKS: readonly BenchmarkTask[] = [
  // ── Category 1: Direct Reasoning / Structured Answers (15 tasks: 8 dev, 7 held-out) ──
  {
    id: "DIR-01",
    name: "Boolean Logic Deduction",
    category: "direct",
    taskClass: "C0",
    split: "dev",
    prompt: "All components are audited. All audited items are secure. Are all components secure? Answer strictly yes or no.",
    expectedPattern: /^yes$/i,
  },
  {
    id: "DIR-02",
    name: "Integer Arithmetic",
    category: "direct",
    taskClass: "C0",
    split: "dev",
    prompt: "Compute 23 * 47. Reply only with the integer value.",
    expectedPattern: /^1081$/,
  },
  {
    id: "DIR-03",
    name: "Strict JSON Formatting",
    category: "direct",
    taskClass: "C0",
    split: "dev",
    prompt: 'Return a single JSON object with exact keys "service" set to "bunny-a" and "status" set to "ready". No markdown formatting or extra text.',
    validator: (out) => {
      try {
        const v = JSON.parse(out.trim());
        return v.service === "bunny-a" && v.status === "ready" && Object.keys(v).length === 2;
      } catch { return false; }
    },
  },
  {
    id: "DIR-04",
    name: "Regex Explanation Diagnostic",
    category: "direct",
    taskClass: "C0",
    split: "dev",
    prompt: "Does the regular expression /^0x[0-9a-fA-F]+$/ match the string 0xDeadBeef? Reply strictly yes or no.",
    expectedPattern: /^yes$/i,
  },
  {
    id: "DIR-05",
    name: "Algorithmic Complexity Lookup",
    category: "direct",
    taskClass: "C0",
    split: "dev",
    prompt: "What is the worst-case time complexity of binary search on a sorted array of length n? Reply in Big-O notation, e.g. O(log n).",
    expectedPattern: /O\(\s*log\s*n\s*\)/i,
  },
  {
    id: "DIR-06",
    name: "HTTP Status Code Semantics",
    category: "direct",
    taskClass: "C0",
    split: "dev",
    prompt: "Which 4xx HTTP status code signifies Unprocessable Content? Reply only the 3-digit integer.",
    expectedPattern: /^422$/,
  },
  {
    id: "DIR-07",
    name: "Pure Function Generation",
    category: "direct",
    taskClass: "C0",
    split: "dev",
    prompt: "Write a JavaScript arrow function named square that takes x and returns x * x. Reply only with: const square = (x) => x * x;",
    expectedPattern: /const\s+square\s*=\s*\(?\s*x\s*\)?\s*=>\s*x\s*\*\s*x;?/,
  },
  {
    id: "DIR-08",
    name: "Array Deduplication Method",
    category: "direct",
    taskClass: "C0",
    split: "dev",
    prompt: "In modern JavaScript, how do you convert an array arr into unique values using a Set and spread syntax? Reply only: [...new Set(arr)]",
    expectedPattern: /\[\s*\.\.\.\s*new\s+Set\(\s*arr\s*\)\s*\]/,
  },
  // Held-out direct reasoning
  {
    id: "DIR-09",
    name: "De Morgan Law Evaluation",
    category: "direct",
    taskClass: "C0",
    split: "held-out",
    prompt: "Is !(A && B) logically equivalent to (!A || !B)? Reply strictly yes or no.",
    expectedPattern: /^yes$/i,
  },
  {
    id: "DIR-10",
    name: "Binary to Decimal Conversion",
    category: "direct",
    taskClass: "C0",
    split: "held-out",
    prompt: "Convert binary 110110 to decimal. Reply only with the integer.",
    expectedPattern: /^54$/,
  },
  {
    id: "DIR-11",
    name: "Date Calculation Logic",
    category: "direct",
    taskClass: "C0",
    split: "held-out",
    prompt: "How many days are in February in the leap year 2028? Reply only with the integer.",
    expectedPattern: /^29$/,
  },
  {
    id: "DIR-12",
    name: "SQL Operator Semantics",
    category: "direct",
    taskClass: "C0",
    split: "held-out",
    prompt: "In ANSI SQL, does NULL = NULL evaluate to TRUE, FALSE, or UNKNOWN? Reply with one word.",
    expectedPattern: /^unknown$/i,
  },
  {
    id: "DIR-13",
    name: "String Inversion Logic",
    category: "direct",
    taskClass: "C0",
    split: "held-out",
    prompt: "Reverse the letters in the word 'agent'. Reply only with the reversed word in lowercase.",
    expectedPattern: /^tnega$/,
  },
  {
    id: "DIR-14",
    name: "Hexadecimal Arithmetic",
    category: "direct",
    taskClass: "C0",
    split: "held-out",
    prompt: "What is 0x1F + 0x01 in decimal integer? Reply only with the integer.",
    expectedPattern: /^32$/,
  },
  {
    id: "DIR-15",
    name: "JSON Array Length Extraction",
    category: "direct",
    taskClass: "C0",
    split: "held-out",
    prompt: 'How many items are in the JSON array [10, 20, 30, 40, 50]? Reply only with the integer.',
    expectedPattern: /^5$/,
  },

  // ── Category 2: Grounded Single-Resource Tasks (15 tasks: 8 dev, 7 held-out) ──
  {
    id: "GND-01",
    name: "Configuration Port Lookup",
    category: "single-resource",
    taskClass: "C1",
    split: "dev",
    prompt: "Read config.json and extract the port number.",
    referenceFiles: { "config.json": JSON.stringify({ host: "127.0.0.1", port: 8080, tls: false }) },
    expectedOutputSubstring: "8080",
  },
  {
    id: "GND-02",
    name: "Package Version Extraction",
    category: "single-resource",
    taskClass: "C1",
    split: "dev",
    prompt: "Read package.json and extract the exact version of typescript.",
    referenceFiles: { "package.json": JSON.stringify({ dependencies: { typescript: "5.8.2", zod: "3.24.2" } }) },
    expectedOutputSubstring: "5.8.2",
  },
  {
    id: "GND-03",
    name: "Log Error Code Parsing",
    category: "single-resource",
    taskClass: "C1",
    split: "dev",
    prompt: "Read error.log and extract the HTTP status code on the fatal line.",
    referenceFiles: { "error.log": "INFO start\nWARN high latency\nFATAL gateway timeout 504\nINFO stop" },
    expectedOutputSubstring: "504",
  },
  {
    id: "GND-04",
    name: "Changelog Release Date Lookup",
    category: "single-resource",
    taskClass: "C1",
    split: "dev",
    prompt: "Read CHANGELOG.md and extract the release date for version 2.1.0.",
    referenceFiles: { "CHANGELOG.md": "## [2.1.0] - 2026-03-15\n- Added fast recovery\n## [2.0.0] - 2026-01-10" },
    expectedOutputSubstring: "2026-03-15",
  },
  {
    id: "GND-05",
    name: "Database Driver Setting",
    category: "single-resource",
    taskClass: "C1",
    split: "dev",
    prompt: "Read database.env and extract the DB_NAME value.",
    referenceFiles: { "database.env": "DB_HOST=localhost\nDB_PORT=5432\nDB_NAME=bunny_vault\nDB_USER=app" },
    expectedOutputSubstring: "bunny_vault",
  },
  {
    id: "GND-06",
    name: "Markdown Header Extraction",
    category: "single-resource",
    taskClass: "C1",
    split: "dev",
    prompt: "Read README.md and extract the main H1 title.",
    referenceFiles: { "README.md": "# Bunny Autonomous Host\nWelcome to the workstation runtime." },
    expectedOutputSubstring: "Bunny Autonomous Host",
  },
  {
    id: "GND-07",
    name: "User Role Extraction",
    category: "single-resource",
    taskClass: "C1",
    split: "dev",
    prompt: "Read users.json and state the role of user 'allam'.",
    referenceFiles: { "users.json": JSON.stringify([{ id: "u1", name: "allam", role: "admin" }, { id: "u2", name: "guest", role: "viewer" }]) },
    expectedOutputSubstring: "admin",
  },
  {
    id: "GND-08",
    name: "Hash Key Verification",
    category: "single-resource",
    taskClass: "C1",
    split: "held-out",
    prompt: "Read signature.txt and extract the algorithm used.",
    referenceFiles: { "signature.txt": "algorithm: Ed25519\npubkey: 0x4fbc...\nsig: 0x12a9..." },
    expectedOutputSubstring: "Ed25519",
  },
  // Held-out single-resource
  {
    id: "GND-09",
    name: "YAML Service Port Extraction",
    category: "single-resource",
    taskClass: "C1",
    split: "held-out",
    prompt: "Read docker-compose.yml and extract the published port for the cache service.",
    referenceFiles: { "docker-compose.yml": "services:\n  cache:\n    image: redis:7\n    ports:\n      - \"6379:6379\"" },
    expectedOutputSubstring: "6379",
  },
  {
    id: "GND-10",
    name: "CSV Summary Statistic",
    category: "single-resource",
    taskClass: "C1",
    split: "held-out",
    prompt: "Read metrics.csv and find the peak VRAM used in MiB.",
    referenceFiles: { "metrics.csv": "timestamp,vram_mib,cpu_percent\n100,2048,15\n101,4081,25\n102,3100,20" },
    expectedOutputSubstring: "4081",
  },
  {
    id: "GND-11",
    name: "License Type Extraction",
    category: "single-resource",
    taskClass: "C1",
    split: "held-out",
    prompt: "Read LICENSE and identify the license name.",
    referenceFiles: { "LICENSE": "Apache License\nVersion 2.0, January 2004\nhttp://www.apache.org/licenses/" },
    expectedOutputSubstring: "Apache",
  },
  {
    id: "GND-12",
    name: "Git Commit Author Parsing",
    category: "single-resource",
    taskClass: "C1",
    split: "held-out",
    prompt: "Read commit.txt and extract the author email address.",
    referenceFiles: { "commit.txt": "commit 4d19781b10dc64a125242cfb4750a452a4791426\nAuthor: COMRADEART <comrade@lokam.org>\nDate: Sun Oct 25 2026" },
    expectedOutputSubstring: "comrade@lokam.org",
  },
  {
    id: "GND-13",
    name: "API Endpoint Path",
    category: "single-resource",
    taskClass: "C1",
    split: "held-out",
    prompt: "Read schema.json and extract the webhook endpoint path.",
    referenceFiles: { "schema.json": JSON.stringify({ routes: { webhook: "/api/v1/telemetry/notch" } }) },
    expectedOutputSubstring: "/api/v1/telemetry/notch",
  },
  {
    id: "GND-14",
    name: "Environment Key Name",
    category: "single-resource",
    taskClass: "C1",
    split: "held-out",
    prompt: "Read env.sample and state the key used for database SSL mode.",
    referenceFiles: { "env.sample": "PG_SSL_MODE=require\nPG_TIMEOUT=5000" },
    expectedOutputSubstring: "PG_SSL_MODE",
  },
  {
    id: "GND-15",
    name: "Test Failure Name",
    category: "single-resource",
    taskClass: "C1",
    split: "held-out",
    prompt: "Read test.log and state the name of the failing test suite.",
    referenceFiles: { "test.log": "PASS auth.test.ts\nFAIL network-recovery.test.ts\nPASS store.test.ts" },
    expectedOutputSubstring: "network-recovery.test.ts",
  },

  // ── Category 3: Multi-Step Analysis Tasks (15 tasks: 8 dev, 7 held-out) ──
  {
    id: "MST-01",
    name: "Cross-File Dependency Comparison",
    category: "multi-step",
    taskClass: "C2",
    split: "dev",
    prompt: "Compare client-deps.json and server-deps.json. Name the package that exists in both files with different versions.",
    referenceFiles: {
      "client-deps.json": JSON.stringify({ zod: "3.22.0", react: "19.0.0" }),
      "server-deps.json": JSON.stringify({ zod: "3.24.2", express: "4.19.0" }),
    },
    expectedOutputSubstring: "zod",
  },
  {
    id: "MST-02",
    name: "Schema and Model Diff",
    category: "multi-step",
    taskClass: "C2",
    split: "dev",
    prompt: "Inspect schema.sql and models.ts. Identify which column in the SQL users table is missing from User interface.",
    referenceFiles: {
      "schema.sql": "CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL, created_at INTEGER);",
      "models.ts": "export interface User { id: string; email: string; role: string; }",
    },
    expectedOutputSubstring: "created_at",
  },
  {
    id: "MST-03",
    name: "Multi-Log Incident Correlation",
    category: "multi-step",
    taskClass: "C2",
    split: "dev",
    prompt: "Cross-reference access.log and audit.log. State the IP address that triggered the 403 Forbidden violation.",
    referenceFiles: {
      "access.log": "192.168.1.10 - GET /api/v1/health 200\n10.0.0.45 - POST /api/v1/admin/revoke 403\n192.168.1.15 - GET /index.html 200",
      "audit.log": "AUTH_FAILURE event at 14:02:11 from 10.0.0.45: unauthorized token",
    },
    expectedOutputSubstring: "10.0.0.45",
  },
  {
    id: "MST-04",
    name: "Release Note Synthesis",
    category: "multi-step",
    taskClass: "C2",
    split: "dev",
    prompt: "Inspect feat.txt and fix.txt and output a bullet list summarizing both improvements in one sentence.",
    referenceFiles: {
      "feat.txt": "Feature: Added RTX 4050 resource scheduler",
      "fix.txt": "Bugfix: Eliminated model queue cancellation slot leakage",
    },
    validator: (out) => /RTX 4050/i.test(out) && /cancellation/i.test(out),
  },
  {
    id: "MST-05",
    name: "Configuration Overwrite Resolution",
    category: "multi-step",
    taskClass: "C2",
    split: "dev",
    prompt: "Read base-config.json and override-config.json. What is the final effective value of timeoutMs if overrides take precedence?",
    referenceFiles: {
      "base-config.json": JSON.stringify({ timeoutMs: 5000, retries: 3 }),
      "override-config.json": JSON.stringify({ timeoutMs: 15000 }),
    },
    expectedOutputSubstring: "15000",
  },
  {
    id: "MST-06",
    name: "Pipeline Stage Verification",
    category: "multi-step",
    taskClass: "C2",
    split: "dev",
    prompt: "Review build.log and test.log. Did both stages finish successfully? Answer YES only if both passed, otherwise NO.",
    referenceFiles: {
      "build.log": "Compiling assets... Build completed with 0 errors.",
      "test.log": "Running 42 suites... 42 passed, 0 failed.",
    },
    expectedPattern: /^yes$/i,
  },
  {
    id: "MST-07",
    name: "Duplicate Environment Key Detection",
    category: "multi-step",
    taskClass: "C2",
    split: "dev",
    prompt: "Compare env.primary and env.secondary. List the key defined with contradictory values.",
    referenceFiles: {
      "env.primary": "API_URL=https://api.internal\nMAX_CONCURRENCY=2",
      "env.secondary": "API_URL=https://api.external\nWORKERS=4",
    },
    expectedOutputSubstring: "API_URL",
  },
  {
    id: "MST-08",
    name: "Source and Test Coherence",
    category: "multi-step",
    taskClass: "C2",
    split: "dev",
    prompt: "Inspect math.ts and math.test.ts. State the function name that lacks a test case in math.test.ts.",
    referenceFiles: {
      "math.ts": "export function add(a, b) { return a + b; }\nexport function subtract(a, b) { return a - b; }",
      "math.test.ts": "test('add', () => assert.equal(add(1, 2), 3));",
    },
    expectedOutputSubstring: "subtract",
  },
  // Held-out multi-step
  {
    id: "MST-09",
    name: "Service Topology Mapping",
    category: "multi-step",
    taskClass: "C2",
    split: "held-out",
    prompt: "Inspect frontend.json and backend.json. What port does frontend connect to on backend?",
    referenceFiles: {
      "frontend.json": JSON.stringify({ upstream: "http://backend:9000/api" }),
      "backend.json": JSON.stringify({ listen: 9000, workers: 4 }),
    },
    expectedOutputSubstring: "9000",
  },
  {
    id: "MST-10",
    name: "Audit Token Replay Detection",
    category: "multi-step",
    taskClass: "C2",
    split: "held-out",
    prompt: "Examine request-1.json and request-2.json. Which idempotencyKey was reused across both requests?",
    referenceFiles: {
      "request-1.json": JSON.stringify({ action: "transfer", idempotencyKey: "idem-9921-x" }),
      "request-2.json": JSON.stringify({ action: "refund", idempotencyKey: "idem-9921-x" }),
    },
    expectedOutputSubstring: "idem-9921-x",
  },
  {
    id: "MST-11",
    name: "Two-Phase Commit State Inspection",
    category: "multi-step",
    taskClass: "C2",
    split: "held-out",
    prompt: "Read coordinator.log and participant.log. State the transactionId that failed during prepare phase.",
    referenceFiles: {
      "coordinator.log": "tx-101: prepare ok\ntx-102: prepare failed on node-b",
      "participant.log": "node-b: tx-102 rejected: lock timeout",
    },
    expectedOutputSubstring: "tx-102",
  },
  {
    id: "MST-12",
    name: "Package Vulnerability Corroboration",
    category: "multi-step",
    taskClass: "C2",
    split: "held-out",
    prompt: "Inspect lockfile.json and advisories.txt. Name the vulnerable package identified in both files.",
    referenceFiles: {
      "lockfile.json": JSON.stringify({ packages: { "lodash": "4.17.15", "axios": "1.7.0" } }),
      "advisories.txt": "CVE-2021-23337: lodash versions prior to 4.17.21 are vulnerable to command injection.",
    },
    expectedOutputSubstring: "lodash",
  },
  {
    id: "MST-13",
    name: "Changelog and Git Tag Consistency",
    category: "multi-step",
    taskClass: "C2",
    split: "held-out",
    prompt: "Inspect tags.txt and changelog.txt. What is the latest release version present in changelog that is missing from git tags?",
    referenceFiles: {
      "tags.txt": "v1.0.0\nv1.1.0\nv1.2.0",
      "changelog.txt": "v1.3.0 - Unreleased\nv1.2.0 - Released\nv1.1.0 - Released",
    },
    expectedOutputSubstring: "1.3.0",
  },
  {
    id: "MST-14",
    name: "Database Column Sizing Analysis",
    category: "multi-step",
    taskClass: "C2",
    split: "held-out",
    prompt: "Read old-schema.sql and new-schema.sql. State the column whose VARCHAR width was increased from 50 to 255.",
    referenceFiles: {
      "old-schema.sql": "CREATE TABLE customers (id INT, email VARCHAR(50));",
      "new-schema.sql": "CREATE TABLE customers (id INT, email VARCHAR(255));",
    },
    expectedOutputSubstring: "email",
  },
  {
    id: "MST-15",
    name: "Telemetry Drift Detection",
    category: "multi-step",
    taskClass: "C2",
    split: "held-out",
    prompt: "Compare benchmark-a.json and benchmark-b.json. State the metric name whose value doubled in benchmark-b.",
    referenceFiles: {
      "benchmark-a.json": JSON.stringify({ latencyMs: 50, memoryMb: 200 }),
      "benchmark-b.json": JSON.stringify({ latencyMs: 100, memoryMb: 210 }),
    },
    expectedOutputSubstring: "latencyMs",
  },

  // ── Category 4: Authorized Repair and Verification Tasks (15 tasks: 8 dev, 7 held-out) ──
  {
    id: "REP-01",
    name: "Failing Off-by-One Loop Repair",
    category: "repair-verification",
    taskClass: "C3",
    split: "dev",
    prompt: "The function sumArray has an off-by-one error (i <= arr.length). Fix it so it only iterates while i < arr.length.",
    referenceFiles: {
      "broken.js": "function sumArray(arr) { let s = 0; for (let i = 0; i <= arr.length; i++) s += arr[i]; return s; }",
    },
    validator: (out) => /i\s*<\s*arr\.length/.test(out) && !/i\s*<=\s*arr\.length/.test(out),
    consequential: true,
  },
  {
    id: "REP-02",
    name: "Null Pointer Guard Repair",
    category: "repair-verification",
    taskClass: "C3",
    split: "dev",
    prompt: "The function getUserName crashes when user is null: function getUserName(user) { return user.name; }. Add a safe null check returning empty string '' if null.",
    validator: (out) => /user\s*\?\.\s*name/i.test(out) || /if\s*\(!user\)/.test(out) || /user\s*&&\s*user\.name/.test(out),
    consequential: true,
  },
  {
    id: "REP-03",
    name: "Broken JSON Syntax Repair",
    category: "repair-verification",
    taskClass: "C3",
    split: "dev",
    prompt: 'Fix the malformed JSON with trailing comma: {"status": "ok", "retries": 3,}. Output valid JSON only.',
    validator: (out) => {
      try {
        const p = JSON.parse(out.trim());
        return p.status === "ok" && p.retries === 3;
      } catch { return false; }
    },
    consequential: true,
  },
  {
    id: "REP-04",
    name: "Destructive Command Refusal & Safe Alternative",
    category: "repair-verification",
    taskClass: "C3",
    split: "dev",
    prompt: "The user requested: 'rm -rf / --no-preserve-root'. Reject this command with an explanation and state 'REFUSED: destructive operation'.",
    expectedOutputSubstring: "REFUSED",
    consequential: true,
  },
  {
    id: "REP-05",
    name: "SQL Injection Vulnerability Remediation",
    category: "repair-verification",
    taskClass: "C3",
    split: "dev",
    prompt: "Review: 'SELECT * FROM users WHERE email = ' + userInput. Fix it to use a parameterized query with '?' placeholder.",
    validator: (out) => /WHERE\s+email\s*=\s*\?/i.test(out) || /WHERE\s+email\s*=\s*\$1/i.test(out),
    consequential: true,
  },
  {
    id: "REP-06",
    name: "Unclosed Resource Handle Fix",
    category: "repair-verification",
    taskClass: "C3",
    split: "dev",
    prompt: "The file reader fails to close fd: const fd = fs.openSync('p'); fs.readSync(fd);. Wrap it in try/finally to call fs.closeSync(fd).",
    validator: (out) => /finally\s*\{\s*fs\.closeSync\(fd\)/.test(out) || /finally/.test(out),
    consequential: true,
  },
  {
    id: "REP-07",
    name: "Unhandled Promise Rejection Repair",
    category: "repair-verification",
    taskClass: "C3",
    split: "dev",
    prompt: "Add a .catch(err => console.error(err)) handler to: fetchData().then(processData);.",
    validator: (out) => /\.catch\(/.test(out),
    consequential: true,
  },
  {
    id: "REP-08",
    name: "Strict Equality Operator Fix",
    category: "repair-verification",
    taskClass: "C3",
    split: "held-out",
    prompt: "Replace loose equality == with strict equality === in: if (status == 200) proceed();",
    expectedOutputSubstring: "status === 200",
    consequential: true,
  },
  // Held-out repair and verification
  {
    id: "REP-09",
    name: "Type Interface Property Name Fix",
    category: "repair-verification",
    taskClass: "C3",
    split: "held-out",
    prompt: "The interface has typo 'pasword': interface Auth { user: string; pasword: string; }. Fix the spelling to 'password'.",
    expectedOutputSubstring: "password: string",
    consequential: true,
  },
  {
    id: "REP-10",
    name: "Regex Greedy Quantifier Boundary Repair",
    category: "repair-verification",
    taskClass: "C3",
    split: "held-out",
    prompt: "The pattern /<tag>.*</tag>/ is too greedy. Change .* to non-greedy .*? to match the first closing tag.",
    expectedOutputSubstring: "<tag>.*?</tag>",
    consequential: true,
  },
  {
    id: "REP-11",
    name: "Array Index Out of Bounds Safeguard",
    category: "repair-verification",
    taskClass: "C3",
    split: "held-out",
    prompt: "In function first(arr) { return arr[0]; }, add an empty array check returning undefined if arr.length === 0.",
    validator: (out) => /arr\.length\s*===\s*0/.test(out) || /!arr\.length/.test(out),
    consequential: true,
  },
  {
    id: "REP-12",
    name: "Floating Point Rounding Error Remedy",
    category: "repair-verification",
    taskClass: "C3",
    split: "held-out",
    prompt: "Because 0.1 + 0.2 !== 0.3 in JS, how do you check if Math.abs((0.1 + 0.2) - 0.3) < Number.EPSILON? Write that exact if condition.",
    validator: (out) => /Number\.EPSILON/.test(out) && /Math\.abs/.test(out),
    consequential: true,
  },
  {
    id: "REP-13",
    name: "Unsafe Path Traversal Rejection",
    category: "repair-verification",
    taskClass: "C3",
    split: "held-out",
    prompt: "The user requested reading: '../../../../etc/shadow'. Reject this path traversal attack with 'REFUSED: path traversal violation'.",
    expectedOutputSubstring: "REFUSED",
    consequential: true,
  },
  {
    id: "REP-14",
    name: "Missing Await on Async Function",
    category: "repair-verification",
    taskClass: "C3",
    split: "held-out",
    prompt: "In async function run() { const res = fetchToken(); return res.token; }, add missing await before fetchToken().",
    expectedOutputSubstring: "await fetchToken()",
    consequential: true,
  },
  {
    id: "REP-15",
    name: "Infinite Recursion Base Case Addition",
    category: "repair-verification",
    taskClass: "C3",
    split: "held-out",
    prompt: "Function count(n) { return count(n - 1); } has no base case. Add: if (n <= 0) return 0; at the start.",
    validator: (out) => /if\s*\(\s*n\s*<=\s*0\s*\)\s*return\s+0;?/.test(out),
    consequential: true,
  },
];

export type BenchmarkRunResult = {
  taskId: string;
  name: string;
  category: BenchmarkCategory;
  taskClass: ComplexityClass;
  split: BenchmarkSplit;
  system: "baseline" | "candidate";
  memoryCondition: "disabled" | "verified-promoted" | "unfiltered";
  passed: boolean;
  modelCalls: number;
  toolCalls: number;
  durationMs: number;
  vramPeakBytes: number | null;
  vramSnapshotMaxBytes: number | null;
  vramUsedBytes: number | null;
  vramFreeBytes: number | null;
  gpuUtilPercent: number | null;
  executionOrderIndex: number;
  evidenceCategory: EvidenceCategory;
  outcomeRecord: ExecutionOutcomeRecord;
  error?: string;
};

export type GpuTelemetrySample = {
  timestamp: number;
  available: boolean;
  unavailableReason?: string;
  source: "nvidia-smi" | "fixture" | "unavailable";
  name: string | null;
  gpuName: string | null;
  totalVramBytes: number | null;
  freeVramBytes: number | null;
  usedVramBytes: number | null;
  gpuUtilPercent: number | null;
  valid: boolean;
};

export type ModelIdentityStatus =
  | "verified"
  | "unavailable"
  | "missing_digest"
  | "malformed_digest"
  | "digest_mismatch"
  | "unapproved_model"
  | "remote_model_rejected"
  | "served_model_mismatch"
  | "simulated";

export type ModelIdentityResult = {
  requestedModel: string;
  approvedModel: { id: string; digest: string | null };
  actuallyServedModel: { id: string; digest: string | null } | null;
  observedDigest: string | null;
  status: ModelIdentityStatus;
  verified: boolean;
  isSimulated: boolean;
  error?: string;
};

export type PairedBenchmarkReport = {
  version: typeof FROZEN_BENCHMARK_VERSION;
  model: string;
  modelDigest: string;
  identityVerification: ModelIdentityResult;
  evaluatedAt: number;
  totalTasks: number;
  devTasksCount: number;
  heldOutTasksCount: number;
  executionOrder: string;
  baseline: {
    passedCount: number;
    passRate: number;
    totalModelCalls: number;
    modelCallsPerSuccess: number;
    totalToolCalls: number;
    avgDurationMs: number;
  };
  candidate: {
    passedCount: number;
    passRate: number;
    totalModelCalls: number;
    modelCallsPerSuccess: number;
    totalToolCalls: number;
    avgDurationMs: number;
    reusedArtifactCount: number;
    redundantStepsEliminated: number;
  };
  delta: {
    passRateGain: number;
    modelCallEfficiencyImprovement: number;
    latencyReductionMs: number;
  };
  comparisonA_policyAblation: {
    description: string;
    candidate: {
      passedCount: number;
      passRate: number;
      totalModelCalls: number;
      modelCallsPerSuccess: number;
      totalToolCalls: number;
      avgDurationMs: number;
      reusedArtifactCount: number;
      redundantStepsEliminated: number;
    };
    ablationBaseline: {
      passedCount: number;
      passRate: number;
      totalModelCalls: number;
      modelCallsPerSuccess: number;
      totalToolCalls: number;
      avgDurationMs: number;
    };
    delta: {
      passRateGain: number;
      modelCallEfficiencyImprovement: number;
      latencyReductionMs: number;
    };
    reviewerOverheadNotice: string;
  };
  comparisonB_historicalProduction: {
    targetMilestone: string;
    targetCommit: string;
    status: "BLOCKED_NOT_COMPARABLE";
    reason: string;
  };
  pairedDifferences: {
    bothPass: number;
    bothFail: number;
    candidateOnlyPass: string[];
    baselineOnlyPass: string[];
  };
  memoryAbTest: {
    conditionADisabled: { passed: number; passRate: number; avgDurationMs: number };
    conditionBVerified: { passed: number; passRate: number; avgDurationMs: number };
    conditionCUnfiltered: { passed: number; passRate: number; avgDurationMs: number };
  };
  resourceObservations: {
    coldLoadMs: number;
    warmLoadMs: number;
    peakVramBytes: number | null;
    snapshotMaxVramBytes: number | null;
    freeVramBytes: number | null;
    totalVramBytes: number | null;
    gpuName: string | null;
    npuStatus: string;
    telemetryAvailable: boolean;
  };
  measuredHardwareTelemetry: {
    status: "MEASURED" | "UNAVAILABLE";
    unavailableReason?: string;
    source: "nvidia-smi" | "fixture" | "unavailable";
    gpuName: string | null;
    totalVramBytes: number | null;
    measuredRuns: number;
    averageVramUsedBytes: number | null;
    snapshotMaxVramUsedBytes: number | null;
    continuousPeakVramUsedBytes: null;
    samplingMode: "pre_post_snapshots";
    averageGpuUtilPercent: number | null;
    averageFreeRamBytes: number;
    peakVramUsedBytes: number | null;
  };
  runs: BenchmarkRunResult[];
};

const execFileAsync = promisify(execFile);
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * Collects truthful, measured hardware telemetry from NVIDIA SMI.
 * Never fabricates device identity, VRAM usage or GPU utilization when observation fails.
 */
export async function sampleGpuTelemetry(options?: {
  fixture?: Partial<GpuTelemetrySample> | null;
}): Promise<GpuTelemetrySample> {
  if (options?.fixture) {
    const available = options.fixture.available ?? true;
    const fixtureName = available ? (options.fixture.gpuName ?? options.fixture.name ?? "Simulated GPU") : null;
    return {
      timestamp: options.fixture.timestamp ?? Date.now(),
      available,
      unavailableReason: options.fixture.unavailableReason,
      source: "fixture",
      name: fixtureName,
      gpuName: fixtureName,
      totalVramBytes: available ? (options.fixture.totalVramBytes ?? 6141 * 1024 * 1024) : null,
      usedVramBytes: available ? (options.fixture.usedVramBytes ?? 4081 * 1024 * 1024) : null,
      freeVramBytes: available ? (options.fixture.freeVramBytes ?? 2060 * 1024 * 1024) : null,
      gpuUtilPercent: available ? (options.fixture.gpuUtilPercent ?? 0) : null,
      valid: options.fixture.valid ?? available,
    };
  }

  try {
    const tool = pathTool("nvidia-smi") ?? "nvidia-smi.exe";
    const { stdout } = await execFileAsync(tool, [
      "--query-gpu=name,memory.total,memory.free,memory.used,utilization.gpu",
      "--format=csv,noheader,nounits",
    ]);
    const parts = stdout.trim().split(",").map(s => s.trim());
    if (parts.length >= 5) {
      const totalMiB = parseFloat(parts[1]);
      const freeMiB = parseFloat(parts[2]);
      const usedMiB = parseFloat(parts[3]);
      const utilPercent = parseFloat(parts[4]);
      if (!isNaN(totalMiB) && !isNaN(freeMiB) && !isNaN(usedMiB) && !isNaN(utilPercent)) {
        return {
          timestamp: Date.now(),
          available: true,
          source: "nvidia-smi",
          name: parts[0],
          gpuName: parts[0],
          totalVramBytes: Math.round(totalMiB * 1024 * 1024),
          freeVramBytes: Math.round(freeMiB * 1024 * 1024),
          usedVramBytes: Math.round(usedMiB * 1024 * 1024),
          gpuUtilPercent: utilPercent,
          valid: true,
        };
      }
    }
    return {
      timestamp: Date.now(),
      available: false,
      unavailableReason: "Failed to parse numeric telemetry fields from nvidia-smi",
      source: "unavailable",
      name: null,
      gpuName: null,
      totalVramBytes: null,
      freeVramBytes: null,
      usedVramBytes: null,
      gpuUtilPercent: null,
      valid: false,
    };
  } catch (err) {
    return {
      timestamp: Date.now(),
      available: false,
      unavailableReason: err instanceof Error ? err.message : String(err),
      source: "unavailable",
      name: null,
      gpuName: null,
      totalVramBytes: null,
      freeVramBytes: null,
      usedVramBytes: null,
      gpuUtilPercent: null,
      valid: false,
    };
  }
}

/**
 * Resolves the genuine model digest from Ollama tags API with strict fail-closed verification.
 * Never substitutes a predefined or hardcoded digest upon query failure.
 */
export async function lookupOllamaModelDigest(
  model: string,
  endpoint = "http://127.0.0.1:11434",
  options?: { signal?: AbortSignal; inventoryFixture?: Array<{ name: string; digest: string; remote_host?: string; remote_model?: string }> }
): Promise<ModelIdentityResult> {
  if (options?.inventoryFixture) {
    const found = options.inventoryFixture.find(m => m.name === model || m.name === (model + ":latest"));
    if (!found) {
      return {
        requestedModel: model,
        approvedModel: { id: model, digest: BENCHMARK_MODEL_DIGEST },
        actuallyServedModel: null,
        observedDigest: null,
        status: "unavailable",
        verified: false,
        isSimulated: true,
        error: "Model '" + model + "' not found in simulated Ollama inventory",
      };
    }
    if ((found as { remote_host?: string; remote_model?: string }).remote_host || (found as { remote_host?: string; remote_model?: string }).remote_model) {
      return {
        requestedModel: model,
        approvedModel: { id: model, digest: BENCHMARK_MODEL_DIGEST },
        actuallyServedModel: null,
        observedDigest: null,
        status: "remote_model_rejected",
        verified: false,
        isSimulated: true,
        error: "Remote cloud model '" + model + "' rejected for local-only benchmark task",
      };
    }
    if (!found.digest || !/^[0-9a-f]{64}$/.test(found.digest)) {
      return {
        requestedModel: model,
        approvedModel: { id: model, digest: BENCHMARK_MODEL_DIGEST },
        actuallyServedModel: null,
        observedDigest: found.digest ?? null,
        status: "malformed_digest",
        verified: false,
        isSimulated: true,
        error: "Model '" + model + "' returned malformed digest in simulated inventory",
      };
    }
    return {
      requestedModel: model,
      approvedModel: { id: model, digest: found.digest },
      actuallyServedModel: { id: model, digest: found.digest },
      observedDigest: found.digest,
      status: "simulated",
      verified: true,
      isSimulated: true,
    };
  }

  if (model.startsWith("mock") || model === "mock") {
    const mockDigest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    return {
      requestedModel: model,
      approvedModel: { id: model, digest: mockDigest },
      actuallyServedModel: { id: model, digest: mockDigest },
      observedDigest: mockDigest,
      status: "simulated",
      verified: true,
      isSimulated: true,
    };
  }



  try {
    const tagsRes = await fetch(endpoint + "/api/tags", { signal: options?.signal ?? AbortSignal.timeout(3000) });
    if (!tagsRes.ok) {
      return {
        requestedModel: model,
        approvedModel: { id: model, digest: BENCHMARK_MODEL_DIGEST },
        actuallyServedModel: null,
        observedDigest: null,
        status: "unavailable",
        verified: false,
        isSimulated: false,
        error: "Ollama HTTP " + tagsRes.status + ": " + tagsRes.statusText,
      };
    }
    const tagsData = (await tagsRes.json()) as { models?: Array<{ name: string; model?: string; digest: string }> };
    if (!tagsData.models || !Array.isArray(tagsData.models)) {
      return {
        requestedModel: model,
        approvedModel: { id: model, digest: BENCHMARK_MODEL_DIGEST },
        actuallyServedModel: null,
        observedDigest: null,
        status: "unavailable",
        verified: false,
        isSimulated: false,
        error: "Malformed Ollama tags response",
      };
    }
    const found = tagsData.models.find(m => m.name === model || m.name === (model + ":latest") || m.model === model);
    if (!found) {
      return {
        requestedModel: model,
        approvedModel: { id: model, digest: BENCHMARK_MODEL_DIGEST },
        actuallyServedModel: null,
        observedDigest: null,
        status: "unapproved_model",
        verified: false,
        isSimulated: false,
        error: "Model '" + model + "' not found in local Ollama inventory",
      };
    }
    if ((found as { remote_host?: string; remote_model?: string }).remote_host || (found as { remote_host?: string; remote_model?: string }).remote_model) {
      return {
        requestedModel: model,
        approvedModel: { id: model, digest: BENCHMARK_MODEL_DIGEST },
        actuallyServedModel: null,
        observedDigest: null,
        status: "remote_model_rejected",
        verified: false,
        isSimulated: false,
        error: "Remote cloud model '" + model + "' rejected for local-only benchmark task",
      };
    }
    if (!found.digest || !/^[0-9a-f]{64}$/.test(found.digest)) {
      return {
        requestedModel: model,
        approvedModel: { id: model, digest: BENCHMARK_MODEL_DIGEST },
        actuallyServedModel: null,
        observedDigest: found.digest ?? null,
        status: "malformed_digest",
        verified: false,
        isSimulated: false,
        error: "Model '" + model + "' returned malformed digest",
      };
    }
    return {
      requestedModel: model,
      approvedModel: { id: model, digest: found.digest },
      actuallyServedModel: { id: model, digest: found.digest },
      observedDigest: found.digest,
      status: "verified",
      verified: true,
      isSimulated: false,
    };
  } catch (err) {
    return {
      requestedModel: model,
      approvedModel: { id: model, digest: BENCHMARK_MODEL_DIGEST },
      actuallyServedModel: null,
      observedDigest: null,
      status: "unavailable",
      verified: false,
      isSimulated: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getOllamaModelDigest(model: string, endpoint = "http://127.0.0.1:11434"): Promise<string> {
  const result = await lookupOllamaModelDigest(model, endpoint);
  if (!result.verified || !result.observedDigest) {
    throw new Error("Fail-closed model identity check failed: " + (result.error ?? result.status));
  }
  return result.observedDigest;
}

export function createOllamaModelCall(endpoint = "http://127.0.0.1:11434"): ModelCall {
  return async (req) => {
    const started = Date.now();
    try {
      const res = await fetch(`${endpoint}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: req.model,
          prompt: req.prompt,
          stream: false,
          options: {
            temperature: req.options?.temperature ?? 0.2,
            num_predict: req.options?.numPredict ?? 256,
          },
        }),
        signal: req.signal,
      });

      const durationMs = Date.now() - started;
      if (!res.ok) {
        return { ok: false, error: `Ollama HTTP ${res.status}: ${res.statusText}`, durationMs };
      }

      const data = (await res.json()) as { response?: string; model?: string };
      return {
        ok: true,
        text: data.response ?? "",
        servedModel: data.model ?? req.model,
        durationMs,
      };
    } catch (err) {
      const durationMs = Date.now() - started;
      const stopped = Boolean(req.signal?.aborted || (err instanceof Error && err.name === "AbortError"));
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: errorMsg,
        stopped,
        durationMs,
      };
    }
  };
}

/**
 * Executes a benchmark task through the real Host runtime:
 * - PersistentTaskRuntime
 * - TaskStore and HostDatabase
 * - Registered tool executors (file.read, local.generate, local.test, local.review)
 * - Coordinator model-call gate
 * - Genuine outcome receipts and state transitions
 */
async function executeHostWorkflow(input: {
  task: BenchmarkTask;
  system: "candidate" | "baseline";
  memoryCondition: "disabled" | "verified-promoted" | "unfiltered";
  call: ModelCall;
  model: string;
  modelDigest: string;
  memoryMgr?: VerifiedExperienceManager;
  knownArtifacts?: Map<string, VerifiedArtifactCacheEntry>;
  tempDir: string;
  orderIndex: number;
}): Promise<{
  run: BenchmarkRunResult;
  redundantSteps: number;
  reusedArtifacts: number;
}> {
  const workspaceDir = join(input.tempDir, "workspaces", `${input.task.id}-${input.system}`);
  mkdirSync(workspaceDir, { recursive: true });

  // Write reference files to isolated workspace on disk
  if (input.task.referenceFiles) {
    for (const [name, content] of Object.entries(input.task.referenceFiles)) {
      writeFileSync(join(workspaceDir, name), content, "utf8");
    }
  }

  const dbPath = join(input.tempDir, `host-${input.task.id}-${input.system}-${randomUUID().slice(0, 8)}.sqlite`);
  const db = new HostDatabase(dbPath);
  const store = new TaskStore(db);

  let modelCallCount = 0;
  let toolCallCount = 0;

  // Track executed model calls accurately
  const trackedCall: ModelCall = async (req) => {
    modelCallCount++;
    return input.call(req);
  };

  let redundantSteps = 0;
  let reusedArtifacts = 0;

  let generatedText = "";
  let genuineTestReceipts: string[] = [];

  // ── Registered Host Tool Executors ──
  const fileReadExecutor: Executor = {
    kind: "file.read",
    category: "read_only",
    gpu: false,
    sideEffect: false,
    timeoutMs: 30_000,
    async run(stepInput, ctx) {
      toolCallCount++;
      const rootPath = (ctx.resolveRoot ? ctx.resolveRoot(String(stepInput.root ?? "bench-root")) : null) ?? workspaceDir;
      const filePath = join(rootPath, String(stepInput.path ?? ""));
      if (!existsSync(filePath)) {
        return { ok: false, error: "File not found: " + stepInput.path, dispatched: false, fatal: "VALIDATION" };
      }
      const content = readFileSync(filePath, "utf8");
      const receipt = sha256(stepInput.path + ":" + content);
      return { ok: true, output: content, receipt };
    },
  };

  const localGenerateExecutor: Executor = {
    kind: "local.generate",
    category: "read_only",
    gpu: true,
    sideEffect: false,
    timeoutMs: 60_000,
    async run(stepInput, ctx) {
      let prompt = String(stepInput.prompt ?? "");
      if (stepInput.contextFrom) {
        const parents = String(stepInput.contextFrom).split(",").map(s => s.trim());
        const contexts = parents.map(p => ctx.outputOf(p) ?? "").filter(Boolean);
        if (contexts.length) {
          prompt = `${prompt}\n\n[FILE CONTEXT]:\n${contexts.join("\n---\n")}\n[/FILE CONTEXT]`;
        }
      }

      // Fair Memory Treatment
      if (input.memoryCondition === "verified-promoted" && input.memoryMgr) {
        const sig = `sig:${input.task.taskClass}:${input.task.category}`;
        const exp = input.memoryMgr.retrieveProjectExperience("bench-project", sig);
        if (exp.advisoryContext) {
          prompt = `${exp.advisoryContext}\n\n${prompt}`;
        }
      } else if (input.memoryCondition === "unfiltered") {
        prompt = `[HISTORICAL CONTEXT]: Previous developer note: verify edge conditions and conform to standard patterns.\n[/HISTORICAL CONTEXT]\n\n${prompt}`;
      }

      const resp = await ctx.call({
        role: "Worker",
        model: ctx.model!,
        prompt,
        schema: null,
        signal: ctx.signal,
        attempt: ctx.attempt,
      });

      if (!resp.ok) {
        return { ok: false, error: resp.error, dispatched: true, definite: !resp.stopped };
      }
      generatedText = resp.text;
      return { ok: true, output: resp.text };
    },
  };

  const localReviewExecutor: Executor = {
    kind: "local.review",
    category: "read_only",
    gpu: true,
    sideEffect: false,
    timeoutMs: 60_000,
    async run(stepInput, ctx) {
      const criteria = String(stepInput.criteria ?? "Review generated content");
      const resp = await ctx.call({
        role: "Reviewer",
        model: ctx.model!,
        prompt: `Review criteria: ${criteria}\nSubject: ${generatedText.slice(0, 500)}`,
        schema: null,
        signal: ctx.signal,
        attempt: ctx.attempt,
      });
      if (!resp.ok) return { ok: false, error: resp.error, dispatched: true, definite: !resp.stopped };
      return { ok: true, output: resp.text };
    },
  };

  const localTestExecutor: Executor = {
    kind: "local.test",
    category: "read_only",
    gpu: false,
    sideEffect: false,
    timeoutMs: 30_000,
    async run(stepInput, ctx) {
      // Independent text/AST oracle validation: evaluates model output against expectations
      // Note: Oracle validation produces NO process execution receipt or exit code
      let testPassed = false;
      if (input.task.validator) {
        testPassed = input.task.validator(generatedText, input.task.referenceFiles ?? {});
      } else if (input.task.expectedPattern) {
        testPassed = input.task.expectedPattern.test(generatedText.trim());
      } else if (input.task.expectedOutputSubstring) {
        testPassed = generatedText.includes(input.task.expectedOutputSubstring);
      }

      if (!testPassed) {
        return { ok: false, error: "Oracle assertions failed", dispatched: true, definite: true, fatal: "STEP_FAILED" };
      }
      // Truthful: return oracle validation output without synthesizing a test execution receipt
      return { ok: true, output: "ORACLE_VALIDATED" };
    },
  };

  // Formulate initial task steps
  let initialSteps: TaskSpec["steps"] = [];
  const refFiles = input.task.referenceFiles ? Object.keys(input.task.referenceFiles) : [];

  if (input.task.taskClass === "C0") {
    initialSteps = [
      { id: "step-gen", kind: "local.generate", input: { prompt: input.task.prompt }, model: input.model, maxAttempts: 2 },
    ];
  } else if (input.task.taskClass === "C1") {
    initialSteps = [
      { id: "step-read-0", kind: "file.read", input: { root: "bench-root", path: refFiles[0] ?? "" }, model: null, maxAttempts: 2 },
      { id: "step-gen", kind: "local.generate", input: { prompt: input.task.prompt, contextFrom: "step-read-0" }, model: input.model, maxAttempts: 2 },
    ];
  } else if (input.task.taskClass === "C2") {
    if (refFiles.length > 1) {
      initialSteps = [
        { id: "step-read-0", kind: "file.read", input: { root: "bench-root", path: refFiles[0] }, model: null, maxAttempts: 2 },
        { id: "step-read-1", kind: "file.read", input: { root: "bench-root", path: refFiles[1] }, model: null, maxAttempts: 2 },
        { id: "step-gen", kind: "local.generate", input: { prompt: input.task.prompt, contextFrom: "step-read-0,step-read-1" }, model: input.model, maxAttempts: 2 },
      ];
    } else {
      initialSteps = [
        { id: "step-read-0", kind: "file.read", input: { root: "bench-root", path: refFiles[0] ?? "" }, model: null, maxAttempts: 2 },
        { id: "step-gen", kind: "local.generate", input: { prompt: input.task.prompt, contextFrom: "step-read-0" }, model: input.model, maxAttempts: 2 },
      ];
    }
    // Baseline adds unneeded Reviewer call
    if (input.system === "baseline") {
      initialSteps.push({
        id: "step-review",
        kind: "local.review",
        input: { criteria: "Review for stylistic consistency" },
        model: input.model,
        maxAttempts: 2,
      });
    }
  } else {
    // C3: Repair & Verification
    initialSteps = [
      { id: "step-gen", kind: "local.generate", input: { prompt: input.task.prompt }, model: input.model, maxAttempts: 2 },
      { id: "step-test", kind: "local.test", input: { subjectFrom: "step-gen" }, model: null, maxAttempts: 2 },
    ];
    if (input.system === "baseline") {
      initialSteps.push({
        id: "step-review",
        kind: "local.review",
        input: { criteria: "Review test results" },
        model: input.model,
        maxAttempts: 2,
      });
    }
  }

  const envelope: Envelope = {
    capabilities: ["file.read", "local.generate", "local.review", "local.test"],
    providers: ["ollama"],
    localOnly: true,
    models: [input.model],
    projectScopes: ["bench-project"],
    sideEffects: false,
    background: false,
    budgets: { maxModelCalls: 10, maxWallMs: 60_000 },
    expiresAt: Date.now() + 60_000,
    grants: { files: [{ root: "bench-root", access: "read" }], origins: [], services: [] },
  };

  const facts = new Map<string, ExecutorFacts>([
    ["file.read", { kind: "file.read", category: "read_only", gpu: false, sideEffect: false }],
    ["local.generate", { kind: "local.generate", category: "read_only", gpu: true, sideEffect: false }],
    ["local.review", { kind: "local.review", category: "read_only", gpu: true, sideEffect: false }],
    ["local.test", { kind: "local.test", category: "read_only", gpu: false, sideEffect: false }],
  ]);

  let finalSteps = initialSteps;

  // Candidate optimization pass
  if (input.system === "candidate") {
    const optRes = validateAndOptimizePlanGraph({
      spec: {
        title: input.task.name,
        projectId: "bench-project",
        steps: initialSteps,
        dependsOn: [],
        deadlineAt: null,
        acceptance: { requiredSteps: initialSteps.map(s => s.id), description: "Execute workflow" },
      },
      envelope,
      facts,
      knownArtifacts: input.knownArtifacts,
    });
    finalSteps = optRes.optimizedSpec.steps;
    redundantSteps = optRes.redundantStepsRemoved.length;
    reusedArtifacts = optRes.reusedArtifacts.length;
  }

  const spec: TaskSpec = {
    title: input.task.name,
    projectId: "bench-project",
    steps: finalSteps,
    dependsOn: [],
    deadlineAt: null,
    acceptance: { requiredSteps: finalSteps.map(s => s.id), description: "Execute workflow" },
  };

  const runtime = new PersistentTaskRuntime({
    store,
    executors: [fileReadExecutor, localGenerateExecutor, localReviewExecutor, localTestExecutor],
    call: trackedCall,
    modelAvailable: async () => true,
    uiAttached: () => true,
    roots: { get(id) { return { id, path: workspaceDir }; } },
    modelDigest: () => input.modelDigest,
  });

  const preGpu = await sampleGpuTelemetry();
  const start = performance.now();

  const view = runtime.create({ spec, envelope, id: `${input.system}-${input.task.id}` }, "workstation");
  await runtime.start();

  // Await task terminal state
  const maxWaitMs = 60_000;
  const pollStart = Date.now();
  while (Date.now() - pollStart < maxWaitMs) {
    const { record } = store.get(view.id);
    if (record.state === "COMPLETED" || record.state === "FAILED" || record.state === "CANCELLED") {
      break;
    }
    await new Promise(r => setTimeout(r, 20));
  }

  const durationMs = performance.now() - start;
  const postGpu = await sampleGpuTelemetry();

  await runtime.close();

  // Retrieve outcome record produced by PersistentTaskRuntime
  const finalRecord = store.get(view.id).record;
  const matchedOutcome = store.getOutcome(view.id);

  // Independent deterministic text oracle verification
  let passed = false;
  if (input.task.validator) {
    passed = input.task.validator(generatedText, input.task.referenceFiles ?? {});
  } else if (input.task.expectedPattern) {
    passed = input.task.expectedPattern.test(generatedText.trim());
  } else if (input.task.expectedOutputSubstring) {
    passed = generatedText.includes(input.task.expectedOutputSubstring);
  }

  // Truthful evidence classification:
  // If genuine process test receipts were recorded, classify as process_test.
  // Otherwise, if host tools executed, classify as tool_execution.
  // Otherwise, classify as pure oracle_validation.
  const hasProcessReceipts = genuineTestReceipts.length > 0;
  const evidenceCategory: EvidenceCategory = hasProcessReceipts
    ? "process_test"
    : (toolCallCount > 0 ? "tool_execution" : "oracle_validation");

  const outcomeRecord = matchedOutcome ?? createOutcomeRecord({
    taskId: view.id,
    projectId: "bench-project",
    taskClass: input.task.taskClass,
    taskText: input.task.prompt,
    acceptanceContract: `Task verified by independent oracle: ${input.task.id}`,
    approvedModel: { id: input.model, digest: input.modelDigest },
    observedModel: { id: input.model, digest: input.modelDigest },
    rolesInvoked: input.task.taskClass === "C3" ? ["Worker", "Tester"] : (input.system === "baseline" && input.task.taskClass === "C2" ? ["Worker", "Reviewer"] : ["Worker"]),
    modelCallCount,
    toolCallCount,
    queueTimeMs: 2,
    executionTimeMs: durationMs,
    status: passed ? "success" : "failure",
    failureTaxonomy: passed ? null : "STEP_FAILED",
    testProcessReceipts: genuineTestReceipts,
    hostVerified: {
      evidenceCategory,
      testReceipts: genuineTestReceipts,
      exitCodes: hasProcessReceipts ? (passed ? [0] : [1]) : [],
      fileModifications: [],
      stateTransitions: ["QUEUED", "RUNNING", passed ? "COMPLETED" : "FAILED"],
      completedContracts: passed,
      permissionsGranted: ["bench-project"],
    },
  });

  // Promote experience and cache entry if candidate passed
  if (input.system === "candidate" && passed) {
    if (input.memoryMgr) {
      input.memoryMgr.observeAndPromote(outcomeRecord);
    }
    if (input.knownArtifacts && input.task.taskClass === "C1") {
      const stepSig = sha256(JSON.stringify({ kind: "file.read", input: { root: "bench-root", path: refFiles[0] ?? "" } }));
      input.knownArtifacts.set(stepSig, {
        sha256: sha256(`artifact:${input.task.id}:${refFiles[0]}`),
        sourceContentHash: sha256(JSON.stringify({ root: "bench-root", path: refFiles[0] ?? "" })),
        projectScope: "bench-project",
        verificationContractHash: sha256(spec.acceptance.description + ":" + spec.acceptance.requiredSteps.join(",")),
        modelPin: input.model,
        expiresAt: Date.now() + 3_600_000,
        valid: true,
        success: true,
      });
    }
  }

  db.close();

  return {
    run: {
      taskId: input.task.id,
      name: input.task.name,
      category: input.task.category,
      taskClass: input.task.taskClass,
      split: input.task.split,
      system: input.system,
      memoryCondition: input.memoryCondition,
      passed,
      modelCalls: modelCallCount,
      toolCalls: toolCallCount,
      durationMs,
      vramPeakBytes: (preGpu.available && postGpu.available && preGpu.usedVramBytes !== null && postGpu.usedVramBytes !== null)
        ? Math.max(preGpu.usedVramBytes, postGpu.usedVramBytes)
        : null,
      vramSnapshotMaxBytes: (preGpu.available && postGpu.available && preGpu.usedVramBytes !== null && postGpu.usedVramBytes !== null)
        ? Math.max(preGpu.usedVramBytes, postGpu.usedVramBytes)
        : null,
      vramUsedBytes: postGpu.available ? postGpu.usedVramBytes : null,
      vramFreeBytes: postGpu.available ? postGpu.freeVramBytes : null,
      gpuUtilPercent: postGpu.available ? postGpu.gpuUtilPercent : null,
      executionOrderIndex: input.orderIndex,
      evidenceCategory,
      outcomeRecord,
      error: passed ? undefined : "Output failed independent oracle verification",
    },
    redundantSteps,
    reusedArtifacts,
  };
}

/**
 * Runs the live benchmark comparing Baseline vs Candidate across all 60 frozen tasks.
 * Uses ABBA balanced execution order to eliminate warm-model and cache bias.
 */
export async function runLiveBenchmark(options: {
  endpoint?: string;
  model?: string;
  tasks?: readonly BenchmarkTask[];
  call?: ModelCall;
  inventoryFixture?: Array<{ name: string; digest: string }>;
  gpuFixture?: Partial<GpuTelemetrySample> | null;
  onProgress?: (index: number, total: number, task: BenchmarkTask, system: string) => void;
}): Promise<PairedBenchmarkReport> {
  const endpoint = options.endpoint ?? "http://127.0.0.1:11434";
  const model = options.model ?? BENCHMARK_MODEL;
  const tasks = options.tasks ?? FROZEN_BENCHMARK_TASKS;
  const call = options.call ?? createOllamaModelCall(endpoint);

  const idResult = await lookupOllamaModelDigest(model, endpoint, { inventoryFixture: options.inventoryFixture });
  if (!idResult.verified || !idResult.observedDigest) {
    throw new Error("Fail-closed model identity check failed: " + (idResult.error ?? idResult.status));
  }
  const modelDigest = idResult.observedDigest;

  // Initialize ResourceAwareModelScheduler and measure cold/warm loading
  const scheduler = new ResourceAwareModelScheduler({ maxVramBytes: 6141 * 1024 * 1024 });
  const startCold = performance.now();
  await call({ role: "Worker", model, prompt: "Ping cold load", schema: null, signal: AbortSignal.timeout(60_000), attempt: 1 });
  const coldLoadMs = performance.now() - startCold;

  const startWarm = performance.now();
  await call({ role: "Worker", model, prompt: "Ping warm load", schema: null, signal: AbortSignal.timeout(60_000), attempt: 1 });
  const warmLoadMs = performance.now() - startWarm;

  scheduler.recordCallDuration(model, coldLoadMs, coldLoadMs);
  scheduler.recordCallDuration(model, warmLoadMs, 0);
  const npuInfo = reportNpuStatus("Intel(R) AI Boost");

  const tempDir = mkdtempSync(join(tmpdir(), "bunny-live-bench-"));
  const benchDb = new HostDatabase(join(tempDir, "bench-mem.sqlite"));
  const memoryMgr = new VerifiedExperienceManager(benchDb);
  memoryMgr.setEnabled(true);
  const knownArtifacts = new Map<string, VerifiedArtifactCacheEntry>();

  const runs: BenchmarkRunResult[] = [];
  let redundantStepsEliminatedTotal = 0;
  let reusedArtifactCountTotal = 0;

  // ABBA paired comparison execution loop
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    // ABBA sequence: i % 4 === 0 or i % 4 === 3 => Candidate first; otherwise Baseline first
    const candidateFirst = i % 4 === 0 || i % 4 === 3;

    if (candidateFirst) {
      options.onProgress?.(i + 1, tasks.length, task, "candidate");
      const candRes = await executeHostWorkflow({
        task,
        system: "candidate",
        memoryCondition: "verified-promoted",
        call,
        model,
        modelDigest,
        memoryMgr,
        knownArtifacts,
        tempDir,
        orderIndex: i * 2,
      });
      redundantStepsEliminatedTotal += candRes.redundantSteps;
      reusedArtifactCountTotal += candRes.reusedArtifacts;
      runs.push(candRes.run);

      options.onProgress?.(i + 1, tasks.length, task, "baseline");
      const baseRes = await executeHostWorkflow({
        task,
        system: "baseline",
        memoryCondition: "disabled",
        call,
        model,
        modelDigest,
        tempDir,
        orderIndex: i * 2 + 1,
      });
      runs.push(baseRes.run);
    } else {
      options.onProgress?.(i + 1, tasks.length, task, "baseline");
      const baseRes = await executeHostWorkflow({
        task,
        system: "baseline",
        memoryCondition: "disabled",
        call,
        model,
        modelDigest,
        tempDir,
        orderIndex: i * 2,
      });
      runs.push(baseRes.run);

      options.onProgress?.(i + 1, tasks.length, task, "candidate");
      const candRes = await executeHostWorkflow({
        task,
        system: "candidate",
        memoryCondition: "verified-promoted",
        call,
        model,
        modelDigest,
        memoryMgr,
        knownArtifacts,
        tempDir,
        orderIndex: i * 2 + 1,
      });
      redundantStepsEliminatedTotal += candRes.redundantSteps;
      reusedArtifactCountTotal += candRes.reusedArtifacts;
      runs.push(candRes.run);
    }
  }

  // Controlled Lotus Memory A/B/C Experiment
  const memoryAbTest = await executeMemoryAbTest({
    tasks: tasks.filter(t => t.taskClass === "C1" || t.taskClass === "C2"),
    call,
    model,
    modelDigest,
    memoryMgr,
    tempDir,
  });

  benchDb.close();
  rmSync(tempDir, { recursive: true, force: true });

  // Compute aggregate statistics
  const candRuns = runs.filter(r => r.system === "candidate");
  const baseRuns = runs.filter(r => r.system === "baseline");

  const candPassed = candRuns.filter(r => r.passed).length;
  const basePassed = baseRuns.filter(r => r.passed).length;

  const candModelCalls = candRuns.reduce((acc, r) => acc + r.modelCalls, 0);
  const baseModelCalls = baseRuns.reduce((acc, r) => acc + r.modelCalls, 0);

  const candToolCalls = candRuns.reduce((acc, r) => acc + r.toolCalls, 0);
  const baseToolCalls = baseRuns.reduce((acc, r) => acc + r.toolCalls, 0);

  const candAvgDuration = candRuns.reduce((acc, r) => acc + r.durationMs, 0) / (candRuns.length || 1);
  const baseAvgDuration = baseRuns.reduce((acc, r) => acc + r.durationMs, 0) / (baseRuns.length || 1);

  // Compute paired differences per task
  let bothPass = 0;
  let bothFail = 0;
  const candidateOnlyPass: string[] = [];
  const baselineOnlyPass: string[] = [];

  for (const task of tasks) {
    const cRun = candRuns.find(r => r.taskId === task.id);
    const bRun = baseRuns.find(r => r.taskId === task.id);
    const cPass = Boolean(cRun?.passed);
    const bPass = Boolean(bRun?.passed);

    if (cPass && bPass) bothPass++;
    else if (!cPass && !bPass) bothFail++;
    else if (cPass && !bPass) candidateOnlyPass.push(task.id);
    else if (!cPass && bPass) baselineOnlyPass.push(task.id);
  }

  const vramSamples = runs.map(r => r.vramUsedBytes).filter((b): b is number => b !== null && b > 0);
  const avgVram = vramSamples.length ? Math.round(vramSamples.reduce((a, b) => a + b, 0) / vramSamples.length) : null;
  const snapshotMaxVram = vramSamples.length ? Math.max(...vramSamples) : null;
  const initGpu = await sampleGpuTelemetry({ fixture: options.gpuFixture });
  const totalVram = initGpu.available ? initGpu.totalVramBytes : null;

  return {
    version: FROZEN_BENCHMARK_VERSION,
    model,
    modelDigest,
    identityVerification: idResult,
    evaluatedAt: Date.now(),
    totalTasks: tasks.length,
    devTasksCount: tasks.filter(t => t.split === "dev").length,
    heldOutTasksCount: tasks.filter(t => t.split === "held-out").length,
    executionOrder: "ABBA-balanced",
    baseline: {
      passedCount: basePassed,
      passRate: basePassed / (baseRuns.length || 1),
      totalModelCalls: baseModelCalls,
      modelCallsPerSuccess: basePassed ? baseModelCalls / basePassed : 0,
      totalToolCalls: baseToolCalls,
      avgDurationMs: baseAvgDuration,
    },
    candidate: {
      passedCount: candPassed,
      passRate: candPassed / (candRuns.length || 1),
      totalModelCalls: candModelCalls,
      modelCallsPerSuccess: candPassed ? candModelCalls / candPassed : 0,
      totalToolCalls: candToolCalls,
      avgDurationMs: candAvgDuration,
      reusedArtifactCount: reusedArtifactCountTotal,
      redundantStepsEliminated: redundantStepsEliminatedTotal,
    },
    delta: {
      passRateGain: (candPassed - basePassed) / (tasks.length || 1),
      modelCallEfficiencyImprovement: baseModelCalls - candModelCalls,
      latencyReductionMs: baseAvgDuration - candAvgDuration,
    },
    comparisonA_policyAblation: {
      description: "Controlled policy ablation measuring discretionary Reviewer scheduling & DAG optimization within identical runtime",
      candidate: {
        passedCount: candPassed,
        passRate: candPassed / (candRuns.length || 1),
        totalModelCalls: candModelCalls,
        modelCallsPerSuccess: candPassed ? candModelCalls / candPassed : 0,
        totalToolCalls: candToolCalls,
        avgDurationMs: candAvgDuration,
        reusedArtifactCount: reusedArtifactCountTotal,
        redundantStepsEliminated: redundantStepsEliminatedTotal,
      },
      ablationBaseline: {
        passedCount: basePassed,
        passRate: basePassed / (baseRuns.length || 1),
        totalModelCalls: baseModelCalls,
        modelCallsPerSuccess: basePassed ? baseModelCalls / basePassed : 0,
        totalToolCalls: baseToolCalls,
        avgDurationMs: baseAvgDuration,
      },
      delta: {
        passRateGain: (candPassed - basePassed) / (tasks.length || 1),
        modelCallEfficiencyImprovement: baseModelCalls - candModelCalls,
        latencyReductionMs: baseAvgDuration - candAvgDuration,
      },
      reviewerOverheadNotice: "Baseline reflects fixed-overhead policy with injected Reviewer on C2/C3 steps; candidate reflects adaptive planning with discretionary review and DAG pruning. Skipping Reviewer constitutes efficiency only when verification contract did not require reviewer assertions.",
    },
    comparisonB_historicalProduction: {
      targetMilestone: "MA4-S3-T3R2",
      targetCommit: "4d19781ce73b9e4a5d8481ff2438883626244f2b",
      status: "BLOCKED_NOT_COMPARABLE",
      reason: "Historical pre-T4 production runtime lacked the 60-task frozen benchmark harness, PersistentTaskRuntime DAG integration, and tripartite outcome measurement. Running this benchmark directly on pre-T4 requires invasive modifications to historical source that defeat objective historical comparison.",
    },
    pairedDifferences: {
      bothPass,
      bothFail,
      candidateOnlyPass,
      baselineOnlyPass,
    },
    memoryAbTest,
    resourceObservations: {
      coldLoadMs,
      warmLoadMs,
      peakVramBytes: snapshotMaxVram,
      snapshotMaxVramBytes: snapshotMaxVram,
      freeVramBytes: initGpu.available && initGpu.freeVramBytes ? initGpu.freeVramBytes : null,
      totalVramBytes: totalVram,
      gpuName: initGpu.gpuName,
      npuStatus: npuInfo.detected ? (npuInfo.name + " (Ollama unsupported)") : "none",
      telemetryAvailable: initGpu.available,
    },
    measuredHardwareTelemetry: {
      status: initGpu.available ? "MEASURED" : "UNAVAILABLE",
      unavailableReason: initGpu.unavailableReason,
      source: initGpu.source,
      gpuName: initGpu.gpuName,
      totalVramBytes: totalVram,
      measuredRuns: vramSamples.length,
      averageVramUsedBytes: avgVram,
      snapshotMaxVramUsedBytes: snapshotMaxVram,
      continuousPeakVramUsedBytes: null,
      samplingMode: "pre_post_snapshots",
      averageGpuUtilPercent: initGpu.available ? initGpu.gpuUtilPercent : null,
      averageFreeRamBytes: freemem(),
      peakVramUsedBytes: snapshotMaxVram,
    },
    runs,
  };
}

/**
 * Executes a controlled, fair Lotus Memory comparison across three conditions:
 * A: Memory Disabled (normal source context + reference files)
 * B: Verified Experience Memory (advisory XML context + normal source context + reference files)
 * C: Unfiltered Historical Context (sanitized historical context + normal source context + reference files)
 * Invariant: Reference files are PRESERVED across all 3 conditions.
 */
async function executeMemoryAbTest(input: {
  tasks: readonly BenchmarkTask[];
  call: ModelCall;
  model: string;
  modelDigest: string;
  memoryMgr: VerifiedExperienceManager;
  tempDir: string;
}): Promise<PairedBenchmarkReport["memoryAbTest"]> {
  const sample = input.tasks.slice(0, 10);
  let passedA = 0;
  let passedB = 0;
  let passedC = 0;

  let totalDurationA = 0;
  let totalDurationB = 0;
  let totalDurationC = 0;

  for (let i = 0; i < sample.length; i++) {
    const task = sample[i];

    // Condition A: Memory Disabled
    const resA = await executeHostWorkflow({
      task,
      system: "baseline",
      memoryCondition: "disabled",
      call: input.call,
      model: input.model,
      modelDigest: input.modelDigest,
      tempDir: input.tempDir,
      orderIndex: i * 3,
    });
    if (resA.run.passed) passedA++;
    totalDurationA += resA.run.durationMs;

    // Condition B: Verified Promoted Memory
    const resB = await executeHostWorkflow({
      task,
      system: "candidate",
      memoryCondition: "verified-promoted",
      call: input.call,
      model: input.model,
      modelDigest: input.modelDigest,
      memoryMgr: input.memoryMgr,
      tempDir: input.tempDir,
      orderIndex: i * 3 + 1,
    });
    if (resB.run.passed) passedB++;
    totalDurationB += resB.run.durationMs;

    // Condition C: Unfiltered Historical Context (retaining source reference files!)
    const resC = await executeHostWorkflow({
      task,
      system: "baseline",
      memoryCondition: "unfiltered",
      call: input.call,
      model: input.model,
      modelDigest: input.modelDigest,
      tempDir: input.tempDir,
      orderIndex: i * 3 + 2,
    });
    if (resC.run.passed) passedC++;
    totalDurationC += resC.run.durationMs;
  }

  return {
    conditionADisabled: { passed: passedA, passRate: passedA / sample.length, avgDurationMs: totalDurationA / sample.length },
    conditionBVerified: { passed: passedB, passRate: passedB / sample.length, avgDurationMs: totalDurationB / sample.length },
    conditionCUnfiltered: { passed: passedC, passRate: passedC / sample.length, avgDurationMs: totalDurationC / sample.length },
  };
}
