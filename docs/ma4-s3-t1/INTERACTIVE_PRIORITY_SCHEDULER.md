# Interactive priority

Admission order is P0 control, P1 interactive, P2 foreground work, P3 background. The sort is stable only by that rank. It does not grant permissions.

P0 is ordered ahead of queued inference. Voice and chat are P1. The helper `interactiveWaitExceeded` flags a wait over 1500 ms. It does not cancel a consequential tool call to meet that bound.

Preemption is unsupported. When a load does not fit, the new inference is queued or refused. The installed cancellation and deadline behavior in the Host is unchanged.

A simultaneous voice-plus-background run on the live Ollama process was not executed in this session. The queue order is covered by a unit test. Live contention remains NOT TESTED.
