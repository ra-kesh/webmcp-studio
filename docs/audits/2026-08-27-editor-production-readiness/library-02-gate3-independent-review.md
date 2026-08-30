# LIBRARY-02 Gate 3 independent review

Date: 2026-08-31

Status: accepted after remediation; zero open P0/P1 findings

## Scope read

The reviewer inspected the actual preview generator and checked-in generation,
manifest contract, runtime controller/provider/component, Studio catalog
projection, both template browser integrations, route ownership and focused
tests. Review was read-only and separate from implementation.

## Initial finding

One P1 remained: `LibraryPreviewController` defaulted to three concurrent
requests, but an injected `concurrency` value could exceed the product-wide
ceiling. Production did not use that escape, but the owner contract must make
the invariant structural rather than conventional.

The controller now clamps every configured value to three. A regression test
passes `99`, retains four raster descriptors and proves three active plus one
queued request.

During remediation, the implementation owner also found that eager current
coverage validation could make a stale checked-in manifest prevent the
generator from importing and replacing it. Manifest schema parsing is now
separate from current-catalog coverage validation. Generation, published
verification and descriptor consumers explicitly enforce coverage, and a test
proves stale schema can be parsed for replacement but cannot pass coverage.

## Accepted evidence

- 21/21 active exact template previews verify against checked-in bytes.
- Generator publication is temporary-first, fingerprinted and keeps prior
  immutable generations.
- Runtime work is near-view, exact-key deduplicated and globally capped at
  three; stale and aborted generations cannot publish.
- MIME type, PNG structure/dimensions and SHA-256 are verified before an object
  URL reaches a card.
- Manual Retry bypasses cache and stays separate from selection.
- Normal Start and editor template grids mount no live Artboard; live rendering
  exists only for an explicit labelled fallback descriptor.
- Focused remediation checks pass 13/13; the integrated Gate 3 group passes
  36/36, Studio typecheck passes and the Node 22 production build passes.

Gate 3 is accepted. Gate 4 may build discovery against these preview contracts.
