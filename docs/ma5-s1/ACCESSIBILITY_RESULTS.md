# MA5-S1 — Accessibility results

## Windows

Verified by automation (UI Automation is the API screen readers use):
- every control the acceptance harness drives is found by its automation name: navigation, chat, approvals,
  settings toggles, voice, notch chips, collapse, approval badge and quick stop;
- list items expose readable names (e.g. approval rows "file.apply · MA5 approve · act-…") instead of type names;
- checkboxes are driven through the UIA Toggle pattern; the app reacts to `Checked`/`Unchecked`, so toggling by
  keyboard or screen reader has the same effect as a mouse click;
- the notch controls are focusable buttons. The notch keeps keyboard focus when it was reached by keyboard, and
  returns focus to the previous window after mouse use;
- keyboard: Ctrl+1…Ctrl+0 for the screens, F5 for refresh, Tab order through the standard controls;
- reduced motion: the notch fade is skipped when Windows animations are off or when the `ReducedMotion` value in
  Bunny A's config file is true (there is no Settings-screen toggle for it).

Not tested:
- Narrator or NVDA use by a person (physical screen-reader qualification);
- high-contrast themes;
- text scaling beyond the display scale factors used (100 % and 150 %);
- colour-contrast measurement.

## Android (source only — no device)

Views are used, so TalkBack works with them by default. Section titles are marked as accessibility headings; touch
targets are at least 48 dp; IME insets keep the composer above the keyboard; status text is updated in place
instead of re-creating views. None of this was exercised with TalkBack on hardware: **BLOCKED**.

Verdict: **PARTIAL**. Semantics are verified by automation; human assistive-technology use has not been qualified.
