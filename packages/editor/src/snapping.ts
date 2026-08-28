export type SnapBounds = {
  left: number
  top: number
  width: number
  height: number
}

export type AlignmentSnapSource = "page" | "object" | "guide"

export type AlignmentSnapTarget = {
  axis: "x" | "y"
  value: number
  source: AlignmentSnapSource
}

export type AlignmentSnapGuide = {
  axis: "x" | "y"
  value: number
  source: AlignmentSnapSource
}

export type SpacingSnapGuide = {
  axis: "x" | "y"
  source: "spacing"
  gap: number
  spans: { start: number; end: number; cross: number }[]
}

export type SnapGuide = AlignmentSnapGuide | SpacingSnapGuide

export type SnapResult = {
  deltaX: number
  deltaY: number
  guides: SnapGuide[]
  latch: MoveSnapLatch | null
}

type Candidate = Omit<AlignmentSnapGuide, "axis">

type SpacingCandidate = {
  delta: number
  guide: SpacingSnapGuide
  score: number
  targetStart: number
}

export type MoveSnapAxisLatch = Readonly<{
  value: number
  source: AlignmentSnapSource | "spacing"
}>

export type MoveSnapLatch = Readonly<{
  x?: MoveSnapAxisLatch
  y?: MoveSnapAxisLatch
}>

export type MoveSnapOptions = Readonly<{
  targets?: readonly AlignmentSnapTarget[]
  previousLatch?: MoveSnapLatch | null
  threshold?: number
  releaseThreshold?: number
  screenThreshold?: Readonly<{
    acquirePixels: number
    releasePixels: number
    zoom: number
  }>
}>

const DEFAULT_ACQUIRE_THRESHOLD = 8
const DEFAULT_RELEASE_THRESHOLD = 12
const EPSILON = 1e-7

const axisPoints = (start: number, size: number) => [
  start,
  start + size / 2,
  start + size,
]

function closestSnap(
  movingPoints: number[],
  candidates: Candidate[],
  acquireThreshold: number,
  releaseThreshold: number,
  previousLatch?: MoveSnapAxisLatch
) {
  const heldTarget =
    previousLatch && previousLatch.source !== "spacing"
      ? candidates.find(
          (candidate) =>
            candidate.source === previousLatch.source &&
            Math.abs(candidate.value - previousLatch.value) <= EPSILON
        )
      : undefined
  if (heldTarget) {
    let heldDelta: number | null = null
    for (const movingPoint of movingPoints) {
      const delta = heldTarget.value - movingPoint
      if (
        Math.abs(delta) <= releaseThreshold &&
        (heldDelta === null || Math.abs(delta) < Math.abs(heldDelta))
      ) {
        heldDelta = delta
      }
    }
    if (heldDelta !== null) {
      return {
        delta: heldDelta,
        candidate: heldTarget,
        score: Math.abs(heldDelta),
        phase: "held" as const,
      }
    }
  }

  let best: { delta: number; candidate: Candidate; score: number } | null = null
  for (const movingPoint of movingPoints) {
    for (const candidate of candidates) {
      const delta = candidate.value - movingPoint
      if (Math.abs(delta) > acquireThreshold) continue
      const score =
        Math.abs(delta) +
        (candidate.source === "guide" ? 0 : candidate.source === "page" ? 2 : 6)
      if (!best || score < best.score) {
        best = { delta, candidate, score }
      }
    }
  }
  return best ? { ...best, phase: "acquired" as const } : null
}

const right = (bounds: SnapBounds) => bounds.left + bounds.width
const bottom = (bounds: SnapBounds) => bounds.top + bounds.height

function rangesOverlap(starts: number[], ends: number[]) {
  return Math.max(...starts) <= Math.min(...ends)
}

function horizontalCross(bounds: SnapBounds[]) {
  const above = Math.min(...bounds.map((item) => item.top)) - 22
  return above >= 12
    ? above
    : Math.max(...bounds.map((item) => bottom(item))) + 22
}

function verticalCross(bounds: SnapBounds[]) {
  const left = Math.min(...bounds.map((item) => item.left)) - 22
  return left >= 12 ? left : Math.max(...bounds.map((item) => right(item))) + 22
}

function spacingCandidate(
  axis: "x" | "y",
  moving: SnapBounds,
  peers: SnapBounds[],
  threshold: number
): SpacingCandidate | null {
  let best: SpacingCandidate | null = null
  const orderedPeers = peers
    .filter((peer) =>
      axis === "x"
        ? rangesOverlap([moving.top, peer.top], [bottom(moving), bottom(peer)])
        : rangesOverlap([moving.left, peer.left], [right(moving), right(peer)])
    )
    .sort((first, second) =>
      axis === "x" ? first.left - second.left : first.top - second.top
    )
  const consider = (
    desiredStart: number,
    gap: number,
    involvedPeers: SnapBounds[],
    spans: { start: number; end: number }[]
  ) => {
    if (gap < 4) return
    const currentStart = axis === "x" ? moving.left : moving.top
    const delta = desiredStart - currentStart
    if (Math.abs(delta) > threshold) return
    const moved =
      axis === "x"
        ? { ...moving, left: desiredStart }
        : { ...moving, top: desiredStart }
    const involved = [...involvedPeers, moved]
    const aligned =
      axis === "x"
        ? rangesOverlap(
            involved.map((item) => item.top),
            involved.map(bottom)
          )
        : rangesOverlap(
            involved.map((item) => item.left),
            involved.map(right)
          )
    if (!aligned) return
    const cross =
      axis === "x" ? horizontalCross(involved) : verticalCross(involved)
    const candidate: SpacingCandidate = {
      delta,
      score: Math.abs(delta) + 2,
      targetStart: desiredStart,
      guide: {
        axis,
        source: "spacing",
        gap,
        spans: spans.map((span) => ({ ...span, cross })),
      },
    }
    if (!best || candidate.score < best.score) best = candidate
  }

  for (
    let firstIndex = 0;
    firstIndex < orderedPeers.length - 1;
    firstIndex += 1
  ) {
    const firstPeer = orderedPeers[firstIndex]
    const secondPeer = orderedPeers[firstIndex + 1]
    if (!firstPeer || !secondPeer) continue
    const firstStart = axis === "x" ? firstPeer.left : firstPeer.top
    const firstEnd = axis === "x" ? right(firstPeer) : bottom(firstPeer)
    const secondStart = axis === "x" ? secondPeer.left : secondPeer.top
    const secondEnd = axis === "x" ? right(secondPeer) : bottom(secondPeer)
    const [
      leading,
      trailing,
      leadingStart,
      leadingEnd,
      trailingStart,
      trailingEnd,
    ] =
      firstStart <= secondStart
        ? [firstPeer, secondPeer, firstStart, firstEnd, secondStart, secondEnd]
        : [secondPeer, firstPeer, secondStart, secondEnd, firstStart, firstEnd]
    const movingSize = axis === "x" ? moving.width : moving.height

    const freeSpace = trailingStart - leadingEnd - movingSize
    if (freeSpace >= 8) {
      const gap = freeSpace / 2
      const desiredStart = leadingEnd + gap
      consider(
        desiredStart,
        gap,
        [leading, trailing],
        [
          { start: leadingEnd, end: desiredStart },
          {
            start: desiredStart + movingSize,
            end: trailingStart,
          },
        ]
      )
    }

    const existingGap = trailingStart - leadingEnd
    if (existingGap >= 4) {
      const desiredAfter = trailingEnd + existingGap
      consider(
        desiredAfter,
        existingGap,
        [leading, trailing],
        [
          { start: leadingEnd, end: trailingStart },
          { start: trailingEnd, end: desiredAfter },
        ]
      )

      const desiredBefore = leadingStart - existingGap - movingSize
      consider(
        desiredBefore,
        existingGap,
        [leading, trailing],
        [
          { start: desiredBefore + movingSize, end: leadingStart },
          { start: leadingEnd, end: trailingStart },
        ]
      )
    }
  }
  return best
}

export function calculateSnap(
  moving: SnapBounds,
  page: { width: number; height: number },
  peers: SnapBounds[],
  options: number | MoveSnapOptions = {}
): SnapResult {
  const resolvedOptions =
    typeof options === "number" ? { threshold: options } : options
  const acquireThreshold = resolvedOptions.screenThreshold
    ? resolvedOptions.screenThreshold.acquirePixels /
      resolvedOptions.screenThreshold.zoom
    : (resolvedOptions.threshold ?? DEFAULT_ACQUIRE_THRESHOLD)
  const releaseThreshold = resolvedOptions.screenThreshold
    ? resolvedOptions.screenThreshold.releasePixels /
      resolvedOptions.screenThreshold.zoom
    : (resolvedOptions.releaseThreshold ?? DEFAULT_RELEASE_THRESHOLD)
  if (
    !Number.isFinite(acquireThreshold) ||
    acquireThreshold <= 0 ||
    !Number.isFinite(releaseThreshold) ||
    releaseThreshold < acquireThreshold
  ) {
    throw new RangeError(
      "Move snap thresholds must be finite, positive, and release must be at least acquire."
    )
  }
  const xCandidates: Candidate[] = axisPoints(0, page.width).map((value) => ({
    value,
    source: "page",
  }))
  const yCandidates: Candidate[] = axisPoints(0, page.height).map((value) => ({
    value,
    source: "page",
  }))

  for (const peer of peers) {
    xCandidates.push(
      ...axisPoints(peer.left, peer.width).map((value) => ({
        value,
        source: "object" as const,
      }))
    )
    yCandidates.push(
      ...axisPoints(peer.top, peer.height).map((value) => ({
        value,
        source: "object" as const,
      }))
    )
  }

  for (const target of resolvedOptions.targets ?? []) {
    if (!Number.isFinite(target.value)) continue
    const candidate = { value: target.value, source: target.source }
    if (target.axis === "x") xCandidates.push(candidate)
    else yCandidates.push(candidate)
  }

  const xSnap = closestSnap(
    axisPoints(moving.left, moving.width),
    xCandidates,
    acquireThreshold,
    releaseThreshold,
    resolvedOptions.previousLatch?.x
  )
  const ySnap = closestSnap(
    axisPoints(moving.top, moving.height),
    yCandidates,
    acquireThreshold,
    releaseThreshold,
    resolvedOptions.previousLatch?.y
  )

  const xSpacing = spacingCandidate(
    "x",
    moving,
    peers,
    resolvedOptions.previousLatch?.x?.source === "spacing"
      ? releaseThreshold
      : acquireThreshold
  )
  const ySpacing = spacingCandidate(
    "y",
    moving,
    peers,
    resolvedOptions.previousLatch?.y?.source === "spacing"
      ? releaseThreshold
      : acquireThreshold
  )
  const heldXSpacing =
    xSpacing &&
    resolvedOptions.previousLatch?.x?.source === "spacing" &&
    Math.abs(xSpacing.targetStart - resolvedOptions.previousLatch.x.value) <=
      EPSILON
  const heldYSpacing =
    ySpacing &&
    resolvedOptions.previousLatch?.y?.source === "spacing" &&
    Math.abs(ySpacing.targetStart - resolvedOptions.previousLatch.y.value) <=
      EPSILON
  const useXSpacing =
    xSpacing && (heldXSpacing || !xSnap || xSpacing.score < xSnap.score)
  const useYSpacing =
    ySpacing && (heldYSpacing || !ySnap || ySpacing.score < ySnap.score)

  const xAlignmentGuide =
    !useXSpacing && xSnap ? { axis: "x" as const, ...xSnap.candidate } : null
  const yAlignmentGuide =
    !useYSpacing && ySnap ? { axis: "y" as const, ...ySnap.candidate } : null
  const xLatch = useXSpacing
    ? { source: "spacing" as const, value: xSpacing.targetStart }
    : xAlignmentGuide
      ? { source: xAlignmentGuide.source, value: xAlignmentGuide.value }
      : undefined
  const yLatch = useYSpacing
    ? { source: "spacing" as const, value: ySpacing.targetStart }
    : yAlignmentGuide
      ? { source: yAlignmentGuide.source, value: yAlignmentGuide.value }
      : undefined

  return {
    deltaX: useXSpacing ? xSpacing.delta : (xSnap?.delta ?? 0),
    deltaY: useYSpacing ? ySpacing.delta : (ySnap?.delta ?? 0),
    guides: [
      ...(useXSpacing
        ? [xSpacing.guide]
        : xAlignmentGuide
          ? [xAlignmentGuide]
          : []),
      ...(useYSpacing
        ? [ySpacing.guide]
        : yAlignmentGuide
          ? [yAlignmentGuide]
          : []),
    ],
    latch:
      xLatch || yLatch
        ? { ...(xLatch ? { x: xLatch } : {}), ...(yLatch ? { y: yLatch } : {}) }
        : null,
  }
}
