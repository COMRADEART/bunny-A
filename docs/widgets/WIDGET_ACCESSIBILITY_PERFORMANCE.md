# Accessibility and performance

## Accessibility

- Cards are in a list. Each card has a name, and the selected card sets `aria-pressed` on Customize.
- Move earlier, Move later, Hide and the resize handle have labels.
- Alt+ArrowUp and Alt+ArrowDown reorder the focused card.
- Focus uses `outline: 2px solid var(--focus)`.
- The phone inspector is a Radix dialog, so focus is trapped and Escape dismisses it.
- High contrast turns cards onto `--glass-solid` and drops blur. `forced-colors` uses Canvas and CanvasText.
- `prefers-reduced-motion`, the shell's `data-motion`, and the widget motion setting (`reduced` or `off`) drop transitions and the scrapbook tilt.
- Buttons use a 44px minimum height. Grids collapse to one column under 900px. Card text uses `overflow-wrap: anywhere` and `min-width: 0`.
- Disabled library buttons stay disabled.

## Performance, measured here

`benchLayout(2000)` in `src/lib/bunny-host/widgets.ts` reorders and resizes the in-memory preference. On this machine, during this session:

- 2000 reorders: 1.37 ms
- 2000 resizes: 0.47 ms

That is a pure-function timing. It is not a browser frame time, a GPU figure or a phone frame time. Those were not measured.

Widgets do not start a timer. They render from the snapshot the shell already applies. The voice card uses the existing voice commands. Refresh uses the existing Host refresh.

Decorative motion is cut by the reduced-motion rules above. Character art keeps the existing animation gate, which pauses off-screen and while the document is hidden.
