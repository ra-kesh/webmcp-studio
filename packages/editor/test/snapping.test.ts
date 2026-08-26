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

    expect(result).toEqual({ deltaX: 0, deltaY: 0, guides: [] })
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
})
