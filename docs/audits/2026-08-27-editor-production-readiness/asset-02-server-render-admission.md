# ASSET-02 server render admission and artifact readiness

Status: implemented locally on 2026-08-28. Deployed Browser Rendering and pixel-conformance evidence remain release gates.

## Boundary

The interactive Fabric and React replacement acknowledgements prove only that the two mounted Studio renderers installed one candidate resource. They do not authorize a later Worker render and they never enter the canonical document, history, WebMCP payload, published template, or render API.

A server render now establishes an independent chain of evidence:

1. The workspace repository loads the exact managed asset revision, verifies the stored content hash, decodes its structural dimensions, and compares those dimensions with authoritative metadata.
2. `materializeManagedDocumentAssets` replaces managed aliases only in a transient render clone and emits one expectation per exact image node. The expectation contains node ID, asset ID, natural dimensions, content hash, and asset revision. The canonical document remains byte-free and unchanged.
3. Before capacity is reserved or a durable render job is inserted, `assertRenderImageResourceAdmission` proves that every expectation names an existing image node, that the node has the same asset identity, and that the private inline bytes hash to the expected content hash. Duplicate, wrong-type, missing-node, identity-drifted, and source-drifted expectations fail node-specifically. Every private Renderer request must include an explicit expectation manifest, including an empty array when the document has no managed resources; omission is an invalid request.
4. The private Renderer Worker repeats the same node/asset/source proof before launching Browser Rendering. It then waits for the exact managed font and every image decode. Managed natural dimensions are compared with the expectation after browser decode and before screenshot or PDF generation.
5. Browser resource failure, source drift, identity drift, natural-dimension mismatch, timeout, screenshot/PDF failure, or R2 failure cannot be reported as a completed render. The durable Studio job retains the renderer's stable failure code and immediate responses retain the exact node and asset when supplied.
6. Only a successful renderer response with stored-artifact metadata can advance the job to `completed`. Failed multi-artifact jobs remove already-produced R2 objects and never insert `render_outputs` rows.

The managed revision is carried for traceability and future immutable-revision diagnostics. Admission does not pretend that a client-visible revision number proves bytes. The immutable asset identity plus the server-verified content hash are the source proof, and browser-decoded natural dimensions are the geometry proof.

## Exact failure contract

Pre-Browser resource admission returns `422 render_resource_failed` with one of:

- `image_resource_duplicate`
- `image_resource_node_missing`
- `image_resource_type_mismatch`
- `image_resource_identity_mismatch`
- `image_resource_source_mismatch`

Post-decode readiness retains `image_decode_failed`, `image_dimension_mismatch`, managed-font failure, readiness failure, and readiness timeout. When a node is known, the renderer includes `nodeId`; managed admission also includes `assetId`. Studio parses only a bounded 1,024-byte private-renderer error body and stores stable codes instead of collapsing every failure to `renderer_failed`.

## Concrete defect closed

Managed expectations were previously reconstructed by looking up the final data URI. Two distinct managed identities with identical bytes therefore collapsed to the last resource in the map, assigning the wrong asset identity to one or more nodes. Expectations are now captured while each canonical managed node is materialized. Initial field resources are also reused by asset ID instead of triggering a second repository read.

## Regression evidence

- `packages/document/test/render-resource-admission.test.ts` proves exact success and node-specific duplicate, missing-node, wrong-type, identity, and source failures.
- `apps/studio/src/server/render-field-assets.test.ts` proves canonical immutability, initial-resource reuse, invalid-resource containment, and two distinct managed identities sharing identical bytes without expectation collapse.
- `apps/studio/src/server/renderer-invocation-error.test.ts` proves bounded parsing and preservation of stable node/asset failure details.
- `apps/renderer/test/index.test.ts` proves source-digest mismatch fails before Browser Rendering or R2 and dimension mismatch fails before PDF generation or R2.

Local focused/full results at the time of this note:

- Document: 155/155 tests; typecheck passed.
- Renderer: 43/43 tests; typecheck passed.
- Studio: 299/299 tests across 62 files; typecheck passed. The server-focused admission/materialization/error slice contributes 12/12 passing tests.

## Honest remaining release evidence

This contract proves server-side identity, bytes, decode dimensions, and failure propagation. It does not claim visual pixel parity or deployed Browser Rendering health. The healthy-host suite must still retain and compare Fabric, React, Renderer PNG, rasterized Renderer PDF, and published-viewer artifacts at 1x and 2x. Staging must also exercise valid and corrupt managed resources through the real service binding and R2 bucket before production promotion.
