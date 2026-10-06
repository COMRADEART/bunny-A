// Ad-hoc probe: print the current foreground window's title (for a desktop-quietness watcher).
import { directRun, directOutcome } from "./live-shared.ts";

const o = directOutcome(await directRun("computer.list_windows", {}));
console.log(JSON.stringify({ foreground: o?.output?.foreground ?? null, windows: (o?.output?.windows ?? []).length, calculatorNotepad: (o?.output?.windows ?? []).filter((w) => /calculator|notepad/i.test(`${w.process} ${w.title}`)).length }));