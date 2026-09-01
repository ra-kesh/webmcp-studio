import { describe, expect, it } from "vitest"
import {
  documentSchema,
  frameLayoutGridSchema,
  frameLayoutGridsSchema,
  northstarSeed,
  projectFrameLayoutGridLines,
  projectFrameLayoutGridSections,
  scaleFrameLayoutGrid,
} from "../src"

describe("frame layout grids", () => {
  it("strictly admits bounded column, row, and square-grid metadata", () => {
    expect(
      frameLayoutGridSchema.parse({
        id: "columns",
        pattern: "columns",
        alignment: "stretch",
        count: 12,
        sectionSize: 1,
        gutter: 16,
      })
    ).toMatchObject({
      visible: true,
      color: "#2563eb",
      opacity: 0.12,
      offset: 0,
    })
    expect(() =>
      frameLayoutGridSchema.parse({
        id: "too-many",
        pattern: "rows",
        alignment: "stretch",
        count: 65,
        sectionSize: 1,
        gutter: 0,
      })
    ).toThrow()
    expect(() =>
      frameLayoutGridsSchema.parse([
        { id: "duplicate", pattern: "grid", size: 8 },
        { id: "duplicate", pattern: "grid", size: 16 },
      ])
    ).toThrow("Frame layout guide IDs must be unique")
    expect(() =>
      frameLayoutGridSchema.parse({
        id: "unknown",
        pattern: "grid",
        size: 8,
        rendererProperty: true,
      })
    ).toThrow()
  })

  it("projects stretch bands and bounded square-grid lines in frame space", () => {
    const columns = frameLayoutGridSchema.parse({
      id: "columns",
      pattern: "columns",
      visible: true,
      color: "#ff0000",
      opacity: 0.2,
      alignment: "stretch",
      count: 2,
      offset: 10,
      sectionSize: 1,
      gutter: 20,
    })
    expect(
      projectFrameLayoutGridSections({ width: 200, height: 100 }, columns)
    ).toEqual([
      { axis: "x", start: 10, end: 90 },
      { axis: "x", start: 110, end: 190 },
    ])

    const grid = frameLayoutGridSchema.parse({
      id: "square",
      pattern: "grid",
      visible: true,
      color: "#00ff00",
      opacity: 0.2,
      offset: 5,
      size: 10,
    })
    expect(
      projectFrameLayoutGridLines({ width: 25, height: 15 }, grid)
    ).toEqual([
      { axis: "x", position: 5 },
      { axis: "x", position: 15 },
      { axis: "x", position: 25 },
      { axis: "y", position: 5 },
      { axis: "y", position: 15 },
    ])
  })

  it("scales spatial metadata without changing counts or visual settings", () => {
    const columns = frameLayoutGridSchema.parse({
      id: "columns",
      pattern: "columns",
      visible: false,
      color: "#123456",
      opacity: 0.4,
      alignment: "center",
      count: 4,
      offset: 12,
      sectionSize: 40,
      gutter: 8,
    })
    expect(scaleFrameLayoutGrid(columns, 0.5)).toEqual({
      ...columns,
      offset: 6,
      sectionSize: 20,
      gutter: 4,
    })
  })

  it("round-trips guide metadata through canonical document persistence", () => {
    const source = structuredClone(northstarSeed)
    source.pages[0]!.nodeIds.unshift("frame")
    source.nodes.push({
      id: "frame",
      type: "frame",
      name: "Frame",
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      constraints: { horizontal: "min", vertical: "min" },
      fill: "#ffffff",
      radius: 0,
      strokeWidth: 0,
      children: [],
      autoLayout: null,
      clipsContent: false,
      layoutGrids: [
        {
          id: "grid",
          pattern: "grid",
          visible: true,
          color: "#2563eb",
          opacity: 0.12,
          offset: 0,
          size: 8,
        },
      ],
    })
    const document = documentSchema.parse(source)
    const restored = documentSchema.parse(JSON.parse(JSON.stringify(document)))
    expect(
      restored.nodes.find((node) => node.type === "frame")?.layoutGrids
    ).toEqual([
      {
        id: "grid",
        pattern: "grid",
        visible: true,
        color: "#2563eb",
        opacity: 0.12,
        offset: 0,
        size: 8,
      },
    ])
  })
})
