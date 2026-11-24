# Bunny A — Privacy Policy

*Effective 2026-11-14. Applies to the Bunny A Windows workstation, its Host, and the Bunny A Android companion.*

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

- Asks for two permissions: Internet access and the microphone.
- Connects only to the HTTPS address you type in — your own PC — and refuses plain HTTP. The one exception is the
  voice model download described below.
- **Voice on the phone.** The microphone is used only while the Bunny A screen is open and after you tap a mic button
  ("Talk to phone" or "Dictate message"). The recording is processed on the phone by an on-device model, kept in
  memory only, never stored and never sent to your PC or anywhere else. Answers from "Talk to phone" stay on the
  phone. A dictated message is only placed in the message box; it goes to your PC only if you tap Send.
- **Voice model download.** The 2.6 GB voice model (Gemma 4 E2B) is downloaded once from Hugging Face, and only after
  you confirm. Like any download, this reveals the phone's IP address to Hugging Face and to the content delivery
  network it uses. No account, cookie or Bunny A credential is sent. You can instead copy the model in over USB, and
  you can remove it at any time on the System tab. Voice adds no analytics or telemetry.
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
