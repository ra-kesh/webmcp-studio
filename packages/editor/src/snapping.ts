export type SnapBounds = {
  left: number
  top: number
  width: number
  height: number
}

export type AlignmentSnapGuide = {
  axis: "x" | "y"
  value: number
  source: "page" | "object"
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
}

type Candidate = Omit<AlignmentSnapGuide, "axis">

type SpacingCandidate = {
  delta: number
  guide: SpacingSnapGuide
  score: number
}

const axisPoints = (start: number, size: number) => [
  start,
  start + size / 2,
  start + size,
]

function closestSnap(
  movingPoints: number[],
  candidates: Candidate[],
  threshold: number
) {
  let best: { delta: number; candidate: Candidate; score: number } | null = null
  for (const movingPoint of movingPoints) {
    for (const candidate of candidates) {
      const delta = candidate.value - movingPoint
      if (Math.abs(delta) > threshold) continue
      const score = Math.abs(delta) + (candidate.source === "object" ? 4 : 0)
      if (!best || score < best.score) {
        best = { delta, candidate, score }
      }
    }
  }
  return best
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
  threshold = 8
): SnapResult {
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

  const xSnap = closestSnap(
    axisPoints(moving.left, moving.width),
    xCandidates,
    threshold
  )
  const ySnap = closestSnap(
    axisPoints(moving.top, moving.height),
    yCandidates,
    threshold
  )

  const xSpacing = spacingCandidate("x", moving, peers, threshold)
  const ySpacing = spacingCandidate("y", moving, peers, threshold)
  const useXSpacing = xSpacing && (!xSnap || xSpacing.score < xSnap.score)
  const useYSpacing = ySpacing && (!ySnap || ySpacing.score < ySnap.score)

  return {
    deltaX: useXSpacing ? xSpacing.delta : (xSnap?.delta ?? 0),
    deltaY: useYSpacing ? ySpacing.delta : (ySnap?.delta ?? 0),
    guides: [
      ...(useXSpacing
        ? [xSpacing.guide]
        : xSnap
          ? [{ axis: "x" as const, ...xSnap.candidate }]
          : []),
      ...(useYSpacing
        ? [ySpacing.guide]
        : ySnap
          ? [{ axis: "y" as const, ...ySnap.candidate }]
          : []),
    ],
  }
}
