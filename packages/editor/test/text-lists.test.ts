import { describe, expect, it } from "vitest"
import {
  applyPlainTextListStyle,
  continuePlainTextList,
  detectPlainTextListStyle,
  indentPlainTextList,
  removePlainTextListMarker,
  renumberPlainTextList,
  resolvePlainTextListKey,
} from "../src/text-lists"

describe("plain-text list semantics", () => {
  it("detects canonical and pasted list markers without confusing plain text", () => {
    expect(detectPlainTextListStyle("Alpha\nBeta")).toBe("none")
    expect(detectPlainTextListStyle("• Alpha\n- Beta\n* Gamma")).toBe(
      "bulleted"
    )
    expect(detectPlainTextListStyle("12) Alpha\n4. Beta")).toBe("numbered")
    expect(detectPlainTextListStyle("• Alpha\nBeta")).toBe("mixed")
    expect(detectPlainTextListStyle("• ")).toBe("bulleted")
  })

  it("converts list styles without stacking markers and numbers each depth", () => {
    const source = "Alpha\n  Beta\nGamma"
    expect(applyPlainTextListStyle(source, "bulleted")).toBe(
      "• Alpha\n  • Beta\n• Gamma"
    )
    expect(applyPlainTextListStyle(source, "numbered")).toBe(
      "1. Alpha\n  1. Beta\n2. Gamma"
    )
    expect(applyPlainTextListStyle("• Alpha\n  • Beta\n• Gamma", "none")).toBe(
      source
    )
    expect(applyPlainTextListStyle("- Alpha\n9) Beta", "bulleted")).toBe(
      "• Alpha\n• Beta"
    )
  })

  it("preserves blank paragraphs and their whitespace through toggles", () => {
    const source = "  Alpha\n \t \n\n\tBeta"
    const bullets = applyPlainTextListStyle(source, "bulleted")
    expect(bullets).toBe("  • Alpha\n \t \n\n\t• Beta")
    expect(applyPlainTextListStyle(bullets, "none")).toBe(source)
  })

  it("renumbers nested items and restarts after a plain paragraph", () => {
    expect(
      renumberPlainTextList(
        "9. Parent\n  8) Child\n  2. Child\n4. Parent\n  7. Child\n\nNote\n8. Restart"
      )
    ).toBe(
      "1. Parent\n  1. Child\n  2. Child\n2. Parent\n  1. Child\n\nNote\n1. Restart"
    )
  })

  it("continues a bulleted item at the caret and replaces a selection", () => {
    expect(continuePlainTextList("• Alpha", 4, 4)).toEqual({
      text: "• Al\n• pha",
      selectionStart: 7,
      selectionEnd: 7,
    })
    expect(continuePlainTextList("• Alpha", 2, 7)).toEqual({
      text: "• \n• ",
      selectionStart: 5,
      selectionEnd: 5,
    })
  })

  it("continues and renumbers numbered items", () => {
    expect(continuePlainTextList("8. Alpha\n3. Beta", 8, 8)).toEqual({
      text: "1. Alpha\n2. \n3. Beta",
      selectionStart: 12,
      selectionEnd: 12,
    })
  })

  it("treats every caret position inside a marker as the content boundary", () => {
    for (const offset of [0, 1, 2]) {
      expect(continuePlainTextList("• Alpha", offset, offset)).toEqual({
        text: "• \n• Alpha",
        selectionStart: 5,
        selectionEnd: 5,
      })
    }
    for (const offset of [0, 1, 2, 3, 4]) {
      expect(continuePlainTextList("12. Alpha", offset, offset)).toEqual({
        text: "1. \n2. Alpha",
        selectionStart: 7,
        selectionEnd: 7,
      })
    }
  })

  it("preserves the marker when an Enter replacement selection crosses it", () => {
    expect(continuePlainTextList("12. Alpha", 1, 7)).toEqual({
      text: "1. \n2. ha",
      selectionStart: 7,
      selectionEnd: 7,
    })
  })

  it("terminates a marker-only item instead of creating another marker", () => {
    expect(continuePlainTextList("• Alpha\n• \n• Omega", 10, 10)).toEqual({
      text: "• Alpha\n\n• Omega",
      selectionStart: 8,
      selectionEnd: 8,
    })
    expect(continuePlainTextList("8. Alpha\n  3. \n9. Omega", 14, 14)).toEqual({
      text: "1. Alpha\n\n2. Omega",
      selectionStart: 9,
      selectionEnd: 9,
    })
  })

  it("indents and outdents selected list lines, then repairs numbering", () => {
    const source = "1. Parent\n2. Child\n3. Sibling"
    const indented = indentPlainTextList(source, 10, 18, "indent")
    expect(indented).toEqual({
      text: "1. Parent\n  1. Child\n2. Sibling",
      selectionStart: 12,
      selectionEnd: 20,
    })
    expect(
      indentPlainTextList(
        indented!.text,
        indented!.selectionStart,
        indented!.selectionEnd,
        "outdent"
      )
    ).toEqual({
      text: source,
      selectionStart: 10,
      selectionEnd: 18,
    })
  })

  it("indents every selected list line but leaves an unselected trailing line alone", () => {
    expect(indentPlainTextList("• A\n• B\n• C", 0, 8, "indent")?.text).toBe(
      "  • A\n  • B\n• C"
    )
  })

  it("removes a marker at the content boundary and preserves indentation", () => {
    expect(removePlainTextListMarker("  • Alpha", 4, 4)).toEqual({
      text: "  Alpha",
      selectionStart: 2,
      selectionEnd: 2,
    })
    expect(removePlainTextListMarker("• Alpha", 5, 5)).toBeNull()
    expect(removePlainTextListMarker("• Alpha", 2, 5)).toBeNull()
  })

  it("renumbers ordered items after a marker is removed", () => {
    expect(
      removePlainTextListMarker("7. Alpha\n9. Beta\n4. Gamma", 12, 12)
    ).toEqual({
      text: "1. Alpha\nBeta\n1. Gamma",
      selectionStart: 9,
      selectionEnd: 9,
    })
  })

  it("handles Tab only on list items and leaves Shift+Enter to Fabric", () => {
    expect(
      resolvePlainTextListKey({
        key: "Enter",
        text: "Plain text",
        selectionStart: 2,
        selectionEnd: 2,
      })
    ).toBeNull()
    expect(
      resolvePlainTextListKey({
        key: "Backspace",
        text: "Plain text",
        selectionStart: 2,
        selectionEnd: 2,
      })
    ).toBeNull()
    expect(
      resolvePlainTextListKey({
        key: "Tab",
        text: "Plain text",
        selectionStart: 2,
        selectionEnd: 2,
      })
    ).toBeNull()
    expect(
      resolvePlainTextListKey({
        key: "Tab",
        shiftKey: true,
        text: "• Top level",
        selectionStart: 4,
        selectionEnd: 4,
      })
    ).toEqual({
      text: "• Top level",
      selectionStart: 4,
      selectionEnd: 4,
    })
    expect(
      resolvePlainTextListKey({
        key: "Enter",
        shiftKey: true,
        text: "• Item",
        selectionStart: 6,
        selectionEnd: 6,
      })
    ).toBeNull()
    expect(
      resolvePlainTextListKey({
        key: "Backspace",
        text: "1. Item",
        selectionStart: 3,
        selectionEnd: 3,
      })
    ).toEqual({
      text: "Item",
      selectionStart: 0,
      selectionEnd: 0,
    })
  })
})
