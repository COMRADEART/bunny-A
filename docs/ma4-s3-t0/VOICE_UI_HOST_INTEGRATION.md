# MA4-S3-T0 — Voice / UI / Host Integration

## Status: PRESERVE (no new full-duplex)

Verify checklist (evidence from prior MA3/MA4 + T0 code review):

| Check | Status |
|---|---|
| PTT does not block background ptask | Designed via Host process separation; **re-verify live** |
| Cancel during speech | Host cancel paths independent of voice session |
| UI reflects Host state | SSE + poll; ptask `taskId` on events fixed in T0 |
| Voice errors leave keyboard usable | Voice failures contained in session manager |
| Mic activation visible | Existing UI indicators |
| Agent indicators from Host | ptask/mission projections |

Glass notch placement: keep; no new decorative animation in T0.
