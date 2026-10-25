# Model and resource scheduling

No new scheduler and no GPU preemption were added. The local model path is still one Host chat task per spoken question, admitted only when that task is allowed to launch without tools.

Background agents are other Host tasks. This milestone does not preempt them. Voice does not start an extra model call for the status, verification, and model questions listed in the coexistence note.

The voice session stops waiting at `VOICE_LIMITS.inferenceTimeoutMs` (60 s). `chat.stop` is requested. The interrupt receipt records `inferenceCancellation` as requested, acknowledged, or failed. An acknowledged HTTP stop is not reported as proof that the provider process has exited. The spoken timeout line matches that.

CPU and GPU during simultaneous audio and inference were not sampled. The acoustic probe did not reach playback, and no model was loaded for a voice turn.
