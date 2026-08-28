# ASSET-02 domain and render contract

Date: 2026-08-28
Scope: phase-entry audit only. No production code was changed.
Status: ASSET-02 is not implementation-ready until the model and renderer contract below are accepted.

## Executive verdict

Studio has a sound asset identity and render-isolation foundation, but it does not yet have an image-editing model.

The current image node can choose `cover` or `contain` and move a two-axis focus point. The fields named `cropX` and `cropY` do not describe a crop. They are interpreted as a focal point for cover and as alignment for contain. There is no persisted source transform, crop-mode interaction, image-local clip, generic mask, derived-asset job, or renderer contract for any of those features.

ASSET-02 should therefore be implemented as four ordered slices:

1. A versioned, non-destructive image placement model and true crop session.
2. Image-local frame clips, accurately named and scoped. This is not a general Figma mask system.
3. A managed background-removal derivation service with explicit privacy, failure, and provenance semantics.
4. Metadata and accessibility completion, followed by cross-renderer conformance evidence.

Do not add crop UI on top of `cropX` and `cropY`. Do not make Fabric state canonical. Do not let the React preview, Fabric canvas, and HTML exporter invent separate transform math.

## Phase-entry evidence

The backlog defines ASSET-02 as crop canvas mode, masks, a background-removal service boundary, and metadata, with an explicit non-destructive edit model, export parity, and service/privacy/error contracts (`docs/audits/2026-08-27-editor-production-readiness/production-readiness-backlog.md:63`).

The existing audits establish the surrounding constraints:

- Image upload and replacement exist, but the inspector only offers cover/contain, focal sliders, alternative text, and replacement (`docs/audits/2026-08-27-editor-production-readiness/workflow-and-feature-audit.md:97-111`).
- Fabric, React, and HTML rendering are separate consumers, so shared projection and conformance are mandatory (`docs/audits/2026-08-27-editor-production-readiness/code-architecture-audit.md:162-181`).
- Continuous interactions must use begin, preview, commit, and cancel semantics, with one history transaction at the end (`docs/audits/2026-08-27-editor-production-readiness/visual-and-interaction-audit.md:292-318`).
- MEDIA-01 now has transactional local import/replacement and managed-asset lifecycle coverage, but deployed browser and Worker evidence remains an external gap (`docs/audits/2026-08-27-editor-production-readiness/remediation-progress.md:587-672`, `:898-974`).
- CONFORM-01 defines deterministic structural and pixel gates. Its current image corpus covers only cover/contain and focal positions (`docs/audits/2026-08-27-editor-production-readiness/render-conformance.md:1-118`).

No repository `AGENTS.md` was present when this audit was performed.

Reference paths beginning with `outputs/reference-repos` are relative to `/Users/rakesh/Documents/Codex/2026-08-26/https-openai-com-webmcp-challenge-https/`.

## Current image pipeline

### Canonical document

The strict v1 image node contains:

```ts
{
  type: "image"
  assetId: string
  src: string
  fit: "cover" | "contain"
  cropX: number // 0..1
  cropY: number // 0..1
  alt: string
  // common x, y, width, height, rotation, opacity, visibility and lock fields
}
```

This is defined in `packages/document/src/schema.ts:132-151`; the corresponding generic update patch is `packages/document/src/schema.ts:79-90`. The whole document remains `schemaVersion: 1` at `packages/document/src/schema.ts:475-491`.

The managed identity invariant is valuable and must survive ASSET-02: if `src` is `asset:managed/<id>`, `assetId` must contain that same ID (`packages/document/src/media.ts:34-48`, `packages/document/src/schema.ts:142-151`).

### Commands and field binding

Image mutations currently use generic `add_node` and `update_node` commands (`packages/document/src/schema.ts:541-550`). `applyCommand` merges an image patch and validates the resulting aggregate document before returning (`packages/document/src/commands.ts:449-509`, `:1030-1036`). History stores complete before/after documents, limits itself to 100 entries, and can coalesce updates within 300 ms (`packages/editor/src/history.ts:7-34`, `:115-159`, `:188-209`).

An image source can be bound to an asset field through the `src` binding property (`packages/document/src/schema.ts:456-463`, `packages/document/src/fields.ts:16-24`). Applying a bound managed value updates both `src` and `assetId` (`packages/document/src/commands.ts:105-124`).

The direct Studio replacement paths still commit `assetId`, `src`, and `alt` with `update_node` (`apps/studio/src/features/editor/use-document-editor.ts:1565-1634`). Because every command reapplies field values, a source-bound node can have the replacement source immediately overwritten by its field while retaining the replacement alternative text. WebMCP is safer here: it rejects edits to bound properties and tells the caller to use field updates (`packages/webmcp/src/change-sets.ts:263-282`). ASSET-02 must make the UI path equally binding-aware.

### Placement projection

`projectImageLayout` is the strongest existing seam. It deterministically calculates source and destination rectangles using natural image dimensions (`packages/document/src/render-projection.ts:235-282`). Its semantics are:

- `cover`: `cropX` and `cropY` choose the visible source focal point.
- `contain`: `cropX` and `cropY` align the letterboxed destination.

The field names therefore overload two meanings and cannot represent a user-authored crop rectangle, source rotation, or arbitrary pan/scale.

### Fabric canvas

Fabric uses `projectImageLayout`, applies a source crop and scale to a non-interactive `FabricImage`, and groups it with a transparent rectangular frame (`packages/editor/src/fabric-adapter.ts:415-488`). When the source changes, the adapter discards and recreates the object (`packages/editor/src/fabric-adapter.ts:717-743`). A Fabric modification emits only common frame geometry (`packages/editor/src/fabric-adapter.ts:982-1013`).

This supports selecting, moving, resizing, and rotating the image frame. It does not support entering the frame, manipulating the image inside it, previewing a crop without mutating the document, applying a clip path, or cancelling an image-edit session. Fabric's group internals must not become serialized document state.

### React preview and HTML export

The React Artboard renders one `<img>` with CSS `object-fit` and `object-position` (`packages/render-view/src/index.tsx:92-98`, `:162-169`). The HTML renderer independently emits the same CSS as a string (`apps/renderer/src/html.ts:132-134`). Both consume the simple projection at `packages/document/src/render-projection.ts:66-76`, `:164-176`.

Neither renderer can express an affine crop transform, source rotation, rounded or elliptical clip, or custom path clip. The duplicated React and HTML mapping is also a parity risk once image behavior becomes richer.

The HTML readiness barrier correctly waits for every `<img data-node-id>` to decode and records the failed node (`apps/renderer/src/html.ts:33-80`). Any change to SVG `<image>`, canvas, or a generated bitmap must preserve an equally strict resource barrier. A missing image may be represented by a recoverable placeholder in Fabric, but server export must continue to fail rather than silently produce a different artifact.

### Local and managed assets

The current source separation is good:

- Device-local assets persist as `asset:local/<id>` and are mapped to object URLs only in a preview clone (`apps/studio/src/features/editor/use-document-editor.ts:2738-2762`).
- Managed assets persist as `asset:managed/<id>`. The authenticated server resolves them from workspace-owned storage and replaces them only in a render clone (`apps/studio/src/server/render-field-assets.ts:159-194`).
- The repository verifies the R2 bytes against the recorded content hash before producing a network-isolated data URI (`apps/studio/src/server/media-asset-repository.ts:804-823`).
- Local add and replacement capture immutable document/page/node anchors, recheck after asynchronous work, roll back stale persistence, and create an object URL only after commit (`apps/studio/src/features/editor/asset-mutation-transaction.ts:11-44`, `:51-123`, `:185-203`; `apps/studio/src/features/editor/use-document-editor.ts:1344-1438`, `:1565-1634`).
- Reusable replacement intentionally changes only identity, source, and default alternative text, preserving frame geometry and focal settings (`apps/studio/src/features/editor/media-selection-model.ts:45-52`; `apps/studio/src/features/editor/media-selection-model.test.ts:34-40`).

ASSET-02 should extend these invariants. It should not replace them with remote URLs, provider URLs, or editor-private object references.

## Exact gaps to close

| Area               | Current behavior                                             | ASSET-02 gap                                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crop model         | Cover/contain plus focus/alignment                           | No explicit source transform, crop rectangle, source rotation, reset, or aspect-ratio operation                                                                                                   |
| Crop interaction   | Inspector sliders                                            | No canvas mode, inside-frame handles, double-click entry, keyboard alternative, commit/cancel, or stale-session policy                                                                            |
| Masks              | Page-level overflow only                                     | No image-local clip; no scene semantics for vector, alpha, or luminance masks                                                                                                                     |
| Renderer parity    | Shared cover/contain layout, separate DOM mappers            | No shared projected crop/clip primitive or conformance corpus                                                                                                                                     |
| Asset replacement  | Preserves frame/focal; managed/local paths are transactional | Direct Studio replacement is not source-binding-aware; no rule for preserving crop/clip when aspect ratio changes                                                                                 |
| Background removal | Absent                                                       | No job/resource model, provider boundary, consent, privacy, quotas, idempotency, cancellation, failure taxonomy, or derived-asset provenance                                                      |
| Metadata           | MIME, bytes, dimensions, hash, timestamps, status            | No normalized-orientation flag, color-space contract, original/derived provenance, attribution, or explicit decorative state                                                                      |
| API/WebMCP         | Reviewed fit/focus/replacement proposals                     | Contract exposes only `fit`, `cropX`, `cropY`, and `alt`; no typed crop/clip/derivation operations (`packages/webmcp/src/change-sets.ts:87-103`, `packages/webmcp/src/registration.ts:1193-1276`) |
| Validation         | Identity/source checks and broad limits                      | No determinant/finite transform checks, visible-intersection rule, clip/path limits, semantic alt rule, or service parameter limits                                                               |
| Evidence           | Cover/contain unit tests and current golden corpus           | No crop, replacement-under-crop, clip, derivation, failure, or cross-renderer pixel cases                                                                                                         |

The inspector also exposes a raw HTTPS URL for sources that are not local or library aliases (`apps/studio/src/features/editor/inspector-sidebar.tsx:751-774`). Validation accepts HTTPS at the document layer (`packages/document/src/validation.ts:246-262`), while publish/render later requires a network-isolated inline source (`packages/document/src/render-policy.ts:201-209`). ASSET-02 should show this as an unresolved source state or remove the raw URL field from the production inspector. A URL that previews but cannot publish is not a complete editing workflow.

## Proposed non-destructive image model

### Principles

1. Asset bytes are immutable. Editing placement or clipping never rewrites the source asset.
2. The frame remains common node geometry. Image content is transformed inside that local frame.
3. Placement is semantic for fill and fit, explicit for crop.
4. Replacement preserves placement, clip, opacity, frame geometry, visibility, binding, and accessibility intent unless the user explicitly asks to reset them.
5. Derived pixels, such as background removal, create a new managed asset. They do not mutate the original.
6. The document stores only stable asset identity and presentation. Raw EXIF, R2 keys, provider URLs, and temporary jobs do not belong in a scene node.

### Version 2 node

The recommended v2 shape keeps source identity flat to minimize binding and reference-index churn, but replaces `fit/cropX/cropY` with a discriminated placement and adds a local clip:

```ts
type NormalizedAffine = {
  // Maps normalized source coordinates into normalized frame coordinates.
  // xFrame = m00*xSource + m01*ySource + m02
  // yFrame = m10*xSource + m11*ySource + m12
  m00: number
  m01: number
  m02: number
  m10: number
  m11: number
  m12: number
}

type ImagePlacement =
  | { mode: "fill"; focus: { x: number; y: number } }
  | { mode: "fit"; align: { x: number; y: number } }
  | {
      mode: "crop"
      sourceToFrame: NormalizedAffine
      sourceRotation: number
    }

type ImageFrameClip =
  | { kind: "rect"; radii: [number, number, number, number] }
  | { kind: "ellipse" }
  | {
      kind: "path"
      path: string
      viewBox: { minX: number; minY: number; width: number; height: number }
      fillRule: "nonzero" | "evenodd"
    }

type ImageNodeV2 = BaseNode & {
  type: "image"
  assetId: string
  src: string
  placement: ImagePlacement
  clip: ImageFrameClip
  alt: string
  decorative: boolean
}
```

`sourceRotation` may be derivable from the affine matrix, but keeping the crop UI's continuous angle explicit avoids unstable matrix decomposition and gives APIs a clear bounded value. The projector composes it into one affine transform. Skew is not an ASSET-02 feature and matrices that imply unsupported skew should be rejected.

Normative constraints:

- Every numeric value is finite.
- Focus and alignment are in `[0, 1]`.
- Crop matrices are invertible with `abs(determinant) >= 1e-6` and bounded coefficients/translations. The transformed source must intersect the frame by a minimum visible area.
- Crop scale has documented minimum and maximum values. It must not permit a one-pixel source to fill an 8K frame.
- `sourceRotation` is normalized to `[-180, 180]` and must match the matrix composition.
- Rect radii are non-negative and clamped to local frame geometry at projection time.
- Clip view-box dimensions are positive and finite. Path length uses the existing renderer path limit and must contain only parsed path commands, not CSS, URLs, markup, or external references.
- `decorative: true` forces `alt: ""`. `decorative: false` requires a non-empty trimmed alt value before publish. The editor may allow an incomplete draft but must show the issue.
- Managed identity coherence remains mandatory.

### Why normalized affine placement

Normalized source-to-frame coordinates are independent of the current canvas zoom, device pixel ratio, Fabric object dimensions, and export resolution. They support pan, scale, and source rotation without destructively editing bytes. They also produce a single contract that can be projected into Fabric, React, HTML/SVG, and future API renderers.

OpenPencil uses an image scale mode plus an affine image transform (`outputs/reference-repos/editors/open-pencil/packages/scene-graph/src/types.ts:132-166`) and centralizes transform math in its renderer (`outputs/reference-repos/editors/open-pencil/packages/core/src/canvas/fills.ts:385-474`). The useful pattern is the canonical affine transform and shared rendering math, not its exact schema.

### Mask scope

The proposed `clip` is an image-local frame clip. The product should call the first UI feature **Shape** or **Frame mask**, not claim general Figma masking.

General vector/alpha/luminance masks affect sibling traversal, z-order, group bounds, blending, selection, duplication, and export. OpenPencil's generic masks require node-level mask metadata (`outputs/reference-repos/editors/open-pencil/packages/scene-graph/src/types.ts:510-512`) and a renderer pass that groups consecutive masks with following siblings and composites them using destination-in and luminance filters (`outputs/reference-repos/editors/open-pencil/packages/core/src/canvas/masks.ts:31-107`). Studio's current flat page nodes plus organizational groups do not define those semantics.

Rounded-rect and ellipse clips are the first shippable mask slice. Custom vector paths may follow only after deployed renderer conformance. General sibling masks should be a separate scene-graph backlog item.

## Migration contract

ASSET-02 requires `schemaVersion: 2`. Silent defaults inside version 1 are not sufficient because placement semantics are changing.

Draft migration is deterministic:

| v1                                 | v2                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| `fit: "cover"`, `cropX`, `cropY`   | `placement: { mode: "fill", focus: { x: cropX, y: cropY } }`                      |
| `fit: "contain"`, `cropX`, `cropY` | `placement: { mode: "fit", align: { x: cropX, y: cropY } }`                       |
| no clip                            | `clip: { kind: "rect", radii: [0, 0, 0, 0] }`                                     |
| `alt`                              | preserve `alt`; set `decorative: false`; emit a migration warning if alt is empty |
| `assetId`, `src`                   | preserve exactly, then run managed identity normalization and validation          |

Do not generate an explicit crop matrix during migration. Fill and fit stay semantic and do not need natural dimensions in the decoder. A crop matrix is created only when a decodable source enters crop mode.

Migration implementation must:

1. Add explicit `documentSchemaV1` and `documentSchemaV2` decoders.
2. Add named migration codes for image placement, default frame clip, and unresolved accessibility intent.
3. Migrate drafts on decode, validate the v2 aggregate, and persist v2 on the next successful save.
4. Preserve the existing immutable-publication rule. `decodeTemplateVersion` currently rejects defaults or in-place migrations (`packages/document/src/document-decoder.ts:384-398`). A v1 published version remains a v1 artifact. Editing it requires republication under a new version identity through the existing migration path (`packages/document/src/document-decoder.ts:401-423`).
5. Keep the renderer able to render stored v1 published versions until their retention window ends, or explicitly materialize a transient v2 render clone without altering the version digest. The chosen approach must be recorded in the template manifest contract.
6. Update semantic clone, template application, change-set public projection, document hashing, field application, asset reference indexing, and review details as one schema migration, not as follow-up fixes.

## Renderer parity contract

### One projected paint primitive

All three renderers must consume one pure projection result:

```ts
type ProjectedImagePaint = {
  source: { assetId: string; src: string }
  frame: { width: number; height: number }
  sourceToFrame: NormalizedAffine
  clip: ProjectedFrameClip
  opacity: number
  alt: string
  decorative: boolean
}
```

For fill and fit, the projector derives the affine matrix from node frame dimensions, natural asset dimensions, and focus/alignment. For crop, it validates and returns the stored transform. Natural dimensions must come from verified local/managed metadata or a decoded resource, never an untrusted client hint at the server boundary.

The renderer contract is:

- The frame establishes local coordinates, clipping, node rotation, and opacity.
- The image source is sampled through `sourceToFrame` inside that frame.
- Clip geometry is applied in frame-local normalized coordinates.
- Image smoothing, interpolation, color profile, and orientation behavior are explicit and identical.
- Missing or undecodable resources fail with the node ID in server rendering. Editor preview shows a recoverable placeholder and never reports export success.
- The canonical document and persisted asset aliases are never rewritten by preview object URLs or render data URIs.

### DOM and SVG choice

A plain `object-fit` `<img>` is no longer sufficient. The least ambiguous cross-renderer representation is a frame wrapper containing an SVG with normalized `viewBox`, an `<image preserveAspectRatio="none">`, the projected affine matrix, and a local `<clipPath>`. React preview and HTML export should render equivalent SVG structure from the same projected values. The resource-readiness code must then preload every projected source with `Image.decode()` and retain node-specific failure reporting; it cannot rely only on `document.querySelectorAll("img[data-node-id]")` (`apps/renderer/src/html.ts:57-80`).

Fabric can use its native crop and clip primitives internally, but its final pixels must match the same projected affine and clip. Fabric is an interaction adapter, not the export oracle.

An alternative DOM wrapper plus transformed `<img>` is acceptable only if it supports rotation and normalized cross-axis terms without ad hoc aspect-ratio conversions and passes the same pixel corpus. No renderer may recalculate crop behavior independently.

### Replacement rule

Source replacement preserves the entire presentation and frame:

- preserve `placement`, `clip`, node frame/rotation/opacity/visibility/lock, groups, binding, and semantic node identity;
- replace `assetId` and `src` atomically;
- preserve user-authored alt text by default; use asset description only when the existing alt was an untouched generated default;
- if the source is field-bound, replace the field value rather than patching `src` directly;
- if a crop transform remains valid but yields surprising composition for a new aspect ratio, preview it and offer **Reset crop**. Do not silently reset it;
- if the new source cannot decode, do not commit the replacement.

Figma's current image behavior is a useful product reference: crop is non-destructive, hidden source pixels are retained, crop mode supports repositioning/resize/rotation, and replacing an image can preserve fill mode and crop positioning. See [Crop an image](https://help.figma.com/hc/en-us/articles/360040675194-Crop-an-image), [Adjust image properties](https://help.figma.com/hc/en-us/articles/360041098433-Adjust-the-properties-of-an-image), and [Upload an image as a fill](https://help.figma.com/hc/en-us/articles/360041090073-Upload-an-Image-as-a-Fill).

## Crop command and history semantics

Crop mode is ephemeral editor state with one final document transaction.

### Entry

- Double-click an editable image, press Enter on a selected image then choose Crop, or activate **Crop** in the inspector.
- Locked, hidden, missing-source, multi-selected, review-locked, or recovery-locked images cannot enter crop mode. The disabled control explains why.
- Entering fill or fit computes an initial crop transform from the verified natural dimensions but does not change history.

### Preview

- Dragging pans the source inside a fixed frame.
- Crop handles scale around a documented anchor. A rotation control or numeric field rotates source content, not the frame.
- Preview state lives outside the canonical document and is rendered through the same projector.
- Keyboard alternatives exist: arrow-key pan, modifier-based fine/coarse increments, numeric scale/rotation, and an explicit reset. Pointer-only gestures are insufficient.
- Canvas zoom/pan remains available through its established modifiers and must not accidentally mutate crop content.

### Commit and cancel

- Enter, **Done**, or an intentional click outside commits one typed `set_image_placement` command with history label `Crop image`.
- Escape or **Cancel** restores the exact starting placement and creates no history entry.
- Undo/redo treats the full crop as one entry. Slider or pointer moves do not create incremental history entries.
- A page/document/review/recovery/source change that invalidates the captured node and snapshot cancels with an explicit message. It never applies to the current selection by coincidence.
- Autosave runs only after commit.

### Typed commands

Prefer explicit commands over a large generic nested patch:

```ts
type SetImagePlacementCommand = {
  type: "set_image_placement"
  nodeId: string
  placement: ImagePlacement
}

type SetImageClipCommand = {
  type: "set_image_clip"
  nodeId: string
  clip: ImageFrameClip
}

type ReplaceImageSourceCommand = {
  type: "replace_image_source"
  nodeId: string
  assetId: string
  src: string
  altDisposition: "preserve" | "replace_generated_default"
}
```

`replace_image_source` validates asset identity atomically and rejects a source-bound node with a structured `bound_property` result that identifies the field. The caller then uses `set_field`. WebMCP proposals expose the same typed placement and clip schemas and remain human-reviewed. Public tool output uses opaque approved asset IDs and never returns managed source aliases, R2 keys, object URLs, or provider URLs.

## Background-removal service boundary

Background removal is an asynchronous asset derivation, not a canvas filter and not an `addImage()` shortcut.

### Resource model

Add a workspace-scoped derivation resource, for example:

```ts
type MediaDerivationJob = {
  id: string
  workspaceId: string
  sourceAssetId: string
  operation: "remove_background"
  parametersHash: string
  provider: string
  providerModelVersion: string
  state: "queued" | "running" | "succeeded" | "failed" | "cancelled"
  outputAssetId: string | null
  safeFailureCode: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  attempt: number
  idempotencyKey: string
  privacyPolicyVersion: string
}
```

Store jobs in D1 and output bytes in R2 as a new immutable media asset. Extend asset metadata with `derivedFromAssetId`, `derivationJobId`, normalized orientation, output MIME, width, height, content hash, color-space policy, and creator/provenance category. Do not expose provider response URLs as asset identity.

The existing `media_assets` table only records original media identity, dimensions, hash, R2 key, lifecycle, and timestamps (`migrations/0007_workspace_media_assets.sql:3-51`). `PublicMediaAsset` similarly exposes only basic ready-state metadata (`packages/document/src/media.ts:50-72`). A new migration is required; overloading the upload-request table is not acceptable.

### Admission and privacy

- Require an authenticated workspace principal and a source asset owned by that workspace.
- Accept only a managed, ready asset ID. A local-only file must be promoted through the existing managed upload path before a cloud provider can process it.
- Resolve source bytes server-side from R2. Never accept an arbitrary client URL or data URI for the provider.
- Verify bytes, type, dimensions, pixel area, and content hash before dispatch.
- Normalize EXIF orientation and color profile, and strip EXIF/GPS before sending or saving a derivative. Raw EXIF does not enter the document or public API.
- Show the provider/subprocessor, data use, retention, region if material, expected cost/credit, and cancellation limits before first use. Record the accepted privacy-policy version.
- Enforce per-workspace quotas, rate limits, maximum concurrent jobs, timeout, retry policy, and circuit breaking.
- Make the request idempotent on workspace, source content hash, operation, normalized parameters, provider model version, and idempotency key.
- Log opaque IDs and timings, not image bytes, signed URLs, EXIF, or provider payloads.

### Product transaction

1. User invokes **Remove background** on one managed image.
2. Studio explains cloud processing and starts an idempotent job.
3. The document does not change while queued/running/failed/cancelled.
4. On success, Studio resolves the new managed asset and shows a before/after preview.
5. Applying the result performs one binding-aware source replacement and one history entry named `Remove background`.
6. Undo restores the original source and presentation. The derived asset remains an immutable reusable asset and may later be archived through normal reference-aware lifecycle rules.
7. Failure preserves the selected node and original source, exposes a safe retry action, and never inserts a second image layer.

The local Canva clone is an anti-pattern here. It reads Fabric's private `_originalElement.currentSrc`, sends an arbitrary string to an API, then adds the returned URL as another image (`outputs/reference-repos/editors/canva-clone-fabric/src/features/editor/components/remove-bg-sidebar.tsx:30-51`). Its endpoint accepts any string and returns a provider URL without ownership, provenance, quotas, or stable job state (`outputs/reference-repos/editors/canva-clone-fabric/src/app/api/[[...route]]/ai.ts:8-30`). Reuse the visible progress/retry idea only, not that boundary.

Canva's current quick-tool flow also treats background removal as asynchronous processing with sign-in, upload, waiting, and an editor/download result. It is a product reference, not a security contract: [Canva AI quick tools](https://www.canva.com/en/help/ai-tools-pages/).

## Failure and security boundaries

| Boundary                                          | Required behavior                                                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Image fails to decode before crop                 | Disable crop, identify the failed layer, offer replace/retry, do not enter an empty mode                    |
| Natural dimensions disagree with managed metadata | Fail materialization/integrity validation; do not project with client dimensions                            |
| Crop session target or source changes             | Cancel against captured node/source/snapshot and explain that the edit was not applied                      |
| Invalid or singular matrix                        | Reject at command parse and document validation; never pass NaN/Infinity to Fabric, CSS, or SVG             |
| Oversized or malformed clip path                  | Reject under a shared path parser and renderer limit before preview/export                                  |
| Missing local blob                                | Keep canonical alias, show recoverable placeholder, block publish/export until restored or replaced         |
| Missing/corrupt managed R2 object                 | Return node-specific render/materialization failure; never fetch an arbitrary fallback URL                  |
| Provider timeout or 5xx                           | Job becomes retryable failure; document remains unchanged; bounded backoff and attempt count                |
| Provider policy rejection or unsupported image    | Stable non-retryable code with safe user copy; no provider payload leakage                                  |
| User cancels derivation                           | Mark cancelled if possible; discard late provider success unless the job state transition is still valid    |
| Duplicate derivation request                      | Return the same compatible job/output through idempotency, not another charge                               |
| Source is archived after job starts               | Existing reference keeps it resolvable; applying output revalidates node/source/snapshot                    |
| Source is bound to a field                        | Replace through the field or reject with a field-target action; never create identity/source drift          |
| Export resource readiness fails                   | No `data-render-ready`; include safe failure code and node ID; no partial artifact reported as success      |
| API/WebMCP request                                | Validate actor capability, current revision/snapshot, node type, bounds, asset ownership, and review status |

The existing upload limits of 25 MB, 16,384 px per dimension, and 100 million pixels are useful upper bounds (`packages/document/src/media.ts:3-16`). Derivation limits should be equal or stricter and account for decoded memory and transparent output expansion.

## Executable test matrix

The following matrix is required before ASSET-02 can be marked complete. Unit and integration commands should run through Bun/Vitest. Browser and deployed evidence should run only after the known workerd host problem is repaired.

| Layer                     | Required cases                                                                                                                                                                                                                       | Suggested command/evidence                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema                    | Parse every placement/clip variant; reject unknown keys, NaN/Infinity, singular/extreme matrices, skew if unsupported, invalid rotations/radii/view boxes/paths; enforce decorative/alt rule and managed identity                    | `bun test packages/document/test/image-schema.test.ts`                                                                                                      |
| Migration                 | v1 cover to fill, contain to fit, default rect clip, empty-alt warning, managed identity normalization, idempotent v2 decode; published v1 rejects in-place migration and republishes as new identity                                | `bun test packages/document/test/document-decoder.test.ts packages/document/test/image-migration.test.ts`                                                   |
| Projection                | Golden numeric matrices for wide/tall/square sources, every focus/alignment edge, crop pan/scale/rotation, replacement aspect changes, each clip type                                                                                | `bun test packages/document/test/image-render-projection.test.ts`                                                                                           |
| Commands                  | Typed placement/clip/source replacement; wrong node type; locked/review state at caller; binding-aware rejection; atomic identity update; aggregate rollback on invalid command                                                      | `bun test packages/document/test/commands.test.ts`                                                                                                          |
| History                   | 100 pointer previews produce zero entries; commit produces one named entry; cancel produces none; undo/redo exact placement; stale source/page/document/review/recovery cancels                                                      | `bun test packages/editor/test/image-edit-history.test.ts apps/studio/src/features/editor/image-edit-transaction.test.ts`                                   |
| Fabric                    | Enter/preview/commit/cancel crop; frame remains fixed; correct cursor/controls; missing image contained; clip parity; source replacement recreates content without losing selection/session invariants                               | `bun test packages/editor/test/fabric-image-edit.test.ts`                                                                                                   |
| React render              | Exact projected affine and clip attributes; decorative versus meaningful accessibility; no independent fit math; missing preview status                                                                                              | `bun test packages/render-view/test/image-conformance.test.tsx`                                                                                             |
| HTML renderer             | Equivalent SVG/DOM structure, escaping, resource preloading/readiness, node-specific decode failure, no remote fetch, mixed-page PDF order                                                                                           | `bun test apps/renderer/test/html-image-conformance.test.ts apps/renderer/test/html.test.ts`                                                                |
| Renderer security         | Malformed path, huge path, unsafe source, corrupt bytes, dimension/hash mismatch, source alias mismatch, cross-workspace lookup, provider URL leakage                                                                                | `bun test packages/document/test/render-policy.test.ts apps/studio/src/server/render-field-assets.test.ts apps/studio/src/server/media-derivation*.test.ts` |
| Local/managed integration | Local crop persists across reload; local publish remains blocked; promote then crop; replacement preserves placement/clip; archived referenced assets render; reference index includes original and derived active sources correctly | targeted Studio repository tests                                                                                                                            |
| WebMCP/API                | Inspect returns typed placement/clip without private source; proposal validates bounds/matrix/current snapshot; bound source requires field update; derivation uses opaque job IDs and remains reviewable on apply                   | `bun test packages/webmcp/test/change-sets.test.ts packages/webmcp/test/registration.test.ts`                                                               |
| Golden structural         | Add fill, fit, rotated crop, each frame clip, replacement-under-crop, transparent derived PNG to canonical conformance document; assert deterministic projection and HTML                                                            | extend `packages/document/src/render-conformance.ts` and existing conformance tests                                                                         |
| Golden pixel              | Fabric editor capture, React Artboard capture, deployed Browser Rendering PNG/PDF for each case; compare at existing documented thresholds                                                                                           | extend `scripts/render-conformance.ts` and artifact manifest                                                                                                |
| Browser UX                | Mouse, trackpad, double-click, keyboard-only crop, focus restoration, screen-reader labels, reduced motion, zoom/pan separation, undo/redo, source failure, background-removal queued/success/failure/cancel                         | Playwright after host recovery; retain screenshots/traces/videos                                                                                            |
| Deployed service          | D1/R2 migration, ownership isolation, idempotency, quota, provider timeout, late success after cancel, archive/reference behavior, logs without sensitive payloads                                                                   | staging Worker + real bindings; record request/job/artifact IDs and redacted logs                                                                           |

Existing image tests are too narrow for closure:

- Document projection only asserts cover and contain geometry (`packages/document/test/render-conformance.test.ts:107-133`).
- React only asserts observable `object-fit` and `object-position` (`packages/render-view/test/conformance.test.ts:106-118`).
- HTML only asserts the same CSS and alt string (`apps/renderer/test/html.test.ts:164-196`).
- Media replacement proves identity-only patching but not true crop/clip preservation (`apps/studio/src/features/editor/media-selection-model.test.ts:34-40`).

## Delivery sequence and gates

### Slice 1: canonical crop

- Accept v2 schema and migration.
- Add typed placement command and binding-safe replacement.
- Add pure projected affine paint.
- Implement Fabric crop session with keyboard access and one-entry history.
- Update React and HTML consumers.
- Add structural and pixel crop corpus.

Gate: fill/fit behavior is unchanged, crop survives reload/duplicate/review/undo/export, and all renderers pass the same corpus.

### Slice 2: frame clips

- Add rounded rectangle and ellipse.
- Add custom path only after parser, bounds, readiness, and deployed pixel evidence exist.
- Keep general sibling masks explicitly out of scope.

Gate: editor selection/hit-testing and every export target agree at edges and under node rotation.

### Slice 3: background-removal derivations

- Add D1 migration, repository, authenticated routes, provider adapter, idempotency, quotas, privacy copy, job UI, and output provenance.
- Apply output through one binding-aware source replacement.

Gate: success, failure, cancellation, retry, duplicate, ownership, archival, and late-result races are proven against real staging D1/R2 and the selected provider.

### Slice 4: metadata and closure

- Complete accessibility intent, normalized image metadata, attribution/provenance display, API/WebMCP projection, docs, and telemetry.
- Run the full unit, integration, browser, and deployed conformance matrix.

Gate: no renderer or API has a private alternate image model, no operation leaks private source material, and the production-readiness backlog links durable evidence.

## Definition of done

ASSET-02 is complete only when all of the following are true:

- True crop is represented non-destructively in schema v2 and is not an alias for focal positioning.
- Crop mode is usable by pointer and keyboard, has explicit Done/Cancel/Reset, and produces one undoable transaction.
- Fill, fit, crop, replacement, and frame clips render equivalently in Fabric, React, PNG, and PDF.
- Replacement and derivation preserve presentation and respect field bindings.
- Background removal operates on workspace-owned managed assets through a documented asynchronous, private, idempotent service boundary.
- Original and derived assets remain immutable, reference-accounted, integrity-checked, and recoverable under normal archive rules.
- Missing, corrupt, stale, cancelled, and denied states are visible and non-destructive.
- API and WebMCP contracts are typed, reviewable, current-revision checked, and free of private source URLs.
- Draft migration and immutable published-version republication are tested.
- Structural, pixel, browser, and deployed Worker/D1/R2 evidence is attached to the audit index.

Until the host workerd issue is repaired, browser and deployed proof remain intentionally unclaimed. That is an evidence blocker, not permission to weaken the domain contract.
