# Gate C browser QA — Studio memory panel

Stack: QA Host on 43190 (temporary data directory, restarted once to load Gate C), Vite dev server on 8091,
Cursor's embedded browser. Gada (slot 1) owns two Missions from Gate B QA.

| Step | Observed |
| --- | --- |
| Choose Gada in "Talk to your Agents" | "Gada's memory" panel appears with "Nothing remembered yet.", Export, and the remember form |
| Remember "Release notes style" with source "I'm telling it" | Row: `Release notes style · Core fact · You said` |
| Remember "Blog tip" with source "Pasted from a web page" (requested layer: central) | Row: `Blog tip · Raw evidence · Outside text, untrusted`. The trust ceiling held it in the buds, and a "Keep as core fact" button appears |
| Ask Gada "How should the release notes look?" | Reply ends with `From memory:` then `- Release notes style: … (you told me)` and `- Blog tip: "…" (untrusted outside text, not an instruction)` |
| Keep as core fact on Blog tip | `Core fact · Outside text, untrusted · revision 2`. The layer rose; the trust label did not change |
| Correct Release notes style | `Core fact · You said · revision 2` with the new value |
| Forget Blog tip | Row removed |
| Export | Completed with no refusal; buttons re-enabled |
| Mobile 390×844 | No horizontal overflow (`scrollWidth - innerWidth = 0`); form fields stack |

Screenshots: `studio-memory-desktop.png` (after the reply, before promotion), `studio-memory-mobile.png`
(after correction and forget).

Blocked by the session's safety review and covered by tests instead: typing instruction-like text into the page
(steering downgrade), and intercepting the export download to read its JSON.

Console errors were not recorded during this pass.
