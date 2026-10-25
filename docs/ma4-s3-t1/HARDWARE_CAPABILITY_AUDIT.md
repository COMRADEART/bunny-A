# Hardware capability audit

Probed on this Windows 11 workstation during T1. Figures below are from that probe. They are not a catalogue claim.

| Item | Observed |
| --- | --- |
| OS | Microsoft Windows 11 Pro |
| CPU | Intel Core Ultra 9 185H |
| Cores / logical processors | 16 / 22 |
| RAM | 33150328 KB visible, 11944984 KB free at probe time |
| NVIDIA GPU | GeForce RTX 4050 Laptop GPU |
| NVIDIA driver | 616.92 (`Win32_VideoController` reported 32.0.16.1692) |
| Dedicated VRAM | `nvidia-smi` memory.total **6141 MiB**. Used at probe **265 MiB**. Utilization 40% |
| WDDM AdapterRAM | 4293918720 bytes for the RTX 4050. That WMI value is smaller than `nvidia-smi` and is not the measurement used for admission |
| Other adapters | Intel Arc Graphics (AdapterRAM 2147479552, no vendor telemetry in this probe); two DisplayLink devices with no AdapterRAM |
| CUDA runtime | `nvidia-smi` ran. That shows a CUDA-capable driver. It does not by itself prove a particular model run used CUDA |
| Ollama | 0.40.9 |
| Local models | `huihui_ai/qwen2.5-abliterate:7b` (`103482475c9b`, 4.7 GB), `qwen2.5-coder:7b` (`dae161e27b0e`, 4.7 GB), plus larger local tags and `deepseek-v4.1-flash:cloud` |
| NPU | `Intel(R) AI Boost` is present as a PnP device. Execution support was **not** demonstrated. No driver install and no model conversion |
| Battery | 96% remaining, Win32 BatteryStatus 2 |
| Thermal | Not exposed by the probe used here. The product already treats missing temperature as unavailable |

One `ollama run` of `qwen2.5-coder:7b` then reported processor **39% CPU / 61% GPU**, size **6.8 GB**, context 32768, runner llamacpp. The loaded size is larger than the 6141 MiB dedicated VRAM, which matches the CPU/GPU split. NPU was not the runner.

`hardwareFromProbe()` leaves CUDA, NPU, battery, and thermal unavailable when the caller has no measurement. The diagnostics panel uses the same rule.
