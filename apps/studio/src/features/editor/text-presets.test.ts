import { describe, expect, it } from "vitest"
import { applyQuotationTemplate, quotationTemplates } from "@webmcp/document"
import type { Page } from "@webmcp/document"
import { quotationStarter } from "./quotation-starter"
import {
  createStudioTextNode,
  defaultStudioTextPresetId,
  studioTextPresetIds,
  studioTextPresets,
  textColorForPageBackground,
  textPresetPlacement,
} from "./text-presets"

const page = {
  id: "page",
  outputId: "output",
  name: "Page",
  width: 1240,
  height: 1754,
  background: "#ffffff",
  nodeIds: [],
} satisfies Page

describe("Studio text presets", () => {
  it("provides a content-first hierarchy with a documented shortcut default", () => {
    expect(studioTextPresetIds).toEqual([
      "heading",
      "subheading",
      "body",
      "caption",
    ])
    expect(studioTextPresets.map((preset) => preset.name)).toEqual([
      "Heading",
      "Subheading",
      "Body",
      "Caption",
    ])
    expect(defaultStudioTextPresetId).toBe("body")
    expect(
      studioTextPresets.every(
        (preset) =>
          preset.sample.startsWith("Add ") &&
          !preset.sample.toLocaleLowerCase().includes("double-click")
      )
    ).toBe(true)
  })

  it("places every preset inside portrait, square, and compact pages", () => {
    const pages = [
      page,
      { ...page, width: 1080, height: 1080 },
      { ...page, width: 320, height: 568 },
    ]
    for (const candidate of pages) {
      for (const presetId of studioTextPresetIds) {
        const placement = textPresetPlacement(candidate, presetId)
        expect(placement.x).toBeGreaterThanOrEqual(0)
        expect(placement.y).toBeGreaterThanOrEqual(0)
        expect(placement.x + placement.width).toBeLessThanOrEqual(
          candidate.width
        )
        expect(placement.y + placement.height).toBeLessThanOrEqual(
          candidate.height
        )
        expect(placement.fontSize).toBeGreaterThanOrEqual(
          placement.preset.minFontSize
        )
        expect(placement.fontSize).toBeLessThanOrEqual(
          placement.preset.maxFontSize
        )
      }
    }
  })

  it("creates typed text nodes whose geometry follows their sizing policy", () => {
    const heading = createStudioTextNode(page, "heading", "heading-id")
    const caption = createStudioTextNode(page, "caption", "caption-id")

    expect(heading).toMatchObject({
      id: "heading-id",
      type: "text",
      name: "Heading",
      text: "Add a heading",
      sizingMode: "auto_height",
    })
    expect(heading.height).toBeCloseTo(heading.fontSize * heading.lineHeight, 0)
    expect(caption).toMatchObject({
      id: "caption-id",
      type: "text",
      name: "Caption",
      text: "Add a caption",
      sizingMode: "auto_width",
    })
    expect(caption.width).toBeLessThan(
      textPresetPlacement(page, "caption").width
    )
    expect(caption.x).toBe(Math.round((page.width - caption.width) / 2))
    expect(caption.y).toBe(Math.round((page.height - caption.height) / 2))
  })

  it("chooses readable preset text for light and dark page backgrounds", () => {
    expect(textColorForPageBackground("#ffffff")).toBe("#18181b")
    expect(textColorForPageBackground("#11171d")).toBe("#fafafa")
    expect(textColorForPageBackground("#fff")).toBe("#18181b")
    expect(textColorForPageBackground("#f3efe6", ["#1f2923"])).toBe("#1f2923")
    expect(textColorForPageBackground("#11171d", ["#18181b", "#f5f1e9"])).toBe(
      "#f5f1e9"
    )
    expect(textColorForPageBackground("var(--page-background)")).toBe("#18181b")

    expect(
      createStudioTextNode(
        { ...page, background: "#11171d" },
        "heading",
        "dark-heading"
      ).color
    ).toBe("#fafafa")
  })

  it("inherits the active quotation ink token so later theme changes remap it", () => {
    const source = structuredClone(quotationStarter.document)
    const sourcePage = source.pages[0]
    const olive = quotationTemplates.find(
      (template) => template.id === "editorial-olive"
    )!
    const midnight = quotationTemplates.find(
      (template) => template.id === "midnight-film"
    )!
    const node = createStudioTextNode(sourcePage, "heading", "added-heading", {
      preferredColors: [olive.palette.ink],
    })
    const withAddedHeading = {
      ...source,
      nodes: [...source.nodes, node],
      pages: source.pages.map((candidate) =>
        candidate.id === sourcePage.id
          ? { ...candidate, nodeIds: [...candidate.nodeIds, node.id] }
          : candidate
      ),
    }

    const themed = applyQuotationTemplate(
      withAddedHeading,
      "editorial-olive",
      "midnight-film",
      { now: "2026-08-28T00:00:00.000Z" }
    )
    const themedNode = themed.nodes.find(
      (candidate) => candidate.id === node.id
    )
    expect(themedNode?.type === "text" ? themedNode.color : null).toBe(
      midnight.palette.ink
    )
  })
})
