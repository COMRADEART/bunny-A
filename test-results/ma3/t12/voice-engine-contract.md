# Replaceable voice subsystem contract

voice-protocol.ts defines bounded JSON-line worker input/output, session/turn/generation identity and measured state. voice-worker.server.ts owns manifest verification, minimal environment, suspended launch and Windows Job containment.

Capture and playback adapters remain inside BunnyVoiceWorker.cs; recognition is the pinned whisper shim; local SAPI is the synthesis adapter. VoiceSessionManager owns privacy grants, clocks, rearm/finalization deadlines, generation fencing and conversation/Agent bridges. VoiceTurnTaking is a pure separately tested controller.

Adapters may change without replacing MissionManager, TaskManager, BunnyRouter, AgentRuntime, Host authorization or canonical verification. Partial transcripts have no command authority. Actual capture/playback receipts govern the UI; request or configuration flags do not prove audio activity.

Reset telemetry separates the bounded command wait, pending reset, acknowledged reset and endpoint-meter silence. No remote compute cancellation is inferred from local audio cancellation.
