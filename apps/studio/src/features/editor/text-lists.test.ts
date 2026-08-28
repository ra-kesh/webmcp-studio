import { describe, expect, it } from "vitest"
import {
  applyStudioTextListStyle,
  detectStudioTextListStyle,
} from "./text-lists"

describe("Studio text lists", () => {
  it("detects unlisted, bulleted, numbered, and mixed paragraph content", () => {
    expect(detectStudioTextListStyle("Alpha\nBeta")).toBe("none")
    expect(detectStudioTextListStyle("• Alpha\n\n• Beta")).toBe("bulleted")
    expect(detectStudioTextListStyle("1. Alpha\n2) Beta")).toBe("numbered")
    expect(detectStudioTextListStyle("• Alpha\nBeta")).toBe("mixed")
    expect(detectStudioTextListStyle("\n  \n")).toBe("none")
  })

  it("applies list markers to non-empty paragraphs and preserves indentation", () => {
    const source = "Alpha\n\n  Beta"
    expect(applyStudioTextListStyle(source, "bulleted")).toBe(
      "• Alpha\n\n  • Beta"
    )
    expect(applyStudioTextListStyle(source, "numbered")).toBe(
      "1. Alpha\n\n  1. Beta"
    )
  })

  it("switches and removes markers without stacking prefixes", () => {
    const bullets = "• Alpha\n  • Beta"
    const numbered = applyStudioTextListStyle(bullets, "numbered")
    expect(numbered).toBe("1. Alpha\n  1. Beta")
    expect(applyStudioTextListStyle(numbered, "none")).toBe("Alpha\n  Beta")
  })
})
