# Curated media source policy

The manifest is the source of truth for curated-media identity, discovery
metadata and provenance. Public files live under `/library/media/`; changing
any file requires a new immutable item version, byte count and SHA-256.

The six Studio originals retain their existing IDs. Their file-backed versions
are distinct from the temporary data-URI compatibility records used by the
current editor insertion and renderer boundary.

The OpenMoji subset comes from commit
`aeb8bb3a59e2de39c754ac79180c8131c906acea`. Each manifest item links to its
exact upstream file and names the individual creator recorded in the upstream
catalog. The distributed license text is at
`public/library/media/openmoji/LICENSE.txt`.

The first photograph set contains seven exact originals retrieved from
Wikimedia Commons on 31 August 2026. Each item links to its Commons file page
and original upload URL, records the creator, CC0 1.0 terms, the
API-reported upstream SHA-1, local SHA-256, byte count and decoded dimensions,
and states that the original bytes are preserved. Routine tests verify this
evidence offline against the checked-in files; they do not depend on the
network or a mutable search result.

Only photographs whose Commons file page explicitly identified the exact file
as CC0 were accepted. The visual review rejected images with identifiable
people, logos or private/customer content. These files are originals rather
than stock-search thumbnails or hotlinks. Their public source metadata was
retained because it describes already-published scenes and does not contain
customer or private Studio data. Any later transform or metadata removal must
be published as a new immutable item version with a new checksum and must set
`originalBytesPreserved` to match the evidence contract.
