import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { CommitPercentSlider } from "./inspector-controls"

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
