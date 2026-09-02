const roundedCoordinate = (value: number) => Number(value.toFixed(6)).toString()

const polarPoint = (
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  angle: number
) => ({
  x: centerX + Math.cos(angle) * radiusX,
  y: centerY + Math.sin(angle) * radiusY,
})

const closedPath = (points: readonly { x: number; y: number }[]) =>
  points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${roundedCoordinate(point.x)} ${roundedCoordinate(point.y)}`
    )
    .join(" ") + " Z"

/** Returns a deterministic regular-polygon path inside the supplied frame. */
export function regularPolygonPath(
  width: number,
  height: number,
  pointCount: number
) {
  const count = Math.max(3, Math.min(64, Math.trunc(pointCount)))
  const centerX = width / 2
  const centerY = height / 2
  const radiusX = width / 2
  const radiusY = height / 2
  return closedPath(
    Array.from({ length: count }, (_, index) =>
      polarPoint(
        centerX,
        centerY,
        radiusX,
        radiusY,
        -Math.PI / 2 + (index * Math.PI * 2) / count
      )
    )
  )
}

/** Returns a deterministic alternating-radius star path inside the frame. */
export function regularStarPath(
  width: number,
  height: number,
  pointCount: number,
  innerRadius: number
) {
  const count = Math.max(3, Math.min(64, Math.trunc(pointCount)))
  const ratio = Math.max(0.01, Math.min(0.99, innerRadius))
  const centerX = width / 2
  const centerY = height / 2
  const radiusX = width / 2
  const radiusY = height / 2
  return closedPath(
    Array.from({ length: count * 2 }, (_, index) => {
      const inner = index % 2 === 1
      return polarPoint(
        centerX,
        centerY,
        radiusX * (inner ? ratio : 1),
        radiusY * (inner ? ratio : 1),
        -Math.PI / 2 + (index * Math.PI) / count
      )
    })
  )
}
