# Widget Inspector

The inspector is the panel titled Widget Inspector in `widgets.tsx`. Edits stay in a draft. The cards show that draft. Apply sends `widgets.layout` (or writes the device-local layout on a phone). Cancel drops the draft. Reset sends `widgets.reset`, or clears the device-local layout.

## Controls that do something

| Control | Effect |
| --- | --- |
| Selected widget | Chooses which card the size and move controls edit. |
| Size | Sets that widget's size in the draft. The card uses it. |
| Density, spacing, animation | Set on the draft. The panel's data attributes change. |
| Layout | Board, sidebar or drawer on the draft. Apply is what moves the workspace chrome to that mode. |
| Sidebar width | Integer 240–480 on the draft. |
| Move earlier / later, drag, Alt+Arrow | Reorder the draft. |
| Resize handle | Pointer drag snaps to the next permitted size. |
| Hide / Show / Show all | Toggles `hidden` on the draft. Hidden cards leave the grid. |
| Project and Agent | Filter the mission widget. The ids are the projects and slots already in the snapshot. |
| Refresh from Host | Calls the existing Host refresh. |
| Notch edge | Stores which edge the drawer should avoid. It does not move the Notch. |
| Apply, Cancel, Reset | Save, discard, or restore the default board. |

Theme inheritance is text: the name of the current VE2 theme. There is no control that writes a theme from the inspector.

Library rows are disabled and say "not installed". They do not show a success message.

Voice speaker, mute, open and close are on the voice card, not in the draft. They call the Host immediately.
