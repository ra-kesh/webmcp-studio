import { describe, expect, it } from "vitest"
import { calculateSnap } from "../src/snapping"

describe("canvas snapping", () => {
  it("snaps object centers to the page center", () => {
    const result = calculateSnap(
      { left: 447, top: 123, width: 100, height: 80 },
      { width: 1000, height: 800 },
      []
    )

    expect(result.deltaX).toBe(3)
    expect(result.guides).toContainEqual({
      axis: "x",
      value: 500,
      source: "page",
    })
  })

  it("snaps edges and centers to neighboring objects", () => {
    const result = calculateSnap(
      { left: 293, top: 407, width: 100, height: 80 },
      { width: 1200, height: 1000 },
      [{ left: 100, top: 200, width: 200, height: 250 }]
    )

    expect(result.deltaX).toBe(7)
    expect(result.deltaY).toBe(3)
    expect(result.guides).toEqual([
      { axis: "x", value: 300, source: "object" },
      { axis: "y", value: 450, source: "object" },
    ])
  })

  it("does not pull objects outside the snap threshold", () => {
    const result = calculateSnap(
      { left: 120, top: 140, width: 100, height: 80 },
      { width: 1000, height: 800 },
      []
    )

    expect(result).toEqual({
      deltaX: 0,
      deltaY: 0,
      guides: [],
      latch: null,
    })
  })

  it("gives page geometry a small priority over near-identical object guides", () => {
    const result = calculateSnap(
      { left: 451.4, top: 100, width: 100, height: 80 },
      { width: 1000, height: 800 },
      [{ left: 501.4, top: 300, width: 200, height: 100 }]
    )

    expect(result.deltaX).toBeCloseTo(-1.4)
    expect(result.guides[0]).toEqual({
      axis: "x",
      value: 500,
      source: "page",
    })
  })

  it("snaps an object to equal horizontal spacing between two peers", () => {
    const result = calculateSnap(
      { left: 294, top: 100, width: 100, height: 80 },
      { width: 1200, height: 1000 },
      [
        { left: 100, top: 100, width: 100, height: 80 },
        { left: 500, top: 100, width: 100, height: 80 },
      ]
    )

    expect(result.deltaX).toBe(6)
    expect(result.guides).toContainEqual({
      axis: "x",
      source: "spacing",
      gap: 100,
      spans: [
        { start: 200, end: 300, cross: 78 },
        { start: 400, end: 500, cross: 78 },
      ],
    })
  })

  it("extends an existing horizontal rhythm after the last peer", () => {
    const result = calculateSnap(
      { left: 394, top: 100, width: 100, height: 80 },
      { width: 1200, height: 1000 },
      [
        { left: 100, top: 100, width: 100, height: 80 },
        { left: 250, top: 100, width: 100, height: 80 },
      ]
    )

    expect(result.deltaX).toBe(6)
    expect(result.guides).toContainEqual({
      axis: "x",
      source: "spacing",
      gap: 50,
      spans: [
        { start: 200, end: 250, cross: 78 },
        { start: 350, end: 400, cross: 78 },
      ],
    })
  })

  it("snaps an object to equal vertical spacing", () => {
    const result = calculateSnap(
      { left: 100, top: 294, width: 80, height: 100 },
      { width: 1000, height: 1200 },
      [
        { left: 100, top: 100, width: 80, height: 100 },
        { left: 100, top: 500, width: 80, height: 100 },
      ]
    )

    expect(result.deltaY).toBe(6)
    expect(result.guides).toContainEqual({
      axis: "y",
      source: "spacing",
      gap: 100,
      spans: [
        { start: 200, end: 300, cross: 78 },
        { start: 400, end: 500, cross: 78 },
      ],
    })
  })

  it("does not offer spacing guides across unrelated rows", () => {
    const result = calculateSnap(
      { left: 294, top: 500, width: 100, height: 80 },
      { width: 1200, height: 1000 },
      [
        { left: 100, top: 100, width: 100, height: 80 },
        { left: 500, top: 100, width: 100, height: 80 },
      ]
    )

    expect(result.guides).not.toContainEqual(
      expect.objectContaining({ source: "spacing" })
    )
  })

  it("prefers an explicit guide over automatic geometry at equal distance", () => {
    const result = calculateSnap(
      { left: 493, top: 100, width: 100, height: 80 },
      { width: 1000, height: 800 },
      [],
      { targets: [{ axis: "x", value: 500, source: "guide" }] }
    )

    expect(result.deltaX).toBe(7)
    expect(result.guides).toContainEqual({
      axis: "x",
      value: 500,
      source: "guide",
    })
    expect(result.latch?.x).toEqual({ source: "guide", value: 500 })
  })

  it("converts acquire distance from screen pixels at every zoom", () => {
    const moving = { left: 97, top: 100, width: 20, height: 20 }
    const page = { width: 1000, height: 800 }
    const targets = [
      { axis: "x" as const, value: 100, source: "guide" as const },
    ]

    expect(
      calculateSnap(moving, page, [], {
        targets,
        screenThreshold: { acquirePixels: 8, releasePixels: 12, zoom: 4 },
      }).deltaX
    ).toBe(0)
    expect(
      calculateSnap(moving, page, [], {
        targets,
        screenThreshold: { acquirePixels: 8, releasePixels: 12, zoom: 0.1 },
      }).deltaX
    ).toBe(3)
  })

  it("holds an acquired guide until the wider release threshold", () => {
    const page = { width: 1000, height: 800 }
    const targets = [
      { axis: "x" as const, value: 100, source: "guide" as const },
    ]
    const acquired = calculateSnap(
      { left: 97, top: 100, width: 20, height: 20 },
      page,
      [],
      {
        targets,
        screenThreshold: { acquirePixels: 8, releasePixels: 12, zoom: 1 },
      }
    )
    const held = calculateSnap(
      { left: 109, top: 100, width: 20, height: 20 },
      page,
      [],
      {
        targets,
        previousLatch: acquired.latch,
        screenThreshold: { acquirePixels: 8, releasePixels: 12, zoom: 1 },
      }
    )
    const released = calculateSnap(
      { left: 113, top: 100, width: 20, height: 20 },
      page,
      [],
      {
        targets,
        previousLatch: held.latch,
        screenThreshold: { acquirePixels: 8, releasePixels: 12, zoom: 1 },
      }
    )

    expect(acquired.latch?.x).toEqual({ source: "guide", value: 100 })
    expect(held.deltaX).toBe(-9)
    expect(held.latch?.x).toEqual({ source: "guide", value: 100 })
    expect(released.deltaX).toBe(0)
    expect(released.latch?.x).toBeUndefined()
  })

  it("latches equal-spacing results by their target start", () => {
    const result = calculateSnap(
      { left: 294, top: 100, width: 100, height: 80 },
      { width: 1200, height: 1000 },
      [
        { left: 100, top: 100, width: 100, height: 80 },
        { left: 500, top: 100, width: 100, height: 80 },
      ]
    )

    expect(result.latch?.x).toEqual({ source: "spacing", value: 300 })
  })
})
