# WEBMCP-01B canonical capability discovery review

Date: 2026-08-29

Verdict: **ACCEPT — no P0/P1 findings**

## Review scope

The independent reviewer read the implementation in the editor command
resolver, WebMCP registration and query boundary, Studio runtime bridge, and
focused tests. The review checked canonical command parity, parameterized
variants, stable target scoping, snapshot ownership, transient crop state,
privacy, tool registration truthfulness, and the absence of a mutation bypass.

## Evidence

- All 73 `productCommandIds` flow through the shared canonical resolver and
  expand to 85 concrete capabilities: 12 alignment variants and two
  distribution variants.
- Capabilities return canonical targets, typed arguments, exact enablement and
  disabled reasons, and explicitly state `execution: "not_exposed"`.
- Page and output targets are validated against the captured document snapshot
  and reuse matching structure/PDF policy. Non-current targets exclude
  selection-policy simulation.
- Snapshot/document mismatch returns `stale_context`; each request captures one
  snapshot.
- Studio overlays the live crop-preview session before command resolution.
- Only resolved public policy and stable targets cross the WebMCP boundary;
  private runtime context is not serialized.
- `get_capabilities` is read-only, cannot execute commands, and cannot bypass
  Review.
- Catalog and lifecycle registration agree on 14 tools.

## Gate result

The reviewer found no remaining severity-0 or severity-1 correctness,
architecture, privacy, or ownership issue and accepted WEBMCP-01B for its
declared discovery-only boundary.
