# MEDIA-01 real-browser acceptance

Date: 2026-08-29

Status: **18/18 production browser journeys pass**

## Boundary revisited

Before running this gate, the MEDIA-01 UX and implementation audits, the
integrated integrity closure, and the OpenPencil, Canva, Polotno, and managed
repository reference notes were reread. The suite runs through the real Studio
shell and canonical `/documents/:documentId` route on port 3001. Fixture
documents enter through the versioned current-draft migration and durable
assertions read the IndexedDB draft body rather than the retired single-document
localStorage path.

## Passing interaction matrix

The retained Playwright specification passes **18/18** and covers:

- Distinct Recent, Uploads, and Library collections plus atomic built-in image
  insertion and Undo.
- Selection locking while a managed insert settles, with close, Escape,
  uploads, and duplicate mutations blocked.
- Library and managed replacement with node identity, stack position,
  geometry, crop, mask, accessibility, and selection preserved.
- Source-bound replacement blocked before mutation with the shared field and
  correct recovery choices named.
- Exact managed metadata revalidation after list and after a WebMCP proposal,
  preventing an archived asset from reaching the document commit.
- Local insertion, durable reload, Recent reuse, and missing-blob repair
  through the same geometry-safe replacement flow.
- Independent multi-file progress, success, error, cancellation, and retry;
  completed-but-unused uploads remain outside Recent.
- Repository failure/retry, collection-scoped search, and cancellation of a
  stale paginated result after the query changes.
- Active-upload close protection during reference navigation, truthful current
  and published reference review, archive revalidation, and authoritative
  storage refresh after archive.
- Bounded object-URL creation and revocation across a 60-item local inventory.
- Full-height 320px and 390px surfaces with no page overflow, 44px tested
  controls, trapped focus, Escape close, and focus restoration.

## Production defects closed by browser execution

The gate found two defects that non-browser tests did not expose:

- Fabric received an absolute URL after loading a canonical relative managed
  source. Raw string comparisons falsely reported the decoded image as
  unavailable. Sync replacement, readiness, and natural-size lookup now compare
  URL-equivalent sources, with a focused regression test.
- Compact insertion originates in More → Object → Add image. The ephemeral menu
  item was not a valid focus-return target, and the line tabs inherited a 32px
  list height. Studio now records the stable top-bar trigger and the compact
  collection controls meet the 44px target.

## Honest test-harness repairs

The suite now models the production contracts instead of bypassing them:

- Managed fixtures provide matching MIME, byte length, dimensions, verified
  ETag identity, and CORS headers.
- Fresh upload responses are added to the authoritative mocked repository
  before use, so exact pre-commit metadata revalidation remains exercised.
- WebMCP asset insertion sends the current strict placement object.
- Local identities are asserted by their public inspected layer name because
  `inspect_design` intentionally redacts browser-private local asset IDs.
- Source-bound replacement asserts the disabled Inspector action and its
  explanatory status instead of attempting a knowingly blocked dialog action.

## Remaining release evidence

This closes the local visible-browser gap. It does not claim a deployed D1/R2
migration, real multipart upload streaming, deployed workspace-principal
isolation, quota telemetry, or production artifact retention. Those remain the
MEDIA-01 infrastructure release gate.
