import { describe, expect, it } from "vitest"
import type { Document, StudioDesignIntent } from "@webmcp/document"
import {
  analyzeGeneratedCandidatePage,
  type GeneratedCandidatePixelAnalysis,
} from "../src/generation-inspection"

const pageId = "page-1"
const titleId = "title-1"

const candidate = (opacity = 1) =>
  ({
    pages: [
      {
        id: pageId,
        name: "Poster",
        width: 1000,
        height: 1000,
        background: "#FFFFFF",
        nodeIds: [titleId],
      },
    ],
    nodes: [
      {
        id: titleId,
        type: "text",
        name: "Title",
        x: 100,
        y: 100,
        width: 600,
        height: 180,
        rotation: 0,
        opacity,
        visible: true,
        locked: false,
        text: "Turn Slowly",
        color: "#111111",
        fontFamily: "Inter Variable",
        fontSize: 120,
        fontWeight: 700,
        lineHeight: 1,
      },
    ],
  }) as unknown as Document

const intent = (): StudioDesignIntent["pages"][number] => ({
  pageId,
  focalNodeIds: [titleId],
  releaseZones: [],
  inkRoles: [
    { role: "background", color: "#FFFFFF" },
    { role: "primary", color: "#111111" },
  ],
  requiredText: ["Turn Slowly"],
  targetTypographyRatio: undefined,
})

const pixels = ({
  nodePasses = true,
  primaryPasses = true,
}: {
  nodePasses?: boolean
  primaryPasses?: boolean
} = {}): GeneratedCandidatePixelAnalysis => ({
  source: "canonical-thumbnail-pixels",
  width: 320,
  height: 320,
  backgroundEstimate: "#FFFFFF",
  foregroundPixelRatio: nodePasses ? 0.1 : 0,
  highKeyPixelRatio: 0.9,
  darkPixelRatio: nodePasses ? 0.1 : 0,
  meanLuminance: 0.9,
  luminanceDeviation: 0.2,
  foregroundCentroid: nodePasses ? { x: 0.4, y: 0.2 } : null,
  edgeInkRatios: { top: 0, right: 0, bottom: 0, left: 0 },
  dominantInkColors: primaryPasses ? [{ color: "#111111", ratio: 1 }] : [],
  renderedNodeEvidence: [
    {
      nodeId: titleId,
      inkPixels: nodePasses ? 100 : 0,
      totalPixels: 1000,
      inkRatio: nodePasses ? 0.1 : 0,
      passes: nodePasses,
    },
  ],
  renderedInkRoles: [
    {
      role: "background",
      color: "#FFFFFF",
      matchingPixels: 90_000,
      pixelRatio: 0.9,
      passes: true,
    },
    {
      role: "primary",
      color: "#111111",
      matchingPixels: primaryPasses ? 100 : 0,
      pixelRatio: primaryPasses ? 0.001 : 0,
      passes: primaryPasses,
    },
  ],
  releaseZones: [],
})

describe("generated candidate rendered inspection", () => {
  it("rejects transparent focal and required-text layers", () => {
    const report = analyzeGeneratedCandidatePage(
      candidate(0),
      pageId,
      intent(),
      pixels({ nodePasses: false, primaryPasses: false })
    )

    expect(report.designIntent.passes).toBe(false)
    expect(report.designIntent.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "focal_layer", passes: false }),
        expect.objectContaining({ kind: "required_text", passes: false }),
        expect.objectContaining({
          kind: "ink_role",
          target: "primary",
          passes: false,
        }),
      ])
    )
  })

  it("requires pixel evidence for required text and declared ink colors", () => {
    const report = analyzeGeneratedCandidatePage(
      candidate(),
      pageId,
      intent(),
      pixels({ nodePasses: false, primaryPasses: false })
    )

    expect(report.designIntent.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "required_text", passes: false }),
        expect.objectContaining({
          kind: "ink_role",
          target: "primary",
          passes: false,
        }),
      ])
    )
  })

  it("rejects a declared manifest containing zero checks", () => {
    const report = analyzeGeneratedCandidatePage(
      candidate(),
      pageId,
      {
        pageId,
        focalNodeIds: [],
        releaseZones: [],
        inkRoles: [],
        requiredText: [],
      },
      pixels()
    )

    expect(report.designIntent).toEqual({
      declared: true,
      passes: false,
      checks: [],
    })
  })

  it("passes when each declared check has rendered evidence", () => {
    const report = analyzeGeneratedCandidatePage(
      candidate(),
      pageId,
      intent(),
      pixels()
    )

    expect(report.designIntent.passes).toBe(true)
    expect(report.designIntent.checks.every((check) => check.passes)).toBe(true)
  })
})
