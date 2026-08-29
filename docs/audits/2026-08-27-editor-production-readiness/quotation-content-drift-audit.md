# Quotation content drift audit

Date: 2026-08-29

Status: confirmed cause and affected-area record only

## Cause

- Chrome and the in-app browser hold separate persisted revisions of the same
  document ID. Chrome has revision 23 with nine nodes and no groups; the in-app
  browser has revision 18 with the same nine nodes plus four groups.
- The draft source context does not store `composerVersion` or a deterministic
  source/content fingerprint.
- Built-in quotation templates still identify themselves as template version 1
  and composer version 1 even though generated document structure changed.
- Template materialization always uses the current composer, while already
  saved documents are accepted as valid and are not structurally upgraded.
- `document.groups` defaults to an empty array, so an old flat quotation passes
  schema validation and the loader cannot distinguish legacy missing groups
  from intentionally ungrouped content.

## Affected areas

- Layers hierarchy and group membership.
- Existing quotation page structure, pagination, layer names, bindings,
  geometry, lock/visibility defaults, and later composer-generated corrections.
- Template catalog previews versus applying a style to an older document:
  previews use current composition while style application preserves the old
  structure.
- Persisted Stuwiz quotation snapshots, which do not automatically reconcile
  with newer source records.
- Browser-local uploaded images whose document references can survive while
  their bytes are unavailable in another browser.
- Any future document feature introduced through permissive schema defaults
  without a separate content-migration decision.

This audit does not decide remediation design, sequencing, or migration policy.
