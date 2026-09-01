import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import {
  CommitPercentSlider,
  CommitTextarea,
  InspectorColorField,
  InspectorNumberField,
  nativeInspectorColorValue,
  parseInspectorColorDraft,
} from "./inspector-controls"

describe("compact Inspector controls", () => {
  it("keeps geometry labels inside the 24px property field", () => {
    const markup = renderToStaticMarkup(
      createElement(InspectorNumberField, {
        label: "Width",
        compactLabel: "W",
        value: { kind: "value", value: 760 },
        onCommit: () => undefined,
      })
    )

    expect(markup).toContain('aria-label="Width"')
    expect(markup).toMatch(/<label[^>]*\bsr-only\b/)
    expect(markup).toContain(">W</span>")
    expect(markup).toContain("h-6")
    expect(markup).toContain("pl-7")
  })

  it("bounds long text content without restoring a generic form textarea", () => {
    const markup = renderToStaticMarkup(
      createElement(CommitTextarea, {
        value: "Wedding photography & films",
        onCommit: () => undefined,
      })
    )

    expect(markup).toContain("min-h-16")
    expect(markup).toContain("max-h-40")
    expect(markup).toContain("text-[11px]")
  })
})

describe("CommitPercentSlider", () => {
  it("pairs the quick slider with a named numeric percentage alternative", () => {
    const markup = renderToStaticMarkup(
      createElement(CommitPercentSlider, {
        label: "Horizontal focus",
        value: 37.5,
        onCommit: () => undefined,
      })
    )

    expect(markup).toContain('aria-label="Horizontal focus percentage"')
    expect(markup).toContain('inputMode="decimal"')
    expect(markup).toContain('value="37.5"')
    expect(markup).toContain('aria-label="Horizontal focus"')
    expect(markup).toContain('aria-valuetext="37.5%"')
  })

  it("disables both input paths together", () => {
    const markup = renderToStaticMarkup(
      createElement(CommitPercentSlider, {
        label: "Opacity",
        value: 100,
        disabled: true,
        onCommit: () => undefined,
      })
    )

    expect(markup).toContain('data-disabled="true"')
    expect(markup).toContain('aria-disabled="true"')
    expect(markup.match(/disabled=""/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })
})

describe("InspectorColorField", () => {
  it("uses the same safe CSS color contract as the document model", () => {
    expect(parseInspectorColorDraft("Fill", " #abc ")).toEqual({
      ok: true,
      value: "#ABC",
    })
    expect(parseInspectorColorDraft("Fill", "rgb(31 41 55 / 80%)")).toEqual({
      ok: true,
      value: "rgb(31 41 55 / 80%)",
    })
    expect(parseInspectorColorDraft("Fill", "transparent")).toEqual({
      ok: true,
      value: "transparent",
    })
    expect(
      parseInspectorColorDraft("Fill", "url(javascript:alert(1))")
    ).toMatchObject({ ok: false })
  })

  it("derives a valid native picker value without rejecting alpha colors", () => {
    expect(nativeInspectorColorValue("#abc")).toBe("#AABBCC")
    expect(nativeInspectorColorValue("#12345680")).toBe("#123456")
    expect(nativeInspectorColorValue("rgb(31 41 55 / 80%)")).toBe("#000000")
  })

  it("renders a truthful swatch for non-hex document colors", () => {
    const markup = renderToStaticMarkup(
      createElement(InspectorColorField, {
        label: "Fill",
        value: "rgb(31 41 55 / 80%)",
        onCommit: () => undefined,
      })
    )

    expect(markup).toContain("background-color:rgb(31 41 55 / 80%)")
    expect(markup).toContain('aria-label="Fill color picker"')
    expect(markup).toContain('value="#000000"')
  })
})
