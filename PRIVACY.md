# Bunny A — Privacy Policy

*Effective 2026-11-13. Applies to the Bunny A Windows workstation, its Host, and the Bunny A Android companion.*

## Summary

Bunny A runs on your own computer. **The developer does not collect, receive, sell or share any of your data.**
There are no analytics, advertising, tracking or crash-reporting services in either app.

## What stays on your Windows PC

- Your tasks, approvals and their receipts, schedules, notifications, memory notes, paired-device records and settings
  are stored in Bunny A's data folder on your PC. Old finished tasks and notifications are pruned automatically.
- Speech is transcribed on your PC by a local Whisper model. Raw audio is not saved.
- Local AI models (through Ollama) run on your PC; prompts sent to them do not leave it.
- Diagnostics are written locally and redacted. They leave your PC only if you export and send them yourself.

## When data leaves your PC — only if you turn it on

- **Cloud AI models.** If you add an API key for a hosted model provider (for example OpenAI, Anthropic or xAI), the
  prompts and context you send to that model go to that provider over HTTPS, under their privacy policy. Choosing
  "Local only" hides and blocks cloud models.
- **Remote access from your phone.** If you enable remote access, your phone talks to your PC over HTTPS through the
  tunnel or proxy you choose (Bunny A can start a Cloudflare tunnel for you). That provider carries the encrypted
  traffic between your phone and your PC under its own privacy policy.
- **Connected services.** Connectors you authorise (such as folders or accounts) are used only for actions you request
  and, where an action has consequences, approve.

## The Android companion

- Asks for one permission: Internet access.
- Connects only to the HTTPS address you type in — your own PC — and refuses plain HTTP.
- Stores that address and a pairing credential protected by the Android Keystore. Chat text is kept in memory only
  and is gone when the app closes.
- Revoking the phone on your PC, choosing "Forget Locally" in the app, or uninstalling the app removes its access.

## Your choices

- You can see and delete everything Bunny A stores by removing its data folder on your PC and uninstalling the apps.
- Because the developer holds none of your data, there is nothing for the developer to export or delete on request.

## Children

Bunny A is not directed at children under 13.

## Changes and contact

Changes to this policy are published in this file with a new effective date.
Questions: open an issue at https://github.com/COMRADEART/bunny-A/issues.
