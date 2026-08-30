import { describe, expect, it } from "vitest"
import {
  applyCommand,
  applyTextLayoutPatch,
  createAdverseRichTextConformanceNode,
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
  runs: [],
  paragraphs: [],
  links: [],
  color: "#111111",
  fontFamily: "Geist Variable",
  fontSize: 20,
  fontWeight: 400,
  italic: false,
  decoration: "none",
  lineHeight: 1.2,
  letterSpacing: 0,
  align: "left",
  sizingMode: "fixed",
  ...patch,
})

const adverseRichTextNode = createAdverseRichTextConformanceNode

describe("canonical text layout", () => {
  it("keeps a 1,000-run document within an interactive projection budget", () => {
    const text = Array.from(
      { length: 1_000 },
      (_, index) => `${index % 10}`.repeat(6) + " "
    ).join("")
    const node = textNode({
      text,
      width: 760,
      height: 20_000,
      sizingMode: "auto_height",
      runs: Array.from({ length: 1_000 }, (_, index) => ({
        start: index * 7,
        end: index * 7 + 7,
        style: {
          color: index % 2 === 0 ? "#333333" : "#111111",
          fontWeight: index % 3 === 0 ? 600 : 400,
        },
      })),
    })

    // Mirror mature editors: keep canonical rich data, but project it once into
    // a bounded paint model. Warm the managed-font tables before measuring.
    projectTextLayout(node)
    const startedAt = performance.now()
    const projection = projectTextLayout(node)
    const elapsed = performance.now() - startedAt

    expect(
      projection.lines.reduce((count, line) => count + line.segments.length, 0)
    ).toBe(1_000)
    expect(JSON.stringify(projection).length).toBeLessThan(400_000)
    expect(elapsed).toBeLessThan(250)
  })

  it("bounds a 1,000-run unbroken token that wraps late", () => {
    const node = adverseRichTextNode()

    projectTextLayout(node)
    const startedAt = performance.now()
    const projection = projectTextLayout(node)
    const elapsed = performance.now() - startedAt

    expect(projection.lines).toHaveLength(2)
    expect(projection.lines.map((line) => line.sourceEnd)).toEqual([
      6_301, 7_000,
    ])
    expect(
      projection.lines.reduce((count, line) => count + line.segments.length, 0)
    ).toBe(1_001)
    expect(projection.lines[0]?.segments.at(-1)).toMatchObject({
      text: "A",
      sourceStart: 6_300,
      sourceEnd: 6_301,
      style: { color: "#111111" },
    })
    expect(projection.lines[1]?.segments[0]).toMatchObject({
      text: "AAAAAA",
      sourceStart: 6_301,
      sourceEnd: 6_307,
      style: { color: "#111111" },
    })
    expect(JSON.stringify(projection).length).toBeLessThan(400_000)
    expect(elapsed).toBeLessThan(250)
  })

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
    expect(projection.measurement).toBe("managed_font_rich_text_v2")
    expect(projection.displayText).toContain("Hello   ")
    expect(projection.displayText).toContain("\n")
    expect(projection.requiredWidth).toBeLessThanOrEqual(100)
    expect(projection.requiredHeight).toBe(
      projection.lineCount * projection.lineHeightPx
    )
  })

  it("measures mixed runs and projects semantic list markers without changing source text", () => {
    const node = textNode({
      text: "Bold quiet\nLinked item",
      width: 180,
      height: 200,
      sizingMode: "auto_height",
      runs: [
        {
          start: 0,
          end: 4,
          style: {
            color: "#dc2626",
            fontSize: 32,
            fontWeight: 700,
            italic: true,
            decoration: "underline",
            lineHeight: 1.5,
            letterSpacing: 1,
          },
        },
      ],
      paragraphs: [
        { start: 0, end: 10, style: { align: "center" } },
        {
          start: 11,
          end: 22,
          style: { list: { kind: "bulleted", level: 1 } },
        },
      ],
      links: [
        {
          start: 11,
          end: 17,
          target: "https://example.com",
          newTab: true,
        },
      ],
    })

    const projection = projectTextLayout(node)
    const segments = projection.lines.flatMap((line) => line.segments)
    const bold = segments.find((segment) => segment.text === "Bold")
    const linked = segments.find((segment) => segment.link)

    expect(node.text).toBe("Bold quiet\nLinked item")
    expect(projection.displayText).toContain("  • Linked item")
    expect(projection.lines[0]).toMatchObject({ align: "center", height: 48 })
    expect(bold).toMatchObject({
      sourceStart: 0,
      sourceEnd: 4,
      styled: true,
      style: {
        color: "#dc2626",
        fontSize: 32,
        fontWeight: 700,
        italic: true,
        decoration: "underline",
      },
    })
    expect(linked).toMatchObject({
      text: "Linked",
      sourceStart: 11,
      sourceEnd: 17,
      link: { target: "https://example.com", newTab: true },
    })
    expect(segments.find((segment) => segment.synthetic)).toMatchObject({
      text: "  • ",
      sourceStart: 11,
      sourceEnd: 11,
    })
    expect(projection.requiredHeight).toBe(
      projection.lines.reduce((sum, line) => sum + line.height, 0)
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

  it("justifies soft-wrapped paragraph lines without stretching the final line", () => {
    const text = "One two three four"
    const projection = projectTextLayout(
      textNode({
        text,
        width: 112,
        height: 200,
        sizingMode: "auto_height",
        paragraphs: [
          { start: 0, end: text.length, style: { align: "justify" } },
        ],
      })
    )

    expect(projection.lines.length).toBeGreaterThan(1)
    expect(projection.lines[0]).toMatchObject({
      align: "justify",
      width: 112,
      justifySpacing: expect.any(Number),
    })
    expect(projection.lines[0]?.justifySpacing).toEqual(35.6)
    expect(projection.lines.at(-1)).toMatchObject({
      align: "justify",
      justifySpacing: 0,
    })
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

  it("recomputes managed geometry when run or list formatting changes", () => {
    const autoWidth = textNode({
      text: "Large word",
      sizingMode: "auto_width",
      width: 100,
      height: 24,
    })
    const withRun = applyTextLayoutPatch(autoWidth, {
      runs: [{ start: 0, end: 5, style: { fontSize: 48, lineHeight: 1.5 } }],
    })
    expect(withRun.width).toBeGreaterThan(autoWidth.width)
    expect(withRun.height).toBe(72)

    const autoHeight = textNode({
      text: "List item",
      sizingMode: "auto_height",
      width: 92,
      height: 24,
    })
    const withList = applyTextLayoutPatch(autoHeight, {
      paragraphs: [
        {
          start: 0,
          end: 9,
          style: { list: { kind: "bulleted", level: 1 } },
        },
      ],
    })
    expect(withList.height).toBeGreaterThan(autoHeight.height)
    expect(withList.height).toBe(projectTextLayout(withList).requiredHeight)
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
