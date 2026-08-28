import { describe, expect, it } from "vitest"
import { projectVisibleGuideSnapTargets } from "./guide-snap-targets"

describe("guide snap target projection", () => {
  const coverGuides = [
    { id: "cover-x", axis: "x" as const, position: 120 },
    { id: "cover-y", axis: "y" as const, position: 240 },
  ]

  it("projects only the active page guide input supplied by the workspace", () => {
    expect(projectVisibleGuideSnapTargets(coverGuides, true)).toEqual([
      { axis: "x", value: 120, source: "guide" },
      { axis: "y", value: 240, source: "guide" },
    ])
    expect(
      projectVisibleGuideSnapTargets(
        [{ id: "details-x", axis: "x", position: 360 }],
        true
      )
    ).toEqual([{ axis: "x", value: 360, source: "guide" }])
  })

  it("retains persisted guides while removing every hidden snap target", () => {
    expect(projectVisibleGuideSnapTargets(coverGuides, false)).toEqual([])
    expect(coverGuides).toHaveLength(2)
  })
})
