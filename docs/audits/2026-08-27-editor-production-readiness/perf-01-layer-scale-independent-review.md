# PERF-01 1,000-layer independent code review

Date: 2026-08-29

Verdict: **ACCEPT — no remaining P0/P1 finding**

## Reviewed boundary

The reviewer inspected the actual PERF-01 diff and its focused tests: camera
preview/settlement in `StudioShell`, ruler and guide ownership, Fabric
incremental synchronization, canonical command/history admission, active-page
crop chrome, deferred filmstrip rendering, the 1,000-layer Chromium gate, and
its atomically promoted evidence.

The review compared the camera and layer paths against the retained OpenPencil
and Loora references. It did not treat README claims, timing alone, or a green
typecheck as correctness proof.

## Rejections and repairs

The first review rejected four P1 paths:

1. Guide paint used the live preview camera while hit strips and drag math used
   settled React props. Guide targets are now always mounted, imperatively
   projected from the live camera, and pointer conversion reads the same live
   camera/viewport/page size.
2. The identity-preserving command fast path was root-exported and could accept
   schema-invalid values such as `NaN`. It now lives behind the internal history
   subpath. `createDocumentHistory` and document replacement establish schema
   plus semantic admission; a runtime guard rejects unadmitted documents while
   preserving admitted object identity.
3. Fabric recorded a requested image-node identity before awaited decode. A
   superseding sync could skip the replacement while the older generation
   discarded its result. Fabric now commits the node identity only after the
   awaited visual update survives the generation guard.
4. Crop chrome no longer required visible current-page membership. The guard is
   restored for hidden and off-page images.

The second review rejected one additional P1: the selected-image toolbar was
outside the transformed scene but still used settled camera state. It now
receives the same live camera as the scene, Fabric chrome, and ruler overlay.
Ref installation and layout reprojection also cover selection, viewport resize,
and unrelated React renders.

Focused regressions retain all five paths, including live guide drag
coordinates, unadmitted/invalid history input, superseding image decode,
hidden/off-page crop mode, and consecutive live-camera toolbar projections.

## Evidence decision

The selected artifact
`artifacts/perf-01-layer-scale-profile.json` was promoted only after every
budget passed. It records 1,000 visible nodes, 33 mounted layer rows, 258 ms
inspector editing, 17.5 ms p95 pan, and 17.4 ms p95 gesture zoom.

A later rerun under severe host memory/CPU pressure missed only the open-time
budget and did not replace the selected artifact. Retaining the earlier atomic
profile is truthful: the final toolbar repair adds only a null/bounds guard to
the 1,000-rectangle fixture and does not alter its measured rendering path.

## Final result

The independent reviewer re-inspected the repaired code and tests and returned
**ACCEPT with no remaining P0/P1 finding**.
