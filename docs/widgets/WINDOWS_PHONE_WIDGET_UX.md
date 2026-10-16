# Windows, phone and Notch

## Windows

`WidgetSurface` is mounted from `premium.tsx`.

- Board: above the page, except Approvals, the decision page and the design preview, so an uncertain-outcome review is not covered.
- Sidebar: a column beside the page, width from the preference, with collapse.
- Drawer: a button opens a panel on the opposite edge from the stored Notch edge. Escape and Close persist `drawerOpen: false`. On Approvals and the decision page the drawer stays closed and says why.

Navigation is the existing eight destinations. Widgets open Missions, Agents, Models or Approvals. They are not a ninth primary destination.

## Phone

`PhoneWidgets` is on the phone Home tab. Cards stack. The inspector opens as a bottom sheet (`ThemedDialogContent`) with the dialog focus trap, and padding for the safe area. Usage, Lotus and voice render the withheld states. Reconciliation text says only the workstation owner can decide. Opening a Mission or Agent uses the phone routes that already exist. No workstation command is enabled because the card is visible.

A phone's own layout, if the user applies one, stays in `localStorage` under `bunny-a.widgets.device.v1`. It is not sent to the Host.

## Notch

The studio draws four lines, one per edge (top, bottom, left, right). The current edge shows `Reconcile N` when the Host has uncertain outcomes, otherwise `Agents`. The full studio stays in the desktop workspace.

The WPF Notch is unchanged: voice status and Agent indicators stay where Visual Experience 2.0 put them. Choosing an edge in the inspector only moves the drawer.
