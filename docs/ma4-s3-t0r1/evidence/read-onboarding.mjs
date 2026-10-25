import { DatabaseSync } from "node:sqlite";
import { readdirSync } from "node:fs";
import { join } from "node:path";
const root = "C:/Users/allam/AppData/Local/Bunny-S3T0R1-Install/state";
for (const name of readdirSync(root).filter((n) => n.endsWith(".sqlite"))) {
  const db = new DatabaseSync(join(root, name), { readOnly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  if (!tables.includes("settings")) {
    console.log(name, "tables", tables.join(","));
    db.close();
    continue;
  }
  const row = db.prepare("SELECT value FROM settings WHERE key=?").get("guided_onboarding_v1");
  console.log(name, row?.value ?? "missing");
  db.close();
}
