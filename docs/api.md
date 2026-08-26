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

### List templates

`GET /v1/studio/templates?search=&tag=&cursor=`

Returns template ID, name, thumbnail, tags, latest published version, output variants, and a parameter summary.

### Inspect a template

`GET /v1/studio/templates/:templateId`

Returns the immutable version metadata, output sizes, export formats, complete parameter manifest, validation rules, and example values.

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

The render API rejects unknown keys and type mismatches. It does not silently ignore spelling errors or permit arbitrary node/style overrides.

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

## Idempotency and retention

Clients may supply an `Idempotency-Key` header. The server returns the first matching job for the same workspace, key, and canonical request body; reusing the key with another request returns `409`. Render metadata is stored in D1 and artifacts in R2.

## Demo access

The challenge UI can call the seeded template through its isolated demo session without asking the judge for an API key. The copied cURL example uses a short-lived demo token. Production API-key management is outside the challenge scope.
