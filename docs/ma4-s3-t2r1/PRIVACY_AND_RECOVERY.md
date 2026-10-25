# Privacy and recovery

Physical cases were not executed. The microphone stayed closed.

| Case | This qualification |
| --- | --- |
| Mute during capture | NOT TESTED. Endpoint was already muted before any open. |
| Permission revocation | NOT TESTED. Consent was read as Allow and not changed. |
| Hands-free grant expiration | NOT TESTED live. Session tests that drop the mic at grant end passed in the library stage. |
| Session closure | NOT TESTED live. |
| Host restart | NOT TESTED live. |
| Voice-worker crash | NOT TESTED live. |
| Microphone disconnection | NOT TESTED. |
| Speaker disconnection | NOT TESTED. |
| AEC unavailable | NOT TESTED. The worker reported DSP support. |
| Recognition timeout | NOT TESTED live. |
| GPU contention | NOT TESTED. |
| Stale output generation | Covered by existing generation tests in the library stage. Not remeasured on a speaker. |
| Partial transcript as a command | Library test: a partial is displayed and never acted on. Not rechecked with a live partial. |

A partial transcript is not a consequential action in the session code. That rule was not given a new physical trial.

The probe did not reopen the microphone after enumeration. No grant was created, so there was no expired grant to reopen against.
