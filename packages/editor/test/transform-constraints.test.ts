import { describe, expect, it } from "vitest"
import {
  applyResizeConstraint,
  normalizeRotation,
  snapRotation,
  type ResizeConstraintInput,
  type ResizeHandle,
  type TransformRect,
} from "../src"

const baseline: TransformRect = {
  x: 100,
  y: 80,
  width: 200,
  height: 100,
}

const unconstrained = (
  handle: ResizeHandle,
  proposed: TransformRect,
  overrides: Partial<ResizeConstraintInput> = {}
) =>
  applyResizeConstraint({
    baseline,
    proposed,
    handle,
    modifiers: { shiftKey: false },
    ...overrides,
  })

describe("resize constraints", () => {
  it("resizes all eight handles while anchoring the opposite edge", () => {
    const proposed = { x: 80, y: 70, width: 250, height: 130 }
    const expected: Record<ResizeHandle, TransformRect> = {
      nw: { x: 80, y: 70, width: 220, height: 110 },
      n: { x: 100, y: 70, width: 200, height: 110 },
      ne: { x: 100, y: 70, width: 230, height: 110 },
      e: { x: 100, y: 80, width: 230, height: 100 },
      se: { x: 100, y: 80, width: 230, height: 120 },
      s: { x: 100, y: 80, width: 200, height: 120 },
      sw: { x: 80, y: 80, width: 220, height: 120 },
      w: { x: 80, y: 80, width: 220, height: 100 },
    }

    for (const handle of Object.keys(expected) as ResizeHandle[]) {
      expect(unconstrained(handle, proposed).rect).toEqual(expected[handle])
    }
  })

  it("supports expansion and contraction without moving inactive edges", () => {
    expect(
      unconstrained("nw", { x: 40, y: 20, width: 260, height: 160 }).rect
    ).toEqual({ x: 40, y: 20, width: 260, height: 160 })
    expect(
      unconstrained("se", { x: 100, y: 80, width: 120, height: 40 }).rect
    ).toEqual({ x: 100, y: 80, width: 120, height: 40 })
    expect(
      unconstrained("w", { x: 160, y: -500, width: 140, height: 900 }).rect
    ).toEqual({ x: 160, y: 80, width: 140, height: 100 })
  })

  it("clamps every moving edge to the configured minimum size", () => {
    const expected: Record<ResizeHandle, TransformRect> = {
      nw: { x: 284, y: 168, width: 16, height: 12 },
      n: { x: 100, y: 168, width: 200, height: 12 },
      ne: { x: 100, y: 168, width: 16, height: 12 },
      e: { x: 100, y: 80, width: 16, height: 100 },
      se: { x: 100, y: 80, width: 16, height: 12 },
      s: { x: 100, y: 80, width: 200, height: 12 },
      sw: { x: 284, y: 80, width: 16, height: 12 },
      w: { x: 284, y: 80, width: 16, height: 100 },
    }
    const collapsed = { x: 500, y: 500, width: -500, height: -500 }

    for (const handle of Object.keys(expected) as ResizeHandle[]) {
      expect(
        unconstrained(handle, collapsed, {
          minimumSize: { width: 16, height: 12 },
        }).rect
      ).toEqual(expected[handle])
    }
  })

  it("preserves the immutable baseline ratio for every handle with Shift", () => {
    const proposed = { x: 80, y: 70, width: 250, height: 130 }
    const expected: Record<ResizeHandle, TransformRect> = {
      nw: { x: 80, y: 70, width: 220, height: 110 },
      n: { x: 90, y: 70, width: 220, height: 110 },
      ne: { x: 100, y: 65, width: 230, height: 115 },
      e: { x: 100, y: 72.5, width: 230, height: 115 },
      se: { x: 100, y: 80, width: 230, height: 115 },
      s: { x: 80, y: 80, width: 240, height: 120 },
      sw: { x: 60, y: 80, width: 240, height: 120 },
      w: { x: 80, y: 75, width: 220, height: 110 },
    }

    for (const handle of Object.keys(expected) as ResizeHandle[]) {
      const result = unconstrained(handle, proposed, {
        modifiers: { shiftKey: true },
      })
      for (const key of Object.keys(result.rect) as Array<
        keyof TransformRect
      >) {
        expect(result.rect[key]).toBeCloseTo(expected[handle][key], 8)
      }
      expect(result.rect.width / result.rect.height).toBeCloseTo(
        baseline.width / baseline.height
      )
    }
  })

  it("uses the larger minimum scale while preserving aspect ratio", () => {
    const result = unconstrained(
      "e",
      { x: 100, y: 80, width: 5, height: 100 },
      {
        modifiers: { shiftKey: true },
        minimumSize: { width: 60, height: 50 },
      }
    )

    expect(result.rect).toEqual({ x: 100, y: 105, width: 100, height: 50 })
  })

  it("resizes all eight handles around the immutable center with Alt", () => {
    const proposed = { x: 80, y: 70, width: 240, height: 120 }
    const expected: Record<ResizeHandle, TransformRect> = {
      nw: { x: 80, y: 70, width: 240, height: 120 },
      n: { x: 100, y: 70, width: 200, height: 120 },
      ne: { x: 80, y: 70, width: 240, height: 120 },
      e: { x: 80, y: 80, width: 240, height: 100 },
      se: { x: 80, y: 70, width: 240, height: 120 },
      s: { x: 100, y: 70, width: 200, height: 120 },
      sw: { x: 80, y: 70, width: 240, height: 120 },
      w: { x: 80, y: 80, width: 240, height: 100 },
    }

    for (const handle of Object.keys(expected) as ResizeHandle[]) {
      const result = unconstrained(handle, proposed, {
        modifiers: { shiftKey: false, altKey: true },
      })
      expect(result.rect).toEqual(expected[handle])
      expect(result.rect.x + result.rect.width / 2).toBe(200)
      expect(result.rect.y + result.rect.height / 2).toBe(130)
    }
  })

  it("combines Shift and Alt for every side and corner handle", () => {
    const proposed = { x: 80, y: 75, width: 240, height: 110 }
    const expected: Record<ResizeHandle, TransformRect> = {
      nw: { x: 80, y: 70, width: 240, height: 120 },
      n: { x: 90, y: 75, width: 220, height: 110 },
      ne: { x: 80, y: 70, width: 240, height: 120 },
      e: { x: 80, y: 70, width: 240, height: 120 },
      se: { x: 80, y: 70, width: 240, height: 120 },
      s: { x: 90, y: 75, width: 220, height: 110 },
      sw: { x: 80, y: 70, width: 240, height: 120 },
      w: { x: 80, y: 70, width: 240, height: 120 },
    }

    for (const handle of Object.keys(expected) as ResizeHandle[]) {
      const result = unconstrained(handle, proposed, {
        modifiers: { shiftKey: true, altKey: true },
      })
      for (const key of Object.keys(result.rect) as Array<
        keyof TransformRect
      >) {
        expect(result.rect[key]).toBeCloseTo(expected[handle][key], 8)
      }
      expect(result.rect.width / result.rect.height).toBeCloseTo(2, 8)
      expect(result.rect.x + result.rect.width / 2).toBeCloseTo(200, 8)
      expect(result.rect.y + result.rect.height / 2).toBeCloseTo(130, 8)
    }
  })

  it("clamps centered resize symmetrically for every handle", () => {
    const proposed = { x: 195, y: 127, width: 10, height: 6 }
    const expected: Record<ResizeHandle, TransformRect> = {
      nw: { x: 192, y: 124, width: 16, height: 12 },
      n: { x: 100, y: 124, width: 200, height: 12 },
      ne: { x: 192, y: 124, width: 16, height: 12 },
      e: { x: 192, y: 80, width: 16, height: 100 },
      se: { x: 192, y: 124, width: 16, height: 12 },
      s: { x: 100, y: 124, width: 200, height: 12 },
      sw: { x: 192, y: 124, width: 16, height: 12 },
      w: { x: 192, y: 80, width: 16, height: 100 },
    }

    for (const handle of Object.keys(expected) as ResizeHandle[]) {
      const result = unconstrained(handle, proposed, {
        modifiers: { shiftKey: false, altKey: true },
        minimumSize: { width: 16, height: 12 },
      })
      expect(result.rect).toEqual(expected[handle])
      expect(result.rect.x + result.rect.width / 2).toBe(200)
      expect(result.rect.y + result.rect.height / 2).toBe(130)
    }
  })

  it("snaps active edges to page and peer targets using SnapGuide values", () => {
    const pageSnap = unconstrained(
      "e",
      { x: 100, y: 80, width: 394, height: 100 },
      {
        snap: {
          enabled: true,
          page: { width: 1000, height: 800 },
          peers: [],
          basis: { kind: "axis_aligned" },
        },
      }
    )
    const peerSnap = unconstrained(
      "se",
      { x: 100, y: 80, width: 307, height: 217 },
      {
        snap: {
          enabled: true,
          page: { width: 1200, height: 900 },
          peers: [{ left: 400, top: 300, width: 120, height: 90 }],
          basis: { kind: "axis_aligned" },
        },
      }
    )

    expect(pageSnap.rect).toEqual({ x: 100, y: 80, width: 400, height: 100 })
    expect(pageSnap.guides).toEqual([{ axis: "x", value: 500, source: "page" }])
    expect(pageSnap.snap).toEqual({
      status: "evaluated",
      snappedAxes: ["x"],
    })
    expect(peerSnap.rect).toEqual({ x: 100, y: 80, width: 300, height: 220 })
    expect(peerSnap.guides).toEqual([
      { axis: "x", value: 400, source: "object" },
      { axis: "y", value: 300, source: "object" },
    ])
  })

  it("keeps page targets ahead of near-identical object targets", () => {
    const result = unconstrained(
      "e",
      { x: 100, y: 80, width: 403, height: 100 },
      {
        snap: {
          enabled: true,
          page: { width: 1000, height: 800 },
          peers: [{ left: 501, top: 300, width: 100, height: 100 }],
          basis: { kind: "axis_aligned" },
        },
      }
    )

    expect(result.rect.width).toBe(400)
    expect(result.guides).toEqual([{ axis: "x", value: 500, source: "page" }])
  })

  it("prefers an explicit guide over automatic resize targets", () => {
    const result = unconstrained(
      "e",
      { x: 100, y: 80, width: 397, height: 100 },
      {
        snap: {
          enabled: true,
          page: { width: 1000, height: 800 },
          peers: [{ left: 501, top: 300, width: 100, height: 100 }],
          targets: [{ axis: "x", value: 498, source: "guide" }],
          basis: { kind: "axis_aligned" },
        },
      }
    )

    expect(result.rect).toEqual({ x: 100, y: 80, width: 398, height: 100 })
    expect(result.guides).toEqual([{ axis: "x", value: 498, source: "guide" }])
    expect(result.latch).toEqual({
      x: { value: 498, source: "guide" },
    })
  })

  it("preserves aspect ratio when the active edge snaps", () => {
    const result = unconstrained(
      "e",
      { x: 100, y: 80, width: 295, height: 100 },
      {
        modifiers: { shiftKey: true },
        snap: {
          enabled: true,
          page: { width: 1200, height: 900 },
          peers: [{ left: 400, top: 500, width: 100, height: 100 }],
          basis: { kind: "axis_aligned" },
        },
      }
    )

    expect(result.rect).toEqual({ x: 100, y: 55, width: 300, height: 150 })
    expect(result.guides).toEqual([{ axis: "x", value: 400, source: "object" }])
  })

  it("mirrors centered snap corrections and Shift sizing around the center", () => {
    const centered = unconstrained(
      "e",
      { x: 80, y: 80, width: 314, height: 100 },
      {
        modifiers: { shiftKey: false, altKey: true },
        snap: {
          enabled: true,
          page: { width: 800, height: 600 },
          peers: [],
          basis: { kind: "axis_aligned" },
        },
      }
    )
    const proportional = unconstrained(
      "e",
      { x: 80, y: 80, width: 314, height: 100 },
      {
        modifiers: { shiftKey: true, altKey: true },
        snap: {
          enabled: true,
          page: { width: 800, height: 600 },
          peers: [],
          basis: { kind: "axis_aligned" },
        },
      }
    )

    expect(centered.rect).toEqual({ x: 0, y: 80, width: 400, height: 100 })
    expect(proportional.rect).toEqual({ x: 0, y: 30, width: 400, height: 200 })
    for (const result of [centered, proportional]) {
      expect(result.rect.x + result.rect.width / 2).toBe(200)
      expect(result.rect.y + result.rect.height / 2).toBe(130)
      expect(result.guides).toEqual([{ axis: "x", value: 400, source: "page" }])
    }
  })

  it("holds and releases resize snap latches independently per axis", () => {
    const snap = {
      enabled: true,
      page: { width: 800, height: 600 },
      peers: [],
      basis: { kind: "axis_aligned" as const },
      screenThreshold: { acquirePixels: 8, releasePixels: 12, zoom: 1 },
    }
    const acquired = unconstrained(
      "se",
      { x: 100, y: 80, width: 294, height: 216 },
      { snap }
    )
    const partlyHeld = unconstrained(
      "se",
      { x: 100, y: 80, width: 310, height: 234 },
      { snap: { ...snap, previousLatch: acquired.latch } }
    )
    const released = unconstrained(
      "se",
      { x: 100, y: 80, width: 313, height: 234 },
      { snap: { ...snap, previousLatch: partlyHeld.latch } }
    )

    expect(acquired.latch).toEqual({
      x: { value: 400, source: "page" },
      y: { value: 300, source: "page" },
    })
    expect(partlyHeld.rect).toEqual({
      x: 100,
      y: 80,
      width: 300,
      height: 234,
    })
    expect(partlyHeld.latch).toEqual({
      x: { value: 400, source: "page" },
    })
    expect(partlyHeld.guides).toEqual([
      { axis: "x", value: 400, source: "page" },
    ])
    expect(released.latch).toBeNull()
    expect(released.guides).toEqual([])
  })

  it("converts screen-pixel snap thresholds through the supplied zoom", () => {
    const snap = {
      enabled: true,
      page: { width: 800, height: 600 },
      peers: [],
      basis: { kind: "axis_aligned" as const },
      screenThreshold: { acquirePixels: 8, releasePixels: 12, zoom: 2 },
    }
    const outside = unconstrained(
      "e",
      { x: 100, y: 80, width: 295, height: 100 },
      { snap }
    )
    const inside = unconstrained(
      "e",
      { x: 100, y: 80, width: 297, height: 100 },
      { snap }
    )

    expect(outside.rect.width).toBe(295)
    expect(outside.latch).toBeNull()
    expect(inside.rect.width).toBe(300)
    expect(inside.latch).toEqual({
      x: { value: 400, source: "page" },
    })
  })

  it("rejects inverted resize snap hysteresis", () => {
    expect(() =>
      unconstrained(
        "e",
        { x: 100, y: 80, width: 297, height: 100 },
        {
          snap: {
            enabled: true,
            page: { width: 800, height: 600 },
            peers: [],
            basis: { kind: "axis_aligned" },
            screenThreshold: {
              acquirePixels: 8,
              releasePixels: 7,
              zoom: 1,
            },
          },
        }
      )
    ).toThrow(/release threshold/i)
  })

  it("does not claim a snap that the minimum-size clamp cannot honor", () => {
    const result = unconstrained(
      "w",
      { x: 297, y: 80, width: 3, height: 100 },
      {
        minimumSize: { width: 16, height: 12 },
        snap: {
          enabled: true,
          page: { width: 600, height: 400 },
          peers: [{ left: 300, top: 300, width: 100, height: 50 }],
          basis: { kind: "axis_aligned" },
        },
      }
    )

    expect(result.rect).toEqual({ x: 284, y: 80, width: 16, height: 100 })
    expect(result.guides).toEqual([])
    expect(result.snap).toEqual({ status: "evaluated", snappedAxes: [] })
  })

  it("returns explicit disabled and non-axis-aligned decisions", () => {
    const proposed = { x: 80, y: 70, width: 250, height: 130 }
    const disabled = unconstrained("nw", proposed, {
      snap: {
        enabled: false,
        page: { width: 1000, height: 800 },
        peers: [],
        basis: { kind: "axis_aligned" },
      },
    })
    const rotatedNode = unconstrained("nw", proposed, {
      snap: {
        enabled: true,
        page: { width: 1000, height: 800 },
        peers: [],
        basis: { kind: "non_axis_aligned", source: "node" },
      },
    })
    const rotatedAncestor = unconstrained("nw", proposed, {
      snap: {
        enabled: true,
        page: { width: 1000, height: 800 },
        peers: [],
        basis: { kind: "non_axis_aligned", source: "ancestor" },
      },
    })

    expect(disabled.snap).toEqual({ status: "disabled" })
    expect(rotatedNode.snap).toEqual({
      status: "declined",
      reason: "non_axis_aligned",
      source: "node",
    })
    expect(rotatedAncestor.snap).toEqual({
      status: "declined",
      reason: "non_axis_aligned",
      source: "ancestor",
    })
    expect(disabled.guides).toEqual([])
    expect(rotatedNode.guides).toEqual([])
    expect(rotatedAncestor.guides).toEqual([])
  })

  it("returns finite geometry for extreme proposed values and never mutates input", () => {
    const input: ResizeConstraintInput = {
      baseline,
      proposed: {
        x: -Number.MAX_VALUE,
        y: Number.POSITIVE_INFINITY,
        width: Number.MAX_VALUE,
        height: Number.NaN,
      },
      handle: "nw",
      modifiers: { shiftKey: true },
      minimumSize: { width: 8, height: 8 },
    }
    const snapshot = structuredClone(input)
    const result = applyResizeConstraint(input)

    expect(Object.values(result.rect).every(Number.isFinite)).toBe(true)
    expect(result.rect.width).toBeGreaterThanOrEqual(8)
    expect(result.rect.height).toBeGreaterThanOrEqual(8)
    expect(input).toEqual(snapshot)
  })
})

describe("rotation snapping", () => {
  it("snaps positive, negative, and wrapped angles to 15-degree increments", () => {
    for (const [proposedAngle, expected] of [
      [1.8, 0],
      [13, 15],
      [29, 30],
      [-14, -15],
      [179, -180],
      [361, 0],
    ] as const) {
      const result = snapRotation({ proposedAngle, enabled: true })
      expect(result.angle).toBe(expected)
      expect(result.snap).toEqual({ status: "acquired", angle: expected })
      expect(result.latch).toEqual({ angle: expected })
    }
  })

  it("leaves angles outside the acquire threshold free", () => {
    expect(snapRotation({ proposedAngle: 11, enabled: true })).toEqual({
      angle: 11,
      latch: null,
      snap: { status: "free" },
    })
  })

  it("holds a latched angle through a wider release threshold", () => {
    const acquired = snapRotation({ proposedAngle: 13, enabled: true })
    const held = snapRotation({
      proposedAngle: 19,
      enabled: true,
      previousLatch: acquired.latch,
    })
    const released = snapRotation({
      proposedAngle: 21,
      enabled: true,
      previousLatch: held.latch,
    })

    expect(held).toEqual({
      angle: 15,
      latch: { angle: 15 },
      snap: { status: "held", angle: 15 },
    })
    expect(released).toEqual({
      angle: 21,
      latch: null,
      snap: { status: "free" },
    })
  })

  it("normalizes without snapping and clears a stale latch when disabled", () => {
    expect(
      snapRotation({
        proposedAngle: 370,
        enabled: false,
        previousLatch: { angle: 15 },
      })
    ).toEqual({
      angle: 10,
      latch: null,
      snap: { status: "disabled" },
    })
    expect(normalizeRotation(-540)).toBe(-180)
  })

  it("supports a custom interval and rejects invalid hysteresis", () => {
    expect(
      snapRotation({
        proposedAngle: 43,
        enabled: true,
        interval: 45,
        threshold: 3,
        releaseThreshold: 6,
      }).angle
    ).toBe(45)
    expect(() =>
      snapRotation({
        proposedAngle: 10,
        enabled: true,
        threshold: 5,
        releaseThreshold: 4,
      })
    ).toThrow(/release threshold/i)
  })
})
