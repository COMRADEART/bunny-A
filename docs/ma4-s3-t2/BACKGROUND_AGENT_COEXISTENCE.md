# Voice and background agents

Voice questions about work go through `classifyTranscript` and the Host-fact builders. They do not ask the chat model to summarize a task.

| Utterance | Kind | Answer source |
| --- | --- | --- |
| What's my agent doing? | `agent_status` | `answerStatus` from agent and mission rows |
| Did the tests pass? | `agent_verification` | Recorded step checks, or a statement that none are recorded |
| Is the build finished? | `agent_verification` | Same. It does not invent a CI result |
| Which model is running? | `agent_model` | The model field on the recorded step, or unknown |

An empty agent list speaks "No agent is running right now." A mission with no checks speaks that no verification is recorded. Voice does not say the composed team is running unless those rows exist.

Spoken drafts still go to the existing mission draft path and wait for review. "approve it", "grant microphone access", and "mark the tests passed" stay `sensitive_refused`. "stop" does not stop an agent. "stop the agent" is a proposal.

No live agent was running during this qualification, so coexistence was not observed under load. The notch detail names "Agent working" or "N agents working" when voice is also active and the Host reports that count. Approval still outranks voice on the notch.
