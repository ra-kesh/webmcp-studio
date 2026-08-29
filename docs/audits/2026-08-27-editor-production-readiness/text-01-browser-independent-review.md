# TEXT-01 browser acceptance independent review

Date: 2026-08-29

Verdict: **ACCEPT — no P0/P1 finding in the reviewed interaction slice**

## Code read

The reviewer inspected the actual implementation and surrounding policy rather
than relying on the passing browser claim:

- Studio's preset insertion, pending menu-edit target, and Radix
  `onCloseAutoFocus` handoff.
- Desktop Add text and compact More surfaces, including their breakpoint
  exclusivity and command enablement.
- The underlying document mutation guard for text insertion.
- Inspector paragraph and object/page alignment accessible names.
- Playwright existing-server selection and the complete TEXT-01 browser
  specification.

## Accepted invariants

- A successful menu insertion stores one exact node ID, clears it atomically on
  close, suppresses trigger restoration only for that insertion, and requests
  Fabric editing in the following frame.
- Escape, outside close, and failed insertion leave the pending owner empty, so
  normal trigger focus restoration remains intact.
- Compact preset rows are hidden from 640 px upward, while the dedicated desktop
  Add text control appears from 640 px. The generic Text product submenu is
  removed from the compact fallback, avoiding duplicate entry paths.
- Visible paths use canonical `object.add-text` enablement; the editor mutation
  boundary independently rejects review/crop writes.
- Paragraph alignment is distinguishable from object/page alignment through
  `Align text left/center/right` names.
- One environment-selected Playwright base URL controls both navigation and
  existing-server reuse, so the port-3001 acceptance run cannot silently start
  another port-3000 server.
- The 16 cases substantively cover the claimed direct-edit, sizing, overflow,
  history, transition, list, and compact behavior. The inactive-editor helper
  accepts Fabric's legitimate textarea removal/recreation while still proving
  focus exit.

## Retained boundary

The review accepts browser interaction behavior only. It does not promote the
still-open Fabric/React/Renderer PNG/PDF corpus to pixel parity and does not
claim TEXT-02 rich-text or font-shaping features.
