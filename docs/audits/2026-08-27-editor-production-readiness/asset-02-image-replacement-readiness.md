# ASSET-02 renderer-acknowledged image replacement

Status: implemented for Studio's interactive replacement transaction. This note records the ownership boundary and the remaining publication/export limitation without claiming universal renderer readiness.

## Product invariant

Replacing an image must not commit a source that either live Studio renderer cannot install. The old canonical node, pixels, geometry, selection, bindings, crop placement, alt text, snapshot, and history remain intact until the replacement has passed the complete handoff. A successful replacement creates exactly one typed `replace_image_source` history entry.

Renderer readiness is runtime transaction state. Its token and acknowledgements must never enter the canonical document, API payload, publication snapshot, or WebMCP contract.

## Interactive transaction

1. Prepare the candidate before it is visible. Local files use an exact object URL that has already decoded. Managed sources verify metadata, content identity, and browser-decodable dimensions. Library sources decode and validate their catalog dimensions.
2. Capture the immutable replacement anchor: history snapshot, document, page, node identity, and the node's current asset/source identity.
3. Publish one tentative preview with a unique token, exact node ID, exact source, and expected natural dimensions. Canonical history still points to the old image.
4. Fabric installs the candidate into the existing frame while retaining the previous decoded object until the candidate is usable. The active React page thumbnail independently loads the same source. Each reports `ready` or `unavailable` against the exact token, node, source, and dimensions.
5. Ignore reports from stale tokens, nodes, sources, attempts, or superseded transactions. A dimension mismatch is a failure, not readiness.
6. After both live renderers report ready, revalidate the captured anchor in the same synchronous path as the typed document commit. Then commit once. Clearing the runtime token does not change resource identity or trigger another decode.
7. If either renderer fails, the anchor becomes invalid, the command is rejected, or the 15-second readiness deadline expires, remove the tentative preview and keep the original canonical document and history unchanged. The user receives a specific failure message and can retry or choose another image.

The page filmstrip participates as the real React preview rather than a hidden probe. Its artboard uses status-only image failures because the page selector is already interactive; recovery remains in the selected-image and inspector surfaces, avoiding nested controls.

## Ownership

- `useDocumentEditor` owns the replacement anchor, pending candidate, typed commit, busy lifecycle, and user-facing failure.
- `ImageReplacementCoordinator` owns the exact two-renderer readiness gate, timeout, stale-event rejection, last-moment validation, and one-shot resolution.
- `FabricArtboard` reports the result of the actual Fabric synchronization and decoded natural dimensions.
- `@webmcp/render-view` reports the result of the actual React image load while retaining the old displayed resource during a source transition.
- The canonical document owns only durable image semantics: asset/source identity, alt provenance, frame geometry, placement, mask, binding, and other authored properties.

## Cleanup and concurrency

Only one replacement may be active. The Media dialog remains busy until the transaction commits or fails. Unmount cancels the coordinator and clears its deadline. Local staged object URLs and records retain their existing compensation rules. Source callbacks are anchored to exact source and token, so late `load` or `error` events cannot settle a newer transaction.

## Honest publication and export boundary

The browser transaction can acknowledge the two renderers mounted in Studio. It cannot synchronously prove that a later Worker, Browser Rendering session, PNG/PDF export, or published viewer in another browser will decode the source. Managed media reduces that risk through server materialization and immutable content checks; it does not turn a client acknowledgement into a server-render acknowledgement. External/library URL reachability in the renderer environment remains a separate publish/export validation boundary.

Closing that boundary requires a server-side prepare/render contract that returns an immutable, renderer-reachable resource revision (or a retained render artifact) before publication/export accepts the snapshot. That acknowledgement belongs to the render admission and artifact pipeline, not to the canonical document schema and not to this interactive history transaction.

## Regression evidence required

- Fabric ready plus React failure leaves the original document reference, snapshot, and empty history intact.
- Exact Fabric and React readiness commits one `Replace image` history entry and preserves the documented node properties.
- Stale token/node/source reports cannot advance or fail the active transaction.
- Natural-dimension disagreement fails the transaction.
- Target mutation after preview but before the second acknowledgement rejects the commit.
- Deadline expiry removes the pending preview and never commits.
- Filmstrip previews do not render an interactive image-retry control inside the page-selection control.
