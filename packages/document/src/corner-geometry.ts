/*
 * The smoothing construction is adapted from squircle-path-kit:
 * https://github.com/msurguy/squircle-path-kit
 *
 * MIT License
 * Copyright (c) 2026
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import type { CornerRadii } from "./schema"

type Point = Readonly<{ x: number; y: number }>
type Cubic = Readonly<{ cp1: Point; cp2: Point; end: Point }>
type Corner =
  | Readonly<{ kind: "sharp"; point: Point }>
  | Readonly<{
      kind: "rounded"
      start: Point
      end: Point
      segments: readonly Cubic[]
    }>
  | Readonly<{
      kind: "smooth"
      start: Point
      end: Point
      incoming: Cubic
      arc: readonly Cubic[]
      outgoing: Cubic
    }>

const point = (x: number, y: number): Point => ({ x, y })
const add = (left: Point, right: Point) =>
  point(left.x + right.x, left.y + right.y)
const subtract = (left: Point, right: Point) =>
  point(left.x - right.x, left.y - right.y)
const scale = (value: Point, factor: number) =>
  point(value.x * factor, value.y * factor)
const length = (value: Point) => Math.hypot(value.x, value.y)
const normalize = (value: Point) => {
  const magnitude = length(value)
  return magnitude < 1e-12 ? point(0, 0) : scale(value, 1 / magnitude)
}
const dot = (left: Point, right: Point) => left.x * right.x + left.y * right.y
const rotate90 = (value: Point) => point(-value.y, value.x)
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value))

export const uniformCornerRadii = (radius: number): CornerRadii => ({
  topLeft: radius,
  topRight: radius,
  bottomRight: radius,
  bottomLeft: radius,
})

export function resolveCornerRadii(
  radius: number,
  cornerRadii?: CornerRadii
): CornerRadii {
  return cornerRadii ?? uniformCornerRadii(radius)
}

export function scaleCornerRadii(
  radii: CornerRadii,
  factor: number
): CornerRadii {
  return {
    topLeft: radii.topLeft * factor,
    topRight: radii.topRight * factor,
    bottomRight: radii.bottomRight * factor,
    bottomLeft: radii.bottomLeft * factor,
  }
}

function arcCubics(
  center: Point,
  radius: number,
  startAngle: number,
  sweep: number
): Cubic[] {
  if (Math.abs(sweep) < 1e-10) return []
  if (Math.abs(sweep) > Math.PI / 2 + 1e-6) {
    const count = Math.ceil(Math.abs(sweep) / (Math.PI / 2))
    return Array.from({ length: count }, (_, index) =>
      arcCubics(
        center,
        radius,
        startAngle + (sweep / count) * index,
        sweep / count
      )
    ).flat()
  }
  const factor = (4 / 3) * Math.tan(sweep / 4)
  const start = point(Math.cos(startAngle), Math.sin(startAngle))
  const end = point(Math.cos(startAngle + sweep), Math.sin(startAngle + sweep))
  const startPoint = add(center, scale(start, radius))
  const endPoint = add(center, scale(end, radius))
  return [
    {
      cp1: add(startPoint, scale(point(-start.y, start.x), factor * radius)),
      cp2: subtract(endPoint, scale(point(-end.y, end.x), factor * radius)),
      end: endPoint,
    },
  ]
}

function corner(
  previous: Point,
  current: Point,
  next: Point,
  requestedRadius: number,
  requestedSmoothing: number,
  budget: number
): Corner {
  const incoming = normalize(subtract(previous, current))
  const outgoing = normalize(subtract(next, current))
  const opening = Math.acos(clamp(dot(incoming, outgoing), -1, 1))
  const halfOpening = opening / 2
  if (
    halfOpening < 1e-6 ||
    Math.abs(opening - Math.PI) < 1e-6 ||
    requestedRadius < 1e-6
  ) {
    return { kind: "sharp", point: current }
  }
  const tangent = Math.tan(halfOpening)
  let plainLength = requestedRadius / tangent
  let smoothing = clamp(requestedSmoothing, 0, 1)
  if (plainLength > budget) {
    plainLength = budget
    smoothing = 0
  } else if ((1 + smoothing) * plainLength > budget) {
    smoothing = budget / plainLength - 1
  }
  const consumed = (1 + smoothing) * plainLength
  const radius = plainLength * tangent
  if (radius < 1e-6 || plainLength < 1e-6) {
    return { kind: "sharp", point: current }
  }
  const center = add(
    current,
    scale(normalize(add(incoming, outgoing)), radius / Math.sin(halfOpening))
  )
  const tangentIn = add(current, scale(incoming, plainLength))
  const tangentOut = add(current, scale(outgoing, plainLength))
  const radialIn = normalize(subtract(tangentIn, center))
  const counterClockwise = dot(rotate90(radialIn), scale(incoming, -1)) > 0
  const startAngle = Math.atan2(radialIn.y, radialIn.x)
  const radialOut = normalize(subtract(tangentOut, center))
  const endAngle = Math.atan2(radialOut.y, radialOut.x)
  let sweep = endAngle - startAngle
  if (counterClockwise) {
    while (sweep < 0) sweep += Math.PI * 2
  } else {
    while (sweep > 0) sweep -= Math.PI * 2
  }
  if (smoothing < 1e-6) {
    return {
      kind: "rounded",
      start: tangentIn,
      end: tangentOut,
      segments: arcCubics(center, radius, startAngle, sweep),
    }
  }
  const turn = Math.PI - opening
  const beta = (turn / 2) * smoothing
  const trim = radius * Math.tan(beta / 2)
  const third = (consumed - (plainLength - trim)) / 3
  const first = 2 * third
  const reducedSweep = sweep * (1 - smoothing)
  const middleAngle = startAngle + sweep / 2
  const arcStartAngle = middleAngle - reducedSweep / 2
  const arcStart = add(
    center,
    scale(point(Math.cos(arcStartAngle), Math.sin(arcStartAngle)), radius)
  )
  return {
    kind: "smooth",
    start: add(current, scale(incoming, consumed)),
    end: add(current, scale(outgoing, consumed)),
    incoming: {
      cp1: add(current, scale(incoming, consumed - first)),
      cp2: add(current, scale(incoming, plainLength - trim)),
      end: arcStart,
    },
    arc: arcCubics(center, radius, arcStartAngle, reducedSweep),
    outgoing: {
      cp1: add(current, scale(outgoing, plainLength - trim)),
      cp2: add(current, scale(outgoing, consumed - first)),
      end: add(current, scale(outgoing, consumed)),
    },
  }
}

/**
 * Builds one deterministic SVG path for ordinary radii and Figma-style
 * smoothing. Competing corner demands split each edge proportionally.
 */
export function roundedRectanglePath(input: {
  width: number
  height: number
  radius?: number
  cornerRadii?: CornerRadii
  cornerSmoothing?: number
  x?: number
  y?: number
  precision?: number
}): string {
  const x = input.x ?? 0
  const y = input.y ?? 0
  const points = [
    point(x, y),
    point(x + input.width, y),
    point(x + input.width, y + input.height),
    point(x, y + input.height),
  ]
  const resolved = resolveCornerRadii(input.radius ?? 0, input.cornerRadii)
  const radii = [
    resolved.topLeft,
    resolved.topRight,
    resolved.bottomRight,
    resolved.bottomLeft,
  ]
  const smoothing = clamp(input.cornerSmoothing ?? 0, 0, 1)
  const edgeLengths = [input.width, input.height, input.width, input.height]
  const demands = radii.map((radius) => Math.max(0, radius) * (1 + smoothing))
  const nextAllowance = demands.map((demand, index) => {
    const next = demands[(index + 1) % demands.length]!
    const length = edgeLengths[index]!
    return demand + next > length && demand + next > 1e-6
      ? length * (demand / (demand + next))
      : demand
  })
  const previousAllowance = demands.map((demand, index) => {
    const previousIndex = (index - 1 + demands.length) % demands.length
    const previous = demands[previousIndex]!
    const length = edgeLengths[previousIndex]!
    return previous + demand > length && previous + demand > 1e-6
      ? length * (demand / (previous + demand))
      : demand
  })
  const corners = points.map((current, index) =>
    corner(
      points[(index - 1 + points.length) % points.length]!,
      current,
      points[(index + 1) % points.length]!,
      radii[index]!,
      smoothing,
      Math.min(
        demands[index]!,
        nextAllowance[index]!,
        previousAllowance[index]!
      )
    )
  )
  const factor = 10 ** (input.precision ?? 3)
  const format = (value: number) => Math.round(value * factor) / factor
  const cubic = (segment: Cubic) =>
    ` C ${format(segment.cp1.x)} ${format(segment.cp1.y)} ${format(segment.cp2.x)} ${format(segment.cp2.y)} ${format(segment.end.x)} ${format(segment.end.y)}`
  let path = ""
  for (const [index, current] of corners.entries()) {
    const next = corners[(index + 1) % corners.length]!
    if (index === 0) {
      const start = current.kind === "sharp" ? current.point : current.end
      path = `M ${format(start.x)} ${format(start.y)}`
    }
    if (next.kind === "sharp") {
      path += ` L ${format(next.point.x)} ${format(next.point.y)}`
      continue
    }
    path += ` L ${format(next.start.x)} ${format(next.start.y)}`
    if (next.kind === "rounded") {
      path += next.segments.map(cubic).join("")
    } else {
      path += cubic(next.incoming)
      path += next.arc.map(cubic).join("")
      path += cubic(next.outgoing)
    }
  }
  return `${path} Z`
}

export function cornerRadiiCss(radii: CornerRadii): string {
  return `${radii.topLeft}px ${radii.topRight}px ${radii.bottomRight}px ${radii.bottomLeft}px`
}

/** Keeps a centered stroke inside the canonical outer node frame. */
export function roundedRectanglePaintPath(input: {
  width: number
  height: number
  cornerRadii: CornerRadii
  cornerSmoothing: number
  strokeWidth: number
}): string {
  const inset = Math.max(0, input.strokeWidth) / 2
  return roundedRectanglePath({
    x: inset,
    y: inset,
    width: Math.max(1, input.width - inset * 2),
    height: Math.max(1, input.height - inset * 2),
    cornerRadii: {
      topLeft: Math.max(0, input.cornerRadii.topLeft - inset),
      topRight: Math.max(0, input.cornerRadii.topRight - inset),
      bottomRight: Math.max(0, input.cornerRadii.bottomRight - inset),
      bottomLeft: Math.max(0, input.cornerRadii.bottomLeft - inset),
    },
    cornerSmoothing: input.cornerSmoothing,
  })
}
