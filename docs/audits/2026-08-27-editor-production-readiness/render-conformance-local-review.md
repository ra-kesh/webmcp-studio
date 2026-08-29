# Local render conformance independent review

Date: 2026-08-29

Verdict: **ACCEPT — no remaining P0/P1 finding**

## Reviewed boundary

- immutable version-2 capture ownership and all 12 selected artifact hashes;
- unchanged raw pixel ratios and RMSE;
- the complete-page text-only geometry substitute;
- manifest validation, report truthfulness, and adversarial regression tests;
- explicit separation between completed local evidence and open deployed
  parity.

## Rejected first candidate

The first geometry comparator checked line count and outer edges but did not
use its measured ink-pixel count or prove foreground color/opacity. A candidate
could retain only the two outer columns of a line, or render the same bounds in
the wrong color, and still substitute for a raw pixel failure. The reviewer
rejected this as P1.

## Accepted repair

Acceptance is now conjunctive across:

- exact horizontal line-band count;
- top, bottom, left, and right edges within one pixel;
- per-band ink-pixel coverage within 10%;
- upper-quartile contrast within 0.1 of the baseline;
- lower-decile expected foreground direction cosine of at least 0.98.

RGBA pixels are composited against the canonical page background before
measurement. Expected foreground includes the canonical text opacity. Geometry
may substitute for raw pixels only when exactly one visible, unrotated text
node is the page's complete ordered content, and the scan covers the complete
page. Non-text pages remain raw-threshold-only.

The adversarial matrix rejects missing glyph interiors with identical outer
edges, wrong foreground hue, materially reduced opacity, changed wrapping,
missing ink, and two-pixel movement. The selected real corpus retains all three
long-text raw failures while separately reporting at most 3.81% coverage drift,
zero upper-quartile contrast drift, foreground direction cosine above 0.99999,
and at most one edge pixel.

The reviewer independently executed manifest/artifact validation and the full
pixel comparator, then matched every selected artifact's byte length and
SHA-256 to capture report v2. Deployed same-runtime capture remains open and
was not represented as completed.
