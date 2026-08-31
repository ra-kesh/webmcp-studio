# Studio WebMCP generation contract

Always discover the live contract. The checked-in examples illustrate request
shape; they do not replace `read_design_plan_schema` or current limits.

## Blank mode

Use `read_blank_document_presets`, then submit a versioned Studio Design Plan.
Every output, page, node, group, style, variable, field, and binding uses one
unique request-local ID. Page membership and all references must be complete.
Use only the fonts, node properties, output kinds, colors, geometry, and media
identities admitted by the live capability response.

See [examples/blank-request.json](../examples/blank-request.json).

## Template mode

Use `search_templates` and `read_template`, preserve exact `{id, version}`
identity, and refer only to page, node, and field identities returned by the
template detail. Template changes are limited to field values, approved image
substitutions, text, visibility, and approved image insertion admitted by the
live schema.

See [examples/template-request.json](../examples/template-request.json).

## Provenance and replacement

Record the skill, normalized design-guide decisions, analysis-only references,
and approved asset identities. Include canonical URLs and content hashes when
available. A replacement uses a new request ID and idempotency key plus
`replacementForRequestId` naming the pending candidate. Studio admits no more
than one replacement.

The proposal result is not a saved document. Do not claim creation succeeded
until the human approves it in Studio Review.
