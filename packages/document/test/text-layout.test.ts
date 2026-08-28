import { describe, expect, it } from "vitest"
import {
  applyCommand,
  applyTextLayoutPatch,
  deriveTextGeometryPatch,
  documentSchema,
  northstarSeed,
  projectTextLayout,
  projectTextLayoutAfterPatch,
  repairTextOverflowPatch,
  type TextNode,
} from "../src"

const textNode = (patch: Partial<TextNode> = {}): TextNode => ({
  id: "text-layout-fixture",
  type: "text",
  name: "Text layout fixture",
  x: 0,
  y: 0,
  width: 120,
  height: 20,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  text: "Hello world from Studio",
  color: "#111111",
  fontFamily: "Geist Variable",
  fontSize: 20,
  fontWeight: 400,
  lineHeight: 1.2,
  letterSpacing: 0,
  align: "left",
  sizingMode: "fixed",
  ...patch,
})

describe("canonical text layout", () => {
  it("migrates pre-sizing-mode documents to fixed without changing geometry", () => {
    const legacy = structuredClone(northstarSeed) as unknown as {
      nodes: Array<Record<string, unknown>>
    }
    for (const node of legacy.nodes) {
      if (node.type === "text") delete node.sizingMode
    }

    const parsed = documentSchema.parse(legacy)
    const originalText = northstarSeed.nodes.find(
      (node) => node.type === "text"
    )!
    const parsedText = parsed.nodes.find((node) => node.id === originalText.id)!

    expect(parsedText).toMatchObject({
      width: originalText.width,
      height: originalText.height,
      sizingMode: "fixed",
    })
  })

  it("projects managed-font wrapping and preserves explicit whitespace", () => {
    const projection = projectTextLayout(
      textNode({
        text: "Hello   world\nA deliberately-long-token",
        width: 100,
        height: 200,
        sizingMode: "auto_height",
      })
    )

    expect(projection.lines.length).toBeGreaterThan(2)
    expect(projection.measurement).toBe("managed_font_approximation_v1")
    expect(projection.displayText).toContain("Hello   ")
    expect(projection.displayText).toContain("\n")
    expect(projection.requiredWidth).toBeLessThanOrEqual(100)
    expect(projection.requiredHeight).toBe(
      projection.lineCount * projection.lineHeightPx
    )
  })

  it("keeps a soft-wrap delimiter off the beginning of the next line", () => {
    const text = "Hello world from Studio"
    const base = textNode({ text })
    const wordBoundaryWidth =
      projectTextLayout({
        ...base,
        text: "Hello world",
        sizingMode: "auto_width",
      }).intrinsicWidth + 0.1
    const projection = projectTextLayout({
      ...base,
      width: wordBoundaryWidth,
      height: 200,
      sizingMode: "auto_height",
    })

    expect(projection.lineCount).toBeGreaterThan(1)
    expect(
      projection.lines.slice(1).every((line) => !line.text.startsWith(" "))
    ).toBe(true)
    expect(projection.displayText.replaceAll("\n", "")).toBe(text)
    expect(projection.requiredWidth).toBeLessThanOrEqual(wordBoundaryWidth)
  })

  it("derives width and height together for auto-width text", () => {
    const node = textNode({ sizingMode: "auto_width" })
    const patch = deriveTextGeometryPatch(node, {
      text: "A much longer heading",
      fontSize: 32,
      letterSpacing: 1.5,
    })
    const next = applyTextLayoutPatch(node, {
      text: "A much longer heading",
      fontSize: 32,
      letterSpacing: 1.5,
    })

    expect(patch.width).toBeGreaterThan(node.width)
    expect(patch.height).toBe(38.4)
    expect(next).toMatchObject(patch)
    expect(projectTextLayout(next).lineCount).toBe(1)
  })

  it("keeps width and derives height for auto-height text", () => {
    const node = textNode({ sizingMode: "auto_height", height: 24 })
    const wider = projectTextLayoutAfterPatch(node, { width: 260 })
    const narrower = projectTextLayoutAfterPatch(node, { width: 80 })
    const next = applyTextLayoutPatch(node, {
      width: 80,
      text: "Hello world from Studio with more copy",
    })

    expect(narrower.lineCount).toBeGreaterThan(wider.lineCount)
    expect(next.width).toBe(80)
    expect(next.height).toBe(projectTextLayout(next).requiredHeight)
  })

  it("rejects manual managed-axis geometry by reasserting derived size", () => {
    const autoHeight = textNode({
      sizingMode: "auto_height",
      width: 120,
      height: 48,
    })
    const autoWidth = textNode({
      sizingMode: "auto_width",
      width: 222.4,
      height: 24,
    })

    const heightPatched = applyTextLayoutPatch(autoHeight, { height: 999 })
    const bothPatched = applyTextLayoutPatch(autoWidth, {
      width: 999,
      height: 999,
    })

    expect(heightPatched.height).toBe(
      projectTextLayout(heightPatched).requiredHeight
    )
    expect(heightPatched.height).not.toBe(999)
    expect(bothPatched.width).toBe(
      projectTextLayout(bothPatched).intrinsicWidth
    )
    expect(bothPatched.height).toBe(
      projectTextLayout(bothPatched).requiredHeight
    )
    expect(bothPatched).not.toMatchObject({ width: 999, height: 999 })

    const source = northstarSeed.nodes.find(
      (node): node is TextNode => node.type === "text"
    )!
    const prepared = applyCommand(northstarSeed, {
      id: "managed-height-mode",
      type: "update_node",
      actor: "api",
      at: "2026-08-28T00:40:00.000Z",
      nodeId: source.id,
      patch: { sizingMode: "auto_height" },
    })
    const rejectedManualHeight = applyCommand(prepared, {
      id: "managed-height-write",
      type: "update_node",
      actor: "api",
      at: "2026-08-28T00:41:00.000Z",
      nodeId: source.id,
      patch: { height: 999 },
    })
    const commandText = rejectedManualHeight.nodes.find(
      (node): node is TextNode => node.id === source.id && node.type === "text"
    )!
    expect(commandText.height).toBe(
      projectTextLayout(commandText).requiredHeight
    )
    expect(commandText.height).not.toBe(999)
  })

  it("preserves fixed geometry and exposes both overflow axes", () => {
    const node = textNode({
      text: "WWWWWWWWWWWW",
      width: 8,
      height: 8,
      fontSize: 32,
      sizingMode: "fixed",
    })
    const layout = projectTextLayout(node)
    const next = applyTextLayoutPatch(node, { text: `${node.text} more` })

    expect(layout).toMatchObject({
      overflow: true,
      overflowX: true,
      overflowY: true,
    })
    expect(next).toMatchObject({ width: 8, height: 8 })
    expect(repairTextOverflowPatch(node)).toMatchObject({
      sizingMode: "auto_width",
      width: expect.any(Number),
      height: expect.any(Number),
    })
  })

  it("repairs vertical-only overflow without changing the wrapping width", () => {
    const node = textNode({
      text: "A short line",
      width: 300,
      height: 1,
      sizingMode: "fixed",
    })
    expect(projectTextLayout(node)).toMatchObject({
      overflowX: false,
      overflowY: true,
    })
    expect(repairTextOverflowPatch(node)).toMatchObject({
      sizingMode: "auto_height",
      height: expect.any(Number),
    })
    expect(repairTextOverflowPatch(node)).not.toHaveProperty("width")
  })

  it("does not derive geometry for paint-only changes or fitting fixed text", () => {
    const node = textNode({ height: 120 })
    expect(deriveTextGeometryPatch(node, { color: "#ffffff" })).toEqual({})
    expect(repairTextOverflowPatch(node)).toEqual({})
  })

  it("applies text and derived geometry in one canonical command", () => {
    const source = northstarSeed.nodes.find(
      (node): node is TextNode => node.type === "text"
    )!
    const prepared = applyCommand(northstarSeed, {
      id: "make-auto-height",
      type: "update_node",
      actor: "human",
      at: "2026-08-28T01:00:00.000Z",
      nodeId: source.id,
      patch: { sizingMode: "auto_height", width: 180 },
    })
    const updated = applyCommand(prepared, {
      id: "edit-auto-height",
      type: "update_node",
      actor: "human",
      at: "2026-08-28T01:01:00.000Z",
      nodeId: source.id,
      patch: { text: "This edited value wraps onto several canonical lines" },
    })
    const text = updated.nodes.find(
      (node): node is TextNode => node.id === source.id && node.type === "text"
    )!

    expect(text.height).toBe(projectTextLayout(text).requiredHeight)
    expect(updated.revision).toBe(northstarSeed.revision + 2)
  })

  it("reflows field-bound auto-height text through the same layout boundary", () => {
    const source = northstarSeed.nodes.find(
      (node): node is TextNode =>
        node.id === "cover-title" && node.type === "text"
    )!
    const prepared = applyCommand(northstarSeed, {
      id: "bound-auto-height",
      type: "update_node",
      actor: "human",
      at: "2026-08-28T01:02:00.000Z",
      nodeId: source.id,
      patch: { sizingMode: "auto_height", width: 220 },
    })
    const updated = applyCommand(prepared, {
      id: "bound-value-change",
      type: "set_field",
      actor: "human",
      at: "2026-08-28T01:03:00.000Z",
      fieldId: "couple_names",
      value: "Aditi Sharma and Kabir Mehta celebrate in Jaipur",
    })
    const text = updated.nodes.find(
      (node): node is TextNode => node.id === source.id && node.type === "text"
    )!

    expect(text.text).toContain("celebrate in Jaipur")
    expect(text.height).toBe(projectTextLayout(text).requiredHeight)
    expect(text.height).toBeGreaterThan(source.height)
  })
})
