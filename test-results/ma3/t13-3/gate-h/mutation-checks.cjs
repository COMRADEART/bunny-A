// Gate H mutation checks: each mutation must make at least one targeted test fail. Files are restored after every run.
// Run from the repository root: node test-results/ma3/t13-3/gate-h/mutation-checks.cjs <out.json>
const fs = require("fs");
const { spawnSync } = require("child_process");
const H = "src/lib/bunny-host/";
const UI = "src/components/island/";
const NATIVE = "install/";
const uiTest = UI + "character-style.test.ts";
const hostTest = H + "character-appearance-host.test.ts";
const notchTest = "scripts/island-notch.test.mjs";
const mutations = [
  { id: "H-M1", what: "appearance validation accepts unknown keys", file: H + "character-style.ts",
    from: "for (const key of Object.keys(record)) if (!KEYS.has(key)) throw new Error(`Unsupported appearance setting: ${key}.`);", to: "", test: uiTest },
  { id: "H-M1h", what: "appearance validation accepts unknown keys (Host)", file: H + "character-style.ts",
    from: "for (const key of Object.keys(record)) if (!KEYS.has(key)) throw new Error(`Unsupported appearance setting: ${key}.`);", to: "", test: hostTest },
  { id: "H-M2", what: "a chosen style is ignored (always the signature)", file: H + "character-style.ts",
    from: "return appearance?.style ?? SIGNATURE_STYLE[weapon];", to: "return SIGNATURE_STYLE[weapon];", test: uiTest },
  { id: "H-M3", what: "style motion runs whatever the Host state", file: UI + "character-style-model.ts",
    from: "characterMotion(input.weapon, input.state, still).base", to: `characterMotion(input.weapon, "CODING", still).base`, test: uiTest },
  { id: "H-M4", what: "high contrast keeps the decorative layers", file: UI + "character-style-model.ts",
    from: "decorations: !appearance.highContrast,", to: "decorations: true,", test: uiTest },
  { id: "H-M5", what: "intensity off is ignored", file: UI + "character-style-model.ts",
    from: `return reduced || (appearance ?? DEFAULT_APPEARANCE).intensity === "off";`, to: "return reduced;", test: uiTest },
  { id: "H-M6", what: "pixel sprites keep cells below the alpha cut", file: UI + "character-style-model.ts",
    from: "if (coverage >= alphaCut && a > 0) {", to: "if (a > 0) {", test: uiTest },
  { id: "H-M7", what: "pixel sprites may upscale small art", file: UI + "character-style-model.ts",
    from: "const scale = Math.min(1, grid / Math.max(width, height));", to: "const scale = grid / Math.max(width, height);", test: uiTest },
  { id: "H-M8", what: "the speaker mark goes to every slot", file: UI + "character-style-model.ts",
    from: "return { speaking: speaker === slot, working: isWorking(state) };", to: `return { speaking: speaker !== null && speaker !== undefined && speaker !== "bunny", working: isWorking(state) };`, test: uiTest },
  { id: "H-M9", what: "the Notch edge rule is swapped", file: UI + "character-style-model.ts",
    from: `return edge === "left" || edge === "right" ?`, to: `return edge === "top" || edge === "bottom" ?`, test: uiTest },
  { id: "H-M10", what: "appearance commands accepted from a paired device", file: H + "http.server.ts",
    from: `if (!local) throw new WorkstationRequiredError("Character appearance is changed on the workstation (Windows Host).");`, to: "", test: hostTest },
  { id: "H-M11", what: "reset keeps the stored row", file: H + "character-style.server.ts",
    from: `DELETE FROM personal_agent_appearance WHERE slot=?`, to: `UPDATE personal_agent_appearance SET updated_at=updated_at WHERE slot=?`, test: hostTest },
  { id: "H-M12", what: "characterAppearance missing from the snapshot", file: H + "http.server.ts",
    from: "characterAppearance: appearanceStore.view(),", to: "", test: hostTest },
  { id: "H-M13", what: "native pixel art drawn with smooth scaling", file: NATIVE + "Bunny-Island.Characters.ps1",
    from: "Scaling = if ($pixel) { 'NearestNeighbor' } else { 'HighQuality' }", to: "Scaling = 'HighQuality'", test: notchTest },
  { id: "H-M14", what: "native high contrast keeps the material effect", file: NATIVE + "Bunny-Island.Characters.ps1",
    from: "$effect = if ($contrast -or $pixel) { $null } else {", to: "$effect = if ($pixel) { $null } else {", test: notchTest },
  { id: "H-M15", what: "native intensity off still animates", file: NATIVE + "Bunny-Island.Characters.ps1",
    from: "Animate = [bool]($Animate -and $intensity -ne 'off')", to: "Animate = [bool]$Animate", test: notchTest },
  { id: "H-M16", what: "native speaker mark on every Agent while one speaks", file: NATIVE + "Bunny-Island.Characters.ps1",
    from: " -and [string]$Foreground -eq [string]$Slot)", to: ")", test: notchTest },
  { id: "H-M17", what: "native unknown style passes through instead of the signature", file: NATIVE + "Bunny-Island.Characters.ps1",
    from: "$style = if ($script:BunnyCharacterStyles -contains $chosen) { $chosen }", to: "$style = if ($chosen) { $chosen }", test: notchTest },
  { id: "H-M18", what: "native material effect re-rendered every frame (no art cache)", file: NATIVE + "Bunny-Island.Weapons.ps1",
    from: "$tag.Art.CacheMode = if ($skin.Effect) {", to: "$tag.Art.CacheMode = if ($false) {", test: notchTest },
];
const results = [];
for (const m of mutations) {
  const original = fs.readFileSync(m.file, "utf8");
  if (!original.includes(m.from)) { results.push({ id: m.id, what: m.what, applied: false, killed: null }); continue; }
  fs.writeFileSync(m.file, original.replace(m.from, m.to));
  try {
    const args = ["--experimental-strip-types", "--test", "--test-concurrency=1", m.test];
    const run = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 600000 });
    const out = `${run.stdout}${run.stderr}`;
    const failing = [...out.matchAll(/^✖ (.+?) \(\d/gm)].map((match) => match[1]).filter((name, index, all) => all.indexOf(name) === index && name !== "failing tests:");
    results.push({ id: m.id, what: m.what, file: m.file, test: m.test, applied: true, exit: run.status, killed: run.status !== 0, failing: failing.slice(0, 4) });
  } finally {
    fs.writeFileSync(m.file, original);
  }
}
for (const r of results) console.log(`${r.id}\t${r.applied ? (r.killed ? "KILLED" : "SURVIVED") : "NOT APPLIED"}\t${r.what}${r.failing ? `\t← ${r.failing.join(" | ")}` : ""}`);
fs.writeFileSync(process.argv[2], JSON.stringify(results, null, 2));
