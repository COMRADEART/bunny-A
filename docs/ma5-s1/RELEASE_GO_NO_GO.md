# MA5-S1 — Release decision

This is separate from the engineering verdict (ENGINEERING_REPORT.md) and from the merge recommendation.

| Decision | Verdict | Reason |
|---|---|---|
| Public release / public beta | **NO-GO** | Android has not run on a device (BLOCKED). Physical voice, screen-reader use and runtime display changes are untested. No release signing. The G7 model-quality failure and the unproven skills/memory gains from MA4 remain open. Native productization does not change them. |
| Store publishing (Google Play, Microsoft Store) | **NO-GO** — out of scope | Release signing and submission stay outside S1 |
| Install over the owner's Bunny A | **NO-GO** | Not done and not to be done by automation. The dev candidate installs only into its own folder |
| Owner-run trial of the dev candidate (manual, side by side) | Possible after merge, at the owner's choice | Unsigned; separate install root; uninstall keeps settings |

Release gates that must be cleared independently before any beta:
1. Android physical acceptance on at least one device: upgrade over v3, pairing, chat, Stop, lifecycle, TalkBack.
2. Physical voice acceptance with a real microphone and speaker.
3. A screen-reader pass by a person (Narrator or NVDA; TalkBack).
4. Runtime display-change checks (resolution, scale, taskbar, unplug).
5. Release signing for both platforms, kept outside the repository.
6. Cross-machine reproducibility of the Windows build.
7. The open MA4 quality findings (G7 quality, skills/memory gains).

## S1R1

S1R1 fixed installer ownership and command-outcome truthfulness, and added fault tests (S1R1_FINAL_ACCEPTANCE.md). It does not clear any release gate above. Gate 1 is now **partly** met on one device (S1R1_ANDROID_DEVICE_ACCEPTANCE.md): upgrade over v3, pairing, Stop, lifecycle polling and revoke were observed. Still missing: TalkBack, confirmation that v3 data survives, and a re-pair path after a Host address change. Public beta remains **NO-GO**; merge is **GO for independent review** once the final-SHA checks pass.
