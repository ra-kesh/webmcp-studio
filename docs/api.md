# Public API

## Principles

- Rendering never mutates a template.
- Every render names an immutable template version.
- Modifications stay flat and copyable.
- Field keys belong to the published parameter manifest.
- Dot notation may address approved style properties, for example `hero_photo.objectPosition`.
- Multi-output rendering is one request.
- Asynchronous responses are the default because PDF and Browser Run may take time.

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
    "hero_photo": "asset:palace-evening-04",
    "hero_photo.objectPosition": "center 35%"
  },
  "response": {
    "type": "url",
    "outputs": [
      { "outputId": "proposal", "format": "pdf" },
      { "outputId": "whatsapp", "format": "png", "scale": 2 }
    ]
  }
}
```

Accepted response:

```json
{
  "id": "render_01J...",
  "status": "queued",
  "templateId": "northstar-wedding-proposal",
  "version": 1,
  "statusUrl": "/v1/renders/render_01J..."
}
```

### Inspect a render

`GET /v1/renders/:renderId`

States are `queued`, `rendering`, `completed`, and `failed`. A completed job returns each output's stable ID, format, dimensions, bytes, checksum, and signed URL.

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

The render API rejects unknown keys. It does not silently ignore spelling errors. Dot-notation overrides are limited to properties explicitly enabled by the published manifest.

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

Use `400` for malformed requests, `401` for missing API credentials outside the public demo, `404` for unknown resources, `409` for version conflicts, `422` for valid JSON that violates the manifest, `429` for rate limits, and `500` for internal render failures.

## Idempotency and retention

Clients may supply an `Idempotency-Key` header. The server returns the first matching job for the same workspace, key, and normalized request body. Render metadata stays longer than signed R2 URLs. The API can issue a fresh signed URL while the object remains inside its retention window.

## Demo access

The challenge UI can call the seeded template through its isolated demo session without asking the judge for an API key. The copied cURL example uses a short-lived demo token. Production API-key management is outside the challenge scope.
