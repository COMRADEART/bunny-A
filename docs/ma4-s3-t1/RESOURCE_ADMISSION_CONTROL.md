# Resource admission

`admitWork()` queues inference when the estimate exceeds the configured budget, or when memory is unmeasured and another load is already active. It does not start a second model to replace a failure. `onMemoryFailure()` releases the reservation and sets `substituteModel` false.

Control and P0 never wait on that queue. The existing Stop path is still the Host cancellation path. This module does not claim GPU preemption. Ollama on this laptop did not expose a preemption API, and the loaded 7B model already spilled to CPU.

Reservations are machine-wide. `reservationsFor()` keeps another project's bytes in the total. One project cannot zero them.

Unknown sizes stay null. The policy does not treat a missing budget as zero or as infinite headroom for a second load.
