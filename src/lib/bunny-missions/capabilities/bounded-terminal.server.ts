import { parse } from "../vendor/acorn.ts";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { scopedPath } from "../paths.server.ts";

// Nodes originate in the parser. Unknown syntax is refused; no source is evaluated.
type Ast = { type: string; name: string; value: unknown; regex?: unknown; operator: string; kind: string;
  computed: boolean; optional: boolean; callee: Ast; object: Ast; property: Ast; arguments: Ast[];
  expression: Ast; test: Ast; consequent: Ast; alternate: Ast | null; left: Ast; right: Ast; argument: Ast;
  body: Ast[]; declarations: Ast[]; id: Ast; init: Ast | null; source: Ast; specifiers: Ast[]; imported: Ast; local: Ast };

/** A narrow test family, not a JavaScript sandbox. Only pure assertions, literal file reads,
 * console diagnostics and exit are accepted. Execution receives regular-file snapshots. */
export function boundedTestResources(script: string, cwd: string, roots: string[]): string[] {
  const source = parse(readFileSync(script, "utf8"), { ecmaVersion: "latest", sourceType: "module" }) as Ast;
  const imports = new Map<string, string>(); const names = new Set<string>(); const resources = new Set<string>();
  const refuse = (): never => { throw new Error("Delegated tests support pure assertions and literal file reads only; executable imports/wrappers require specific review."); };
  const method = (node: Ast): boolean => {
    if (node.optional) return false;
    if (node.callee.type === "Identifier") {
      const operation = imports.get(node.callee.name);
      if (["readFileSync", "existsSync"].includes(operation ?? "")) {
        if (node.arguments[0]?.type !== "Literal" || typeof node.arguments[0].value !== "string" || node.arguments.length > 2) return refuse();
        const path = scopedPath(cwd, node.arguments[0].value, roots);
        if (isAbsolute(node.arguments[0].value) || relative(cwd, path).startsWith("..")) return refuse();
        resources.add(path); return node.arguments.every(expression);
      }
      return operation === "assert" && node.arguments.every(expression);
    }
    if (node.callee.type !== "MemberExpression" || node.callee.computed || node.callee.optional) return false;
    const target = node.callee.object; const property = node.callee.property.name;
    if (target.type === "Identifier") {
      if (target.name === "process" && property === "exit") return node.arguments.length <= 1 && node.arguments.every(expression);
      if (target.name === "console" && ["log", "error"].includes(property)) return node.arguments.every(expression);
      if (imports.get(target.name) === "assert" && ["equal", "strictEqual", "deepEqual", "deepStrictEqual", "ok", "notEqual"].includes(property)) return node.arguments.every(expression);
    }
    return ["includes", "trim", "startsWith", "endsWith"].includes(property) && expression(target) && node.arguments.every(expression);
  };
  const expression = (node: Ast): boolean => {
    switch (node.type) {
      case "Literal": return !node.regex && (node.value === null || ["string", "number", "boolean"].includes(typeof node.value));
      case "Identifier": return names.has(node.name) || node.name === "undefined";
      case "UnaryExpression": return ["!", "-", "+"].includes(node.operator) && expression(node.argument);
      case "BinaryExpression": case "LogicalExpression": return ["===", "!==", "<", ">", "&&", "||", "+"].includes(node.operator) && expression(node.left) && expression(node.right);
      case "ConditionalExpression": return expression(node.test) && expression(node.consequent) && !!node.alternate && expression(node.alternate);
      case "CallExpression": return method(node);
      case "MemberExpression": return !node.computed && !node.optional && node.object.type === "MemberExpression" && !node.object.computed && node.object.object.type === "Identifier" && node.object.object.name === "process" && node.object.property.name === "env";
      default: return false;
    }
  };
  const statement = (node: Ast): boolean => {
    switch (node.type) {
      case "ImportDeclaration": {
        if (node.source.value === "node:assert/strict" && node.specifiers.length === 1 && node.specifiers[0].type === "ImportDefaultSpecifier") { imports.set(node.specifiers[0].local.name, "assert"); return true; }
        if (node.source.value !== "node:fs" || !node.specifiers.length) return false;
        return node.specifiers.every(item => { if (item.type !== "ImportSpecifier" || !["readFileSync", "existsSync"].includes(item.imported.name)) return false; imports.set(item.local.name, item.imported.name); return true; });
      }
      case "ExpressionStatement": return expression(node.expression);
      case "IfStatement": return expression(node.test) && statement(node.consequent) && (!node.alternate || statement(node.alternate));
      case "BlockStatement": return node.body.every(statement);
      case "VariableDeclaration": return node.kind === "const" && node.declarations.every(item => { if (item.id.type !== "Identifier" || !item.init || !expression(item.init)) return false; names.add(item.id.name); return true; });
      default: return false;
    }
  };
  if (!source.body.every(statement)) refuse();
  return [...resources];
}

export function snapshotBoundedTest(script: string, resources: string[], cwd: string, directory: string, expectedHash: string): string {
  mkdirSync(directory, { recursive: true });
  for (const resource of resources) {
    const path = scopedPath(directory, relative(cwd, resource), [directory]);
    mkdirSync(dirname(path), { recursive: true }); copyFileSync(resource, path);
  }
  const target = join(directory, relative(cwd, script)); mkdirSync(dirname(target), { recursive: true });
  const contents = readFileSync(script);
  if (createHash("sha256").update(contents).digest("hex") !== expectedHash) throw new Error("Approved test changed before execution.");
  writeFileSync(target, contents); boundedTestResources(target, directory, [directory]); return directory;
}
