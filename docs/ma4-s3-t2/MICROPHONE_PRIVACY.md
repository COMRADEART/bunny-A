# Microphone privacy

Voice is still not an authorization authority.

| Control | This head |
| --- | --- |
| Explicit start | Unchanged. Hands-free capture follows Start hands-free and the grant clock (30 min, 2 min idle) |
| Visible capture | Notch and panel say Listening only while the worker confirms capture and the snapshot is fresh |
| Mute and close | Unchanged. Mute does not reopen the lane. Island close sends `voice.session.close` |
| Restart | Not re-tested on a live Host. Existing session tests drop the grant on worker exit |
| Cloud audio | No upload path was added. The panel copy still says Windows speech stays on the PC |
| Raw audio files | The probe writes counts and endpoint names only. No PCM was saved |
| Transcripts as instructions | Classification is deterministic. A correction prompt forbids action claims. It does not raise trust |
| Muted endpoint | The probe saw the default input muted and did not open duplex |

Windows microphone privacy for the worker was `allow` during the probe. That is not a new grant. The endpoint mute was left as it was found.

The worker still launches inside the existing owned-process job. Containment tests passed on the fixture worker (job observable, close leaves no active process). That is process containment, not a new privacy review of the DSP.
