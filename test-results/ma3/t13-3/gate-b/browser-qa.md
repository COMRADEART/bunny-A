# T13.3 Gate B — browser QA (isolated QA Host)

Stack: a development Host on port 43190 with state in `%TEMP%\bunny-t13-3-qa` (never the installed production Host on 43119),
plus a Vite preview on 127.0.0.1:8091 pointed at that state. Seeded through the real command API: Missions enabled; slot 1 (Gada)
owns "Website redesign" and "Release notes"; slot 2 (Spear) owns "Game prototype". The browser was Cursor's embedded browser.

## Checked

| Check | Result |
| --- | --- |
| Studio shows "Talk to your Agents" with a Bunny + four-slot speaker radiogroup | pass |
| Gada's turns persist across a full page reload (Host-held, not client state) | pass |
| "How are the release notes going?" → Gada answers about "Release notes" only, step counts + "verified by the Host" | pass |
| Spear has its own empty history; "How is the game prototype?" → answers about "Game prototype" only | pass |
| Choosing Bunny hides the message box and says Bunny is answering | pass |
| 1920×1080 and 390×844: no horizontal overflow (`scrollWidth > clientWidth` false; no element past the viewport) | pass |
| No uncaught errors, unhandled rejections or `console.error`/`console.warn` during speaker switches and sends | pass (recorder attached after load; a load-time crash would have shown the error screen, which did not happen) |
| Recent Missions credits every owned Mission to its Personal Agent (after fix 3) | pass |

Screenshots: `studio-talk-desktop.png`, `studio-talk-mobile.png`, `chat-recent-missions-ownership.png`.

## Defects found and fixed during QA

1. Speaker chips said "Gada · 2 working" when both owned Agents were `CREATED` (not started). The count now includes only
   PLANNING, RUNNING, VERIFYING and WAITING_FOR_DEPENDENCY, so an idle Agent never reads as working.
2. A draft typed for one Agent stayed in the box after switching to another, so it could be sent to the wrong Agent. Switching
   speaker now clears the draft.
3. Ownership was invisible outside the Studio: "Other agents" listed Gada's second Agent as an unowned row, and Recent
   Missions showed "Release notes" with no Personal Agent. Both now read the Host's ownership ledger. Only the focused Agent's
   Mission carries the slot's live presentation state; other owned Missions show the weapon without borrowing that state.
   Unit test: `chat-model.test.ts` "T13.3 chat: every Mission a Personal Agent owns carries its weapon…".

## Not exercised here, and why

- Keyboard Enter submission: the embedded browser dispatches untrusted synthetic key events (`isTrusted: false`), which never
  trigger a form's implicit submission. The form is a standard `<form>` with an enabled `type="submit"` button, so a real
  Enter submits; this was not demonstrated with a trusted key event (Playwright is not installed on this workstation).
- Credential refusal in the conversation box: covered by the real-Host HTTP test
  (`personal-agent-context-host.test.ts`); not typed into the browser.
- Speaker chips are about 27 px tall on mobile, which is the existing Studio `st-tag` size, below a 44 px touch target. Left
  for the redesign milestone.
- The `?view=agents` deep link opened Chat on first load. T13.3 did not touch navigation; observed only, not investigated.
