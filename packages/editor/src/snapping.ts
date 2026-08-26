export type SnapBounds = {
  left: number
  top: number
  width: number
  height: number
}

export type SnapGuide = {
  axis: "x" | "y"
  value: number
  source: "page" | "object"
}

export type SnapResult = {
  deltaX: number
  deltaY: number
  guides: SnapGuide[]
}

type Candidate = Omit<SnapGuide, "axis">

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

  return {
    deltaX: xSnap?.delta ?? 0,
    deltaY: ySnap?.delta ?? 0,
    guides: [
      ...(xSnap ? [{ axis: "x" as const, ...xSnap.candidate }] : []),
      ...(ySnap ? [{ axis: "y" as const, ...ySnap.candidate }] : []),
    ],
  }
}
