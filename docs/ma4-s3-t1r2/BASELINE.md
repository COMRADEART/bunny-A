# Baseline

The qualification worktree started at the merged `main` of `COMRADEART/bunny-A`. No soak worktree was removed and no soak process was stopped.

## Source

| Fact | Value |
| --- | --- |
| Repository | https://github.com/COMRADEART/bunny-A |
| `main` at fetch | `51217cbe7c4981ee66f3999f7234b5fcabb83dd4` |
| PR #40 | MERGED, 2026-10-25T16:56:55Z |
| PR head | `ba4fdca98d88a35c8f4c72c2b5a9e05f5ff90070` |
| Merge parents | `22b55a400b47a5047b614ca0769a056bef6677dc` and `ba4fdca98d88a35c8f4c72c2b5a9e05f5ff90070` |
| Tree of the merge vs the PR head | identical (`3533e202fe87343e466313e0b06a76be5505e54c`) |
| Worktree | isolated branch `ma4-s3-t1r2-live-qualification` |
| Predecessor used for latency | `bc1c82df8f765e39b1bbb64191a08f3e09f00d95` (PR #38 merge) |

Hosted run `40192245873` completed with conclusion `success` on the PR head `ba4fdca`, event `pull_request`, jobs: typecheck/MA4/UI/builds, full `npm test`, and static security checks. That run does not qualify any commit made after the merge.

## Machine

| Fact | Value |
| --- | --- |
| Machine | Lenovo 83DN |
| CPU | Intel Core Ultra 9 185H, 16 cores, 22 logical processors |
| RAM | 33,945,935,872 bytes |
| GPU | NVIDIA GeForce RTX 4050 Laptop GPU, 6141 MiB, driver 32.0.16.1692 |
| Integrated GPU | Intel Arc Graphics |
| Ollama | 0.40.9 |
| Timed model | `huihui_ai/qwen2.5-abliterate:7b` |
| Timed digest | `103482475c9b4d4032999dd5d7383478cad8b966ae6ae984d525daf7352c2219` |

Other installed tags, not used as substitutes: `qwen2.5-coder:7b` (`dae161e27b0e`), `huihui_ai/Qwen3.8-abliterated:27b`, `huihui_ai/qwen3-abliterated:30b`, `deepseek-v4.1-flash:cloud`. The cloud tag was refused when a local-only task asked for it.

Free physical memory during the contended run was 10,318,568 KB of 33,150,328 KB visible. GPU memory reported by `nvidia-smi` stayed at 210 MiB while that 7B model was resident, so this qualification does not claim the model occupied the RTX 4050.
