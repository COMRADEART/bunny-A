# T12 full-duplex architecture

An explicit 30-minute hands-free grant owns a continuous Windows AEC source inside the existing contained native worker. Independent capture-turn and output-generation identities permit listening while speaking. The microphone releases after idle/expiry/mute/close/device failure.

Microphone -> Windows Voice Capture DSP source-mode AEC -> bounded adaptive VAD -> local whisper partial/final recognition -> local turn controller -> existing tool-free conversation TaskManager/BunnyRouter or canonical Host intent -> streamed sentence chunks -> local SAPI synthesis -> ordered waveOut playback.

The DSP owns the selected render-endpoint reference, alignment and conversion to 16 kHz mono PCM16. Three silence buffers keep that endpoint active. The worker refuses unsafe endpoint identity or unsupported AEC instead of silently enabling raw full duplex.

Acoustic onset pauses output; reliable transcript evidence confirms interruption or resumes a backchannel. Old generations are cancelled. A blocked driver Open is checked again before any PCM submission. Pending reset is reported as pending; inference stop request and acknowledgment are separate.

Audio turns do not own Agent processes. Missions, Tasks, authorization, routing, verification and durable state remain in the existing Host runtime. No second scheduler or permission system was introduced.
