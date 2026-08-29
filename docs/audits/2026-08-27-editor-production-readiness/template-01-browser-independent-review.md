# TEMPLATE-01 browser independent review

Date: 2026-08-29

Final verdict: **ACCEPT — no remaining P0/P1**

## Review history

The reviewer rejected the first browser candidate because durable multi-document
creation still presented and accepted a destructive single-draft replacement
warning. The repair created a separate durable record and route while preserving
the exact original IndexedDB record.

The reviewer rejected the next candidate because the visible editor was blocked
but registered WebMCP tools could still propose or publish against the retiring
document during awaited creation. The route handoff also released the editor
lock before navigation resolved.

## Accepted boundary

- The transition lock begins before the first awaited flush and remains active
  through the awaited create and route-navigation handoff.
- A full `aria-busy` surface removes ordinary interactive editor controls during
  creation and navigation.
- Canonical editor mutations, direct review proposals, and direct publication
  reject the same transition interval.
- Live registered WebMCP tools read current admission state on every invocation.
  Product context becomes unavailable; product commands return a stable disabled
  result; proposals, publication, and rendering reject before service delegation.
- Deferred failure restores interaction. Deferred success stays locked until
  route navigation resolves.
- The routed browser contract proves a fresh route and record, no obsolete
  replacement warning, and byte-equivalent retention of the original record.

Evidence: focused transition and mounted WebMCP tests **13/13**; routed browser
tests **3/3**; Studio typecheck, scoped lint, Prettier, and diff checks pass.

## Retained nonblocking issue

P2: if client-side route navigation rejects after creation, the new record is
durably safe but the old route can project a non-actionable identity-loading
surface instead of a dedicated recovery action.
