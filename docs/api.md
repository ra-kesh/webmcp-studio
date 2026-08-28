# Public API

## Principles

- Rendering never mutates a template.
- Every render names an immutable template version.
- Modifications stay flat and copyable.
- Field keys belong to the published parameter manifest.
- Multi-output rendering is one request.
- The challenge path renders synchronously and still persists every job before
  invoking the private Renderer Worker.

## Endpoints

### Compose a Stuwiz quotation

`POST /v1/studio/quotation-compositions`

This is the source-to-canvas boundary. Stuwiz sends the complete canonical
quotation snapshot, quote metadata, and organization branding. Studio validates
that payload, chooses a visual template, derives the required page count, and
returns an editable materialized document.

```json
{
  "contractVersion": 1,
  "templateId": "editorial-olive",
  "payload": {
    "contractVersion": 1,
    "source": {
      "type": "stuwiz.quotation",
      "quotationId": "quote_01J...",
      "revision": 3
    },
    "quote": {
      "quoteNumber": "Q-2026-0142",
      "quoteVersion": 3,
      "validUntil": "2026-10-15",
      "createdAt": "2026-08-26T09:30:00.000Z"
    },
    "branding": {
      "schemaVersion": 1,
      "organizationName": "Northstar Studio",
      "address": "Bengaluru, Karnataka",
      "email": "hello@northstar.studio",
      "phone": "+91 98765 43210",
      "taxIdentifier": null,
      "timezone": "Asia/Kolkata",
      "logoUrl": null
    },
    "document": {
      "schemaVersion": 1,
      "quotationDate": "2026-08-26",
      "quotationType": {
        "id": "wedding",
        "key": "wedding",
        "label": "Wedding photography & films"
      },
      "title": "Aditi & Kabir — Wedding Story",
      "currency": "INR",
      "participants": [],
      "events": [],
      "packages": [],
      "recommendedPackageKey": null,
      "deliveryTimelines": [],
      "paymentMilestones": [],
      "fixedTerms": []
    }
  }
}
```

The shortened arrays above show placement only; the schema requires at least one
participant, event, and package, and exactly three payment milestones. See
[`stuwiz-quotation-composition.md`](./stuwiz-quotation-composition.md) for the
ownership and pagination rules.

`GET /v1/studio/quotation-compositions` returns the available visual templates.

### List templates

`GET /v1/studio/templates?search=&tag=&cursor=`

Returns template ID, name, thumbnail, tags, latest published version, output variants, and a parameter summary.

### Inspect a template

`GET /v1/studio/templates/:templateId`

Returns the immutable version metadata, output sizes, export formats, complete parameter manifest, validation rules, and example values.

### Publish a Studio document

`POST /v1/studio/templates`

The Studio client submits only publication identity plus the canonical document:

```json
{
  "id": "template-version-01J...",
  "templateId": "northstar-wedding-proposal",
  "version": 1,
  "publishedAt": "2026-08-27T10:00:00.000Z",
  "document": { "schemaVersion": 1 }
}
```

`sourceRevision`, `sourceSnapshotId`, the parameter manifest, output metadata,
page sizes, and binding targets are derived by the server from the validated
document. `sourceSnapshotId` is a SHA-256 identity of the canonical document,
so two Undo branches can share a numeric revision without sharing publication
identity. Repeating the exact same canonical document returns its existing
immutable version with status `200`; a new snapshot creates the next version
with status `201`. Clients cannot assert or override derived fields. Unknown
keys are rejected. A
schema-valid document with invalid output/page/node/group/field relationships,
unsupported renderer fonts, or unresolved local assets returns `422` and is not
written to D1.

### Inspect an audit snapshot

`GET /v1/studio/documents/:documentId/revisions/:sourceSnapshotId`

Returns the exact validated document stored for that publication snapshot,
plus its numeric revision, actor, and creation time. The lookup is scoped to
the authenticated workspace. Numeric revision alone is not an audit address.

### Create a render

`POST /v1/studio/render`

```json
{
  "templateId": "northstar-wedding-proposal",
  "version": 1,
  "modifications": {
    "couple_names": "Mira & Kabir",
    "event_date": "18 February 2027 · Udaipur",
    "package_name": "The Monsoon Weekend",
    "package_price": "₹4,10,000",
    "valid_until": "30 September 2026"
  },
  "response": {
    "type": "url",
    "outputs": [
      { "outputId": "proposal", "format": "pdf" },
      { "outputId": "whatsapp", "format": "png" }
    ]
  }
}
```

Completed response:

```json
{
  "id": "render-01J...",
  "status": "completed",
  "templateId": "northstar-wedding-proposal",
  "version": 1,
  "artifacts": [
    {
      "id": "render-output-01J...",
      "outputId": "proposal",
      "pageId": null,
      "format": "pdf",
      "downloadUrl": "/v1/renders/render-01J.../outputs/render-output-01J..."
    }
  ]
}
```

### Inspect a render

`GET /v1/renders/:renderId`

States are `queued`, `rendering`, `completed`, and `failed`. A completed job returns each artifact's stable ID, output and page identity, format, dimensions, bytes, checksum, and R2-backed download URL.

## Parameter manifest

Each parameter includes:

- stable key and display label
- type
- description for API callers and agents
- required flag
- default and example values
- allowed values or numeric limits
- maximum text length when applicable
- bound pages, nodes, and properties

The initial public types are `text`, `number`, `currency`, `date`, `asset`,
`color`, `choice`, and `boolean`. Currency amounts are canonical decimal
strings in INR for the Stuwiz quotation contract; the display layer applies
Indian grouping and the rupee symbol. Dates use ISO `YYYY-MM-DD`. Asset values
use approved catalog IDs at the API/WebMCP boundary, while Studio privately
resolves renderer sources. Choice values must match the published option list,
and color values must pass the renderer-safe CSS color policy.

Validation metadata is executable, not descriptive: required/whitespace rules,
text length, numeric limits, choice membership, and typed defaults are enforced
by the editor, WebMCP proposals, published materialization, and render API.

The publish, preview-export, private-renderer, and public render schemas reject
unknown keys rather than stripping them. The render API also rejects unknown
parameter keys and type mismatches; it does not silently ignore spelling errors
or permit arbitrary node/style overrides.

## Error shape

```json
{
  "error": {
    "code": "invalid_modification",
    "message": "signature_price expects a currency string",
    "field": "signature_price",
    "requestId": "req_01J..."
  }
}
```

Use `400` for malformed requests, `401` for missing API credentials outside the public demo, `404` for unknown resources, `409` for version or idempotency conflicts, `422` for valid JSON that violates the manifest, `429` for rate limits, and `502` when the private renderer fails.

### JSON transport boundary

Every JSON-consuming Studio endpoint requires `Content-Type: application/json`
and a valid `Content-Length`. Preview export and template publication accept at
most 8,000,000 bytes, quotation composition accepts 2,000,000 bytes, and the
published render request accepts 256,000 bytes. The server counts the bytes it
actually reads instead of trusting the length header.

Transport failures use these stable codes before authentication, D1, render
admission, or the Renderer binding:

| Status | Code                      | Meaning                                       |
| ------ | ------------------------- | --------------------------------------------- |
| `400`  | `unsupported_media_type`  | The request is not declared as JSON.          |
| `400`  | `empty_json_body`         | No JSON bytes were received.                  |
| `400`  | `invalid_json`            | The body is malformed or is not valid UTF-8.  |
| `400`  | `invalid_content_length`  | The declared length is invalid or mismatched. |
| `400`  | `request_body_unreadable` | The request stream failed while being read.   |
| `411`  | `content_length_required` | A bounded body arrived without a length.      |
| `413`  | `request_too_large`       | Declared or streamed bytes exceed the cap.    |

The private Renderer service accepts headerless service-binding requests but
uses the same streaming byte cap and 400/413 failures before Browser Rendering
or R2.

## Idempotency and retention

Clients may supply an `Idempotency-Key` header. The server returns the first matching job for the same workspace, key, and canonical request body; reusing the key with another request returns `409`. Render metadata is stored in D1 and artifacts in R2.

## Workspace media assets

Studio-owned images have one public identity: `asset:managed/asset-…` inside a
canonical document and the corresponding opaque `asset-…` ID in public API
metadata. R2 object keys, raw object URLs, and inline bytes are private and are
never returned by list, upload, impact, archive, template, or render-history
responses.

The authoritative limits are 25,000,000 encoded bytes, 16,384 pixels on either
edge, and 100,000,000 decoded pixels. Upload supports PNG, JPEG, and WebP only.
The Worker verifies the declared MIME type, file signature, structural image
markers, decoded dimensions, pixel area, and renderer data-URI bound before it
writes R2 or D1. GIF and SVG are rejected. A successful upload is therefore a
bounded renderer-safe rendition with status `ready`; Studio does not describe
an unchecked original as ready.

### List and search

`GET /v1/studio/assets?collection=uploads|recent&query=&cursor=&limit=` returns:

```json
{
  "assets": [
    {
      "id": "asset-01J...",
      "name": "Portrait.webp",
      "mediaType": "image/webp",
      "bytes": 482193,
      "width": 1600,
      "height": 1067,
      "createdAt": "2026-08-28T09:00:00.000Z",
      "updatedAt": "2026-08-28T09:05:00.000Z",
      "lastUsedAt": "2026-08-28T09:05:00.000Z",
      "status": "ready"
    }
  ],
  "nextCursor": null,
  "storage": { "bytes": 482193, "count": 1 }
}
```

Archived assets are omitted from list/search/recent, but remain resolvable for
unsaved documents, revision history, and immutable published versions that
already reference them.

### Upload and content

`POST /v1/studio/assets` accepts `multipart/form-data` with one `file` part and
an optional `name` part. `Content-Length` is required. `Idempotency-Key` is
optional; a repeated key with the same normalized upload returns the original
asset, while reuse for different bytes or metadata returns `409`. Content-hash
deduplication is scoped to the authenticated workspace. Before a replay,
deduplicated return, or archived restore succeeds, the repository verifies the
private object's exact SHA-256 and rewrites the existing key from the validated
upload when it is missing or corrupt. The response is
`{ "asset": PublicMediaAsset }`.

`GET /v1/studio/assets/:assetId/content` authorizes workspace ownership and
streams the private R2 object without revealing its key. It returns a strong
content-hash `ETag`, `Cache-Control: private, max-age=31536000, immutable`, and
supports `If-None-Match` with `304`. Archived content remains available so old
documents and published versions do not break.

`POST /v1/studio/assets/:assetId/used` records a successful insert/replace and
returns `{ "asset": PublicMediaAsset }`; this is the authoritative source for
the Recent collection's `lastUsedAt` ordering.

### Reference-safe archive

`GET /v1/studio/assets/:assetId/deletion-impact` returns exact current-document
and published-version references plus counts, the current asset revision, a
stable impact token, and `canArchive`.

`DELETE /v1/studio/assets/:assetId` requires both:

- `If-Match: "asset-revision-N"`
- `X-Asset-Impact-Token: <64 lowercase hex characters>`

Stale revision/token preconditions return `412`; existing current or published
references return `409`. Success archives metadata and increments its revision;
it does not delete the R2 object. Publication persists canonical managed IDs
and exact reference rows in the same D1 batch. Private bytes are materialized
only in the render execution projection, never inside immutable D1 template
versions or public manifests.

## Demo access

The challenge UI calls the seeded template through an isolated 24-hour demo session without asking the judge for an API key. `GET /v1/studio/session/token` returns that session's opaque value to the same-origin API playground, which places it in the copied cURL as a bearer token. Reset rotates both the cookie and workspace. This convenience token is challenge-only; production API-key management remains outside scope.
