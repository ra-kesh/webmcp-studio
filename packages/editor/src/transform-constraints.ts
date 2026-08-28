import type {
  AlignmentSnapSource,
  AlignmentSnapTarget,
  SnapBounds,
  SnapGuide,
} from "./snapping"

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w"

export type TransformRect = Readonly<{
  x: number
  y: number
  width: number
  height: number
}>

export type ResizeModifiers = Readonly<{
  shiftKey: boolean
  altKey?: boolean
}>

export type ResizeSnapBasis =
  | Readonly<{ kind: "axis_aligned" }>
  | Readonly<{
      kind: "non_axis_aligned"
      source: "node" | "ancestor" | "selection"
    }>

export type ResizeSnapPolicy = Readonly<{
  enabled: boolean
  page: Readonly<{ width: number; height: number }>
  peers: readonly SnapBounds[]
  targets?: readonly AlignmentSnapTarget[]
  basis: ResizeSnapBasis
  previousLatch?: ResizeSnapLatch | null
  screenThreshold?: ResizeSnapScreenThreshold
  /**
   * Legacy document-space acquire distance. Canvas integrations should pass
   * `screenThreshold` so snapping stays stable across zoom levels.
   */
  threshold?: number
  /** Legacy document-space release distance. */
  releaseThreshold?: number
}>

export type ResizeSnapScreenThreshold = Readonly<{
  acquirePixels: number
  releasePixels: number
  zoom: number
}>

export type ResizeSnapAxisLatch = Readonly<{
  value: number
  source: AlignmentSnapSource
}>

export type ResizeSnapLatch = Readonly<{
  x?: ResizeSnapAxisLatch
  y?: ResizeSnapAxisLatch
}>

export type ResizeConstraintInput = Readonly<{
  baseline: TransformRect
  proposed: TransformRect
  handle: ResizeHandle
  modifiers: ResizeModifiers
  minimumSize?: Readonly<{ width: number; height: number }>
  snap?: ResizeSnapPolicy
}>

export type ResizeSnapDecision =
  | Readonly<{ status: "not_requested" }>
  | Readonly<{ status: "disabled" }>
  | Readonly<{
      status: "declined"
      reason: "non_axis_aligned"
      source: "node" | "ancestor" | "selection"
    }>
  | Readonly<{
      status: "evaluated"
      snappedAxes: readonly ("x" | "y")[]
    }>

export type ResizeConstraintResult = Readonly<{
  rect: TransformRect
  guides: readonly SnapGuide[]
  snap: ResizeSnapDecision
  latch: ResizeSnapLatch | null
}>

export type RotationSnapLatch = Readonly<{ angle: number }>

export type RotationSnapInput = Readonly<{
  proposedAngle: number
  enabled: boolean
  previousLatch?: RotationSnapLatch | null
  interval?: number
  threshold?: number
  releaseThreshold?: number
}>

export type RotationSnapDecision =
  | Readonly<{ status: "disabled" }>
  | Readonly<{ status: "free" }>
  | Readonly<{ status: "acquired"; angle: number }>
  | Readonly<{ status: "held"; angle: number }>

export type RotationSnapResult = Readonly<{
  angle: number
  latch: RotationSnapLatch | null
  snap: RotationSnapDecision
}>

type MutableEdges = {
  left: number
  top: number
  right: number
  bottom: number
}

type AlignmentCandidate = {
  axis: "x" | "y"
  value: number
  source: AlignmentSnapSource
  score: number
  phase: "acquired" | "held"
}

const DEFAULT_MINIMUM_SIZE = 1
const DEFAULT_RESIZE_SNAP_THRESHOLD = 8
const DEFAULT_RESIZE_SNAP_RELEASE_THRESHOLD = 12
const DEFAULT_ROTATION_INTERVAL = 15
const DEFAULT_ROTATION_THRESHOLD = 3
const DEFAULT_ROTATION_RELEASE_THRESHOLD = 5
const EPSILON = 1e-7

const movesWest = (handle: ResizeHandle) => handle.includes("w")
const movesEast = (handle: ResizeHandle) => handle.includes("e")
const movesNorth = (handle: ResizeHandle) => handle.includes("n")
const movesSouth = (handle: ResizeHandle) => handle.includes("s")

const horizontalEdgeMoves = (handle: ResizeHandle) =>
  movesWest(handle) || movesEast(handle)

const verticalEdgeMoves = (handle: ResizeHandle) =>
  movesNorth(handle) || movesSouth(handle)

const finitePositive = (value: number, label: string) => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite positive number.`)
  }
  return value
}

const finite = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback

function checkedBaseline(rect: TransformRect): TransformRect {
  if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y)) {
    throw new RangeError("Resize baseline position must be finite.")
  }
  const checked = {
    x: rect.x,
    y: rect.y,
    width: finitePositive(rect.width, "Resize baseline width"),
    height: finitePositive(rect.height, "Resize baseline height"),
  }
  if (
    !Number.isFinite(checked.x + checked.width) ||
    !Number.isFinite(checked.y + checked.height)
  ) {
    throw new RangeError("Resize baseline edges must be finite.")
  }
  return checked
}

function safeAdd(left: number, right: number, fallback: number) {
  const result = left + right
  return Number.isFinite(result) ? result : fallback
}

function proposedEdges(
  baseline: TransformRect,
  proposed: TransformRect,
  handle: ResizeHandle,
  centered: boolean
): MutableEdges {
  const baselineRight = baseline.x + baseline.width
  const baselineBottom = baseline.y + baseline.height
  const centerX = baseline.x + baseline.width / 2
  const centerY = baseline.y + baseline.height / 2
  const proposedX = finite(proposed.x, baseline.x)
  const proposedY = finite(proposed.y, baseline.y)
  const proposedWidth = finite(proposed.width, baseline.width)
  const proposedHeight = finite(proposed.height, baseline.height)
  const proposedRight = safeAdd(proposedX, proposedWidth, baselineRight)
  const proposedBottom = safeAdd(proposedY, proposedHeight, baselineBottom)

  if (centered) {
    const horizontalExtent = movesWest(handle)
      ? centerX - proposedX
      : movesEast(handle)
        ? proposedRight - centerX
        : baseline.width / 2
    const verticalExtent = movesNorth(handle)
      ? centerY - proposedY
      : movesSouth(handle)
        ? proposedBottom - centerY
        : baseline.height / 2
    return {
      left: centerX - horizontalExtent,
      top: centerY - verticalExtent,
      right: centerX + horizontalExtent,
      bottom: centerY + verticalExtent,
    }
  }

  return {
    left: movesWest(handle) ? proposedX : baseline.x,
    top: movesNorth(handle) ? proposedY : baseline.y,
    right: movesEast(handle) ? proposedRight : baselineRight,
    bottom: movesSouth(handle) ? proposedBottom : baselineBottom,
  }
}

function clampEdges(
  baseline: TransformRect,
  handle: ResizeHandle,
  edges: MutableEdges,
  minimumWidth: number,
  minimumHeight: number,
  centered: boolean
): MutableEdges {
  const baselineRight = baseline.x + baseline.width
  const baselineBottom = baseline.y + baseline.height
  const centerX = baseline.x + baseline.width / 2
  const centerY = baseline.y + baseline.height / 2
  let { left, top, right, bottom } = edges

  if (horizontalEdgeMoves(handle)) {
    if (centered) {
      const width = Math.max(minimumWidth, finite(right - left, baseline.width))
      left = centerX - width / 2
      right = centerX + width / 2
    } else if (movesWest(handle)) {
      right = baselineRight
      left = Math.min(finite(left, baseline.x), right - minimumWidth)
    } else {
      left = baseline.x
      right = Math.max(finite(right, baselineRight), left + minimumWidth)
    }
  } else {
    left = baseline.x
    right = baselineRight
  }

  if (verticalEdgeMoves(handle)) {
    if (centered) {
      const height = Math.max(
        minimumHeight,
        finite(bottom - top, baseline.height)
      )
      top = centerY - height / 2
      bottom = centerY + height / 2
    } else if (movesNorth(handle)) {
      bottom = baselineBottom
      top = Math.min(finite(top, baseline.y), bottom - minimumHeight)
    } else {
      top = baseline.y
      bottom = Math.max(finite(bottom, baselineBottom), top + minimumHeight)
    }
  } else {
    top = baseline.y
    bottom = baselineBottom
  }

  return { left, top, right, bottom }
}

function constrainAspectRatio(
  baseline: TransformRect,
  handle: ResizeHandle,
  edges: MutableEdges,
  minimumWidth: number,
  minimumHeight: number,
  centered: boolean
): MutableEdges {
  const horizontal = horizontalEdgeMoves(handle)
  const vertical = verticalEdgeMoves(handle)
  const width = edges.right - edges.left
  const height = edges.bottom - edges.top
  const widthScale = width / baseline.width
  const heightScale = height / baseline.height
  const requestedScale =
    horizontal && vertical
      ? Math.abs(width - baseline.width) > Math.abs(height - baseline.height)
        ? widthScale
        : heightScale
      : horizontal
        ? widthScale
        : heightScale
  const minimumScale = Math.max(
    minimumWidth / baseline.width,
    minimumHeight / baseline.height
  )
  const scale = Math.max(minimumScale, finite(requestedScale, 1))
  const constrainedWidth = baseline.width * scale
  const constrainedHeight = baseline.height * scale
  return edgesForSize(
    baseline,
    handle,
    constrainedWidth,
    constrainedHeight,
    centered
  )
}

function edgesForSize(
  baseline: TransformRect,
  handle: ResizeHandle,
  width: number,
  height: number,
  centered: boolean
): MutableEdges {
  const baselineRight = baseline.x + baseline.width
  const baselineBottom = baseline.y + baseline.height
  const left =
    centered || !horizontalEdgeMoves(handle)
      ? baseline.x + (baseline.width - width) / 2
      : movesWest(handle)
        ? baselineRight - width
        : baseline.x
  const top =
    centered || !verticalEdgeMoves(handle)
      ? baseline.y + (baseline.height - height) / 2
      : movesNorth(handle)
        ? baselineBottom - height
        : baseline.y
  return { left, top, right: left + width, bottom: top + height }
}

function constrainAspectRatioToCandidate(
  baseline: TransformRect,
  handle: ResizeHandle,
  candidate: AlignmentCandidate,
  minimumWidth: number,
  minimumHeight: number,
  centered: boolean
): MutableEdges {
  const baselineRight = baseline.x + baseline.width
  const baselineBottom = baseline.y + baseline.height
  const centerX = baseline.x + baseline.width / 2
  const centerY = baseline.y + baseline.height / 2
  const requestedSize =
    candidate.axis === "x"
      ? centered
        ? Math.abs(candidate.value - centerX) * 2
        : movesWest(handle)
          ? baselineRight - candidate.value
          : candidate.value - baseline.x
      : centered
        ? Math.abs(candidate.value - centerY) * 2
        : movesNorth(handle)
          ? baselineBottom - candidate.value
          : candidate.value - baseline.y
  const baselineSize = candidate.axis === "x" ? baseline.width : baseline.height
  const minimumScale = Math.max(
    minimumWidth / baseline.width,
    minimumHeight / baseline.height
  )
  const scale = Math.max(minimumScale, requestedSize / baselineSize)
  const width = baseline.width * scale
  const height = baseline.height * scale
  return edgesForSize(baseline, handle, width, height, centered)
}

const rectFromEdges = (edges: MutableEdges): TransformRect => ({
  x: edges.left,
  y: edges.top,
  width: edges.right - edges.left,
  height: edges.bottom - edges.top,
})

function targetValues(
  page: Readonly<{ width: number; height: number }>,
  peers: readonly SnapBounds[],
  axis: "x" | "y",
  explicitTargets: readonly AlignmentSnapTarget[] = []
) {
  const pageSize = axis === "x" ? page.width : page.height
  const values: Array<{ value: number; source: AlignmentSnapSource }> = [
    { value: 0, source: "page" },
    { value: pageSize / 2, source: "page" },
    { value: pageSize, source: "page" },
  ]

  for (const peer of peers) {
    const start = axis === "x" ? peer.left : peer.top
    const size = axis === "x" ? peer.width : peer.height
    if (!Number.isFinite(start) || !Number.isFinite(size) || size < 0) continue
    values.push(
      { value: start, source: "object" },
      { value: start + size / 2, source: "object" },
      { value: start + size, source: "object" }
    )
  }
  for (const target of explicitTargets) {
    if (target.axis === axis && Number.isFinite(target.value)) {
      values.push({ value: target.value, source: target.source })
    }
  }
  return values
}

function closestAlignmentCandidate(
  axis: "x" | "y",
  activeValue: number,
  page: Readonly<{ width: number; height: number }>,
  peers: readonly SnapBounds[],
  acquireThreshold: number,
  releaseThreshold: number,
  previousLatch?: ResizeSnapAxisLatch,
  explicitTargets: readonly AlignmentSnapTarget[] = []
): AlignmentCandidate | null {
  let best: AlignmentCandidate | null = null
  const targets = targetValues(page, peers, axis, explicitTargets).filter(
    (target) => Number.isFinite(target.value)
  )
  const heldTarget = previousLatch
    ? targets.find(
        (target) =>
          target.source === previousLatch.source &&
          Math.abs(target.value - previousLatch.value) <= EPSILON
      )
    : undefined
  if (
    heldTarget &&
    Math.abs(heldTarget.value - activeValue) <= releaseThreshold
  ) {
    return {
      axis,
      ...heldTarget,
      score: Math.abs(heldTarget.value - activeValue),
      phase: "held",
    }
  }

  for (const target of targets) {
    const correction = target.value - activeValue
    if (Math.abs(correction) > acquireThreshold) continue
    const score =
      Math.abs(correction) +
      (target.source === "guide" ? 0 : target.source === "page" ? 2 : 6)
    if (!best || score < best.score) {
      best = { axis, ...target, score, phase: "acquired" }
    }
  }
  return best
}

function activeEdgeValue(
  handle: ResizeHandle,
  edges: MutableEdges,
  axis: "x" | "y"
) {
  if (axis === "x") return movesWest(handle) ? edges.left : edges.right
  return movesNorth(handle) ? edges.top : edges.bottom
}

function applyCandidate(
  edges: MutableEdges,
  baseline: TransformRect,
  handle: ResizeHandle,
  candidate: AlignmentCandidate,
  centered: boolean
) {
  if (candidate.axis === "x") {
    if (movesWest(handle)) {
      edges.left = candidate.value
      if (centered) {
        const centerX = baseline.x + baseline.width / 2
        edges.right = centerX * 2 - candidate.value
      }
    } else {
      edges.right = candidate.value
      if (centered) {
        const centerX = baseline.x + baseline.width / 2
        edges.left = centerX * 2 - candidate.value
      }
    }
  } else if (movesNorth(handle)) {
    edges.top = candidate.value
    if (centered) {
      const centerY = baseline.y + baseline.height / 2
      edges.bottom = centerY * 2 - candidate.value
    }
  } else {
    edges.bottom = candidate.value
    if (centered) {
      const centerY = baseline.y + baseline.height / 2
      edges.top = centerY * 2 - candidate.value
    }
  }
}

function candidateGuide(candidate: AlignmentCandidate): SnapGuide {
  return {
    axis: candidate.axis,
    value: candidate.value,
    source: candidate.source,
  }
}

function edgeMatchesCandidate(
  edges: MutableEdges,
  handle: ResizeHandle,
  candidate: AlignmentCandidate
) {
  return (
    Math.abs(
      activeEdgeValue(handle, edges, candidate.axis) - candidate.value
    ) <= EPSILON
  )
}

function applyResizeSnapping(
  baseline: TransformRect,
  handle: ResizeHandle,
  constrained: MutableEdges,
  preserveAspectRatio: boolean,
  centered: boolean,
  minimumWidth: number,
  minimumHeight: number,
  policy: ResizeSnapPolicy
): {
  edges: MutableEdges
  guides: SnapGuide[]
  axes: ("x" | "y")[]
  latch: ResizeSnapLatch | null
} {
  finitePositive(policy.page.width, "Resize snap page width")
  finitePositive(policy.page.height, "Resize snap page height")
  const acquireThreshold = policy.screenThreshold
    ? finitePositive(
        policy.screenThreshold.acquirePixels,
        "Resize snap acquire pixels"
      ) / finitePositive(policy.screenThreshold.zoom, "Resize snap zoom")
    : finitePositive(
        policy.threshold ?? DEFAULT_RESIZE_SNAP_THRESHOLD,
        "Resize snap threshold"
      )
  const releaseThreshold = policy.screenThreshold
    ? finitePositive(
        policy.screenThreshold.releasePixels,
        "Resize snap release pixels"
      ) / policy.screenThreshold.zoom
    : finitePositive(
        policy.releaseThreshold ?? DEFAULT_RESIZE_SNAP_RELEASE_THRESHOLD,
        "Resize snap release threshold"
      )
  if (releaseThreshold < acquireThreshold) {
    throw new RangeError(
      "Resize snap release threshold must be at least the acquire threshold."
    )
  }
  const xCandidate = horizontalEdgeMoves(handle)
    ? closestAlignmentCandidate(
        "x",
        activeEdgeValue(handle, constrained, "x"),
        policy.page,
        policy.peers,
        acquireThreshold,
        releaseThreshold,
        policy.previousLatch?.x,
        policy.targets
      )
    : null
  const yCandidate = verticalEdgeMoves(handle)
    ? closestAlignmentCandidate(
        "y",
        activeEdgeValue(handle, constrained, "y"),
        policy.page,
        policy.peers,
        acquireThreshold,
        releaseThreshold,
        policy.previousLatch?.y,
        policy.targets
      )
    : null

  if (!xCandidate && !yCandidate) {
    return { edges: constrained, guides: [], axes: [], latch: null }
  }

  let finalEdges: MutableEdges
  if (preserveAspectRatio) {
    const selectedCandidate =
      xCandidate && yCandidate
        ? xCandidate.phase === "held" && yCandidate.phase !== "held"
          ? xCandidate
          : yCandidate.phase === "held" && xCandidate.phase !== "held"
            ? yCandidate
            : xCandidate.score <= yCandidate.score
              ? xCandidate
              : yCandidate
        : (xCandidate ?? yCandidate)!
    finalEdges = constrainAspectRatioToCandidate(
      baseline,
      handle,
      selectedCandidate,
      minimumWidth,
      minimumHeight,
      centered
    )
  } else {
    const snapped = { ...constrained }
    if (xCandidate)
      applyCandidate(snapped, baseline, handle, xCandidate, centered)
    if (yCandidate)
      applyCandidate(snapped, baseline, handle, yCandidate, centered)
    finalEdges = clampEdges(
      baseline,
      handle,
      snapped,
      minimumWidth,
      minimumHeight,
      centered
    )
  }
  const candidates = [xCandidate, yCandidate].filter(
    (candidate): candidate is AlignmentCandidate =>
      candidate !== null && edgeMatchesCandidate(finalEdges, handle, candidate)
  )
  const latch: {
    x?: ResizeSnapAxisLatch
    y?: ResizeSnapAxisLatch
  } = {}
  for (const candidate of candidates) {
    latch[candidate.axis] = {
      value: candidate.value,
      source: candidate.source,
    }
  }

  return {
    edges: finalEdges,
    guides: candidates.map(candidateGuide),
    axes: candidates.map((candidate) => candidate.axis),
    latch: candidates.length ? latch : null,
  }
}

export function applyResizeConstraint(
  input: ResizeConstraintInput
): ResizeConstraintResult {
  const baseline = checkedBaseline(input.baseline)
  const minimumWidth = finitePositive(
    input.minimumSize?.width ?? DEFAULT_MINIMUM_SIZE,
    "Minimum resize width"
  )
  const minimumHeight = finitePositive(
    input.minimumSize?.height ?? DEFAULT_MINIMUM_SIZE,
    "Minimum resize height"
  )
  const centered = input.modifiers.altKey ?? false
  const rawEdges = proposedEdges(
    baseline,
    input.proposed,
    input.handle,
    centered
  )
  const clamped = clampEdges(
    baseline,
    input.handle,
    rawEdges,
    minimumWidth,
    minimumHeight,
    centered
  )
  const constrained = input.modifiers.shiftKey
    ? constrainAspectRatio(
        baseline,
        input.handle,
        clamped,
        minimumWidth,
        minimumHeight,
        centered
      )
    : clamped

  if (!input.snap) {
    return {
      rect: rectFromEdges(constrained),
      guides: [],
      snap: { status: "not_requested" },
      latch: null,
    }
  }
  if (!input.snap.enabled) {
    return {
      rect: rectFromEdges(constrained),
      guides: [],
      snap: { status: "disabled" },
      latch: null,
    }
  }
  if (input.snap.basis.kind === "non_axis_aligned") {
    return {
      rect: rectFromEdges(constrained),
      guides: [],
      snap: {
        status: "declined",
        reason: "non_axis_aligned",
        source: input.snap.basis.source,
      },
      latch: null,
    }
  }

  const snapped = applyResizeSnapping(
    baseline,
    input.handle,
    constrained,
    input.modifiers.shiftKey,
    centered,
    minimumWidth,
    minimumHeight,
    input.snap
  )
  return {
    rect: rectFromEdges(snapped.edges),
    guides: snapped.guides,
    snap: { status: "evaluated", snappedAxes: snapped.axes },
    latch: snapped.latch,
  }
}

export function normalizeRotation(angle: number) {
  if (!Number.isFinite(angle)) return 0
  const normalized = ((((angle + 180) % 360) + 360) % 360) - 180
  return Object.is(normalized, -0) ? 0 : normalized
}

function angularDistance(left: number, right: number) {
  return Math.abs(normalizeRotation(left - right))
}

export function snapRotation(input: RotationSnapInput): RotationSnapResult {
  const proposedAngle = normalizeRotation(input.proposedAngle)
  if (!input.enabled) {
    return {
      angle: proposedAngle,
      latch: null,
      snap: { status: "disabled" },
    }
  }

  const interval = finitePositive(
    input.interval ?? DEFAULT_ROTATION_INTERVAL,
    "Rotation snap interval"
  )
  const threshold = finitePositive(
    input.threshold ?? DEFAULT_ROTATION_THRESHOLD,
    "Rotation snap threshold"
  )
  const releaseThreshold = finitePositive(
    input.releaseThreshold ?? DEFAULT_ROTATION_RELEASE_THRESHOLD,
    "Rotation snap release threshold"
  )
  if (releaseThreshold < threshold) {
    throw new RangeError(
      "Rotation snap release threshold must be at least the acquire threshold."
    )
  }

  if (input.previousLatch) {
    const heldAngle = normalizeRotation(input.previousLatch.angle)
    if (angularDistance(proposedAngle, heldAngle) <= releaseThreshold) {
      const latch = { angle: heldAngle }
      return {
        angle: heldAngle,
        latch,
        snap: { status: "held", angle: heldAngle },
      }
    }
  }

  const nearestAngle = normalizeRotation(
    Math.round(proposedAngle / interval) * interval
  )
  if (angularDistance(proposedAngle, nearestAngle) <= threshold) {
    const latch = { angle: nearestAngle }
    return {
      angle: nearestAngle,
      latch,
      snap: { status: "acquired", angle: nearestAngle },
    }
  }

  return {
    angle: proposedAngle,
    latch: null,
    snap: { status: "free" },
  }
}
