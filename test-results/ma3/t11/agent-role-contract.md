# M-A-3 T11 — Agent role contract

Source of truth: `ROLE_CONTRACTS` in `src/lib/bunny-missions/team.ts`. Roles describe **responsibility only**. No role
carries a provider, a model, a credential, a capability grant or an approval right. Models are chosen per task by the
existing BunnyRouter under Host constraints; capabilities are planned by the Host from the task kind.

| Role | Who creates it | May perform (task kinds) | Inputs | Outputs | Verified by |
|---|---|---|---|---|---|
| Coordinator | `AgentRuntime.createTeam` (user) | none | objective, requirements | none (Mission result is assembled by the Host) | Mission completes only when every live task verified |
| Planner | `createTeam` | `plan` | objective, requirements, Host offer | one plan document (untrusted) | Host schema/graph/role/kind/path/coverage/budget validation |
| Researcher | `allocateTeam` | `observe`, `generate_json`, `generate_markdown`, `write_file` | Host observations of offered project files or the Git log | dataset or notes | dataset schema; written files hash-bound to the verified source |
| Implementer | `allocateTeam` | `generate_html`, `generate_json`, `write_file` | verified handoffs | the offline deliverable | HTML structural/offline checks; written file hash-bound; requirements by the Tester |
| Documenter | `allocateTeam` | `generate_markdown`, `write_file` | objective, verified handoffs | Markdown documentation | heading check; written file hash-bound |
| Reviewer | `allocateTeam` | `review` | a fresh Host observation of the delivered file, requirements | findings (advisory) | structure only — never completes, fails or authorizes |
| Tester | `allocateTeam` | `verify_output` | the delivered file | Host verification records | deterministic Host checks of every user requirement |

## Delegation rules

* Only the Planner proposes tasks; only the Host turns them into executable steps.
* A plan cannot assign `coordinator` or `planner`, cannot name providers/models/permissions/commands/URLs, and cannot
  exceed `maxAgents` distinct member roles.
* Member identities are created only for a validated plan, reused per role across revisions, never resurrected.
* Pause/Resume/Stop of a member affect only that member's own steps. Plan approval, plan revision and consent belong to
  the Coordinator and the workstation; paired devices may supervise (pause/resume/stop) but not approve or revise.
* Every task kind's model work is tool-free local generation; every effect is a Host capability.
