// Does Ollama constrain string items to a JSON-Schema pattern? Same prompt with and without the pattern.
const schema = (pattern) => ({ type: "object", properties: { dependencies: { type: "array", items: { type: "string", ...(pattern ? { pattern: "^[A-Za-z_][A-Za-z0-9_.]*$" } : {}) } } }, required: ["dependencies"] });
const prompt = "List the Python modules you would import to parse '1h30m' durations, each followed by a short description in parentheses, e.g. \"re (regular expressions)\". Return JSON.";
for (const p of [false, true]) for (let i = 0; i < 3; i++) {
  const r = await fetch("http://127.0.0.1:11434/api/generate", { method: "POST", body: JSON.stringify({ model: "qwen2.5-coder:7b", prompt, format: schema(p), stream: false, options: { temperature: 0.7, seed: i, num_predict: 200 } }) });
  const out = (await r.json()).response;
  const deps = JSON.parse(out).dependencies;
  console.log(JSON.stringify({ pattern: p, seed: i, deps, allMatch: deps.every(d => /^[A-Za-z_][A-Za-z0-9_.]*$/.test(d)) }));
}
