# MA4-S2-T2 — Controlled browser connector

`ma4/connectors/browser.server.ts`, built on the MA3 isolated browser (`bunny-missions/capabilities/browser*.server.ts`).
Tests: `ma4-s2t2-browser.test.ts` (T2-W1…W6) and workflow B, against synthetic local sites with real Chromium/Chrome/Edge.

## Isolation

| Requirement | How |
|---|---|
| Origin allowlist | grant lists exact origins (`scheme://host[:port]`); checked at creation, before navigation, on the final URL after redirects, and on **every request** by the browser's route handler (subresources, fetches, redirects) |
| Network / DNS | all traffic through the MA3 checking proxy: every DNS answer checked, the checked IP pinned (no rebinding), CONNECT checked |
| Private / internal network | loopback, RFC1918, link-local (incl. `169.254.169.254`), CGNAT, `.local/.internal`, IPv6 ULA/link-local refused at creation; `allowLoopback` is a test-only Host seam |
| Browser → Host escalation | a page cannot reach the Host or any loopback service (T2-W2: the synthetic Host received 0 requests) |
| Session isolation | one browser per task, profile `<Host data>/browser-tasks/<task>`, deleted when the task ends; never the user's own profile (T2-W5: a cookie set in task 1 is absent in task 2) |
| No script injection | page scripts are fixed Host code; a task supplies only URLs, link text, CSS selectors and form values |
| No silent downloads/uploads | downloads disabled; no upload action; mutation methods (POST/PUT…) and websockets refused at the network layer |
| No credential extraction | cookies, storage and field **values** are never read; forms are described by field name/type; password and file fields are never filled; cookie/session/CSRF values printed by a page are redacted (T2-W1, W5) |
| Untrusted content | results stored with `trust: "untrusted"`, fenced for models (T2-W4) |
| Side effects | no submission action exists in this milestone; `browser.form.prepare` returns a proposal and types nothing (T2-W1: server saw no POST) |

## Operations

`browser.open {url}` — navigate + read (title, visible text ≤ 30,000 chars, headings, in-scope links, count of
out-of-scope links, form structure, text SHA-256). `browser.follow {linkText}` — follow a link found on the current page;
the target's origin is checked (off-grant ⇒ `PERMISSION_DENIED`). `browser.extract {selector, attribute?}`.
`browser.form.prepare {form, values}`.

## Lifecycle

Sessions are serialized per task, capped at 3 concurrent, closed when the task reaches a terminal state (runtime
`onTerminal`), on Host shutdown and on failed start; closing waits for the browser to exit, then deletes the profile.
Cancelling mid-browse leaves no session (T2-W6). Each new task pays a browser launch (~0.4–0.5 s locally).

## Known limits

* JavaScript of granted pages runs (needed for real pages); its network reach is the allowlist.
* CI does not run `playwright install`; when the bundled Chromium is absent, the connector (like MA3) falls back to
  installed Chrome, then Edge. Tests skip, stating why, only if none can launch (see the hosted CI result in
  ENGINEERING_REPORT.md for which one ran).
* Authenticated real sites were not accessed (no owner-approved scope); qualification used local synthetic sites.
