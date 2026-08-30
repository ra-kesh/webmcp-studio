import { describe, expect, it } from "vitest"
import { normalizeTextLinkTargetInput } from "./text-link-editor"

describe("text link editor", () => {
  it("admits safe explicit targets and normalizes ordinary web domains", () => {
    expect(normalizeTextLinkTargetInput("example.com/work")).toBe(
      "https://example.com/work"
    )
    expect(normalizeTextLinkTargetInput("mailto:hello@example.com")).toBe(
      "mailto:hello@example.com"
    )
    expect(normalizeTextLinkTargetInput("tel:+15551234567")).toBe(
      "tel:+15551234567"
    )
  })

  it("rejects executable, insecure, relative, and empty targets", () => {
    expect(normalizeTextLinkTargetInput("javascript:alert(1)")).toBeNull()
    expect(normalizeTextLinkTargetInput("http://example.com")).toBeNull()
    expect(normalizeTextLinkTargetInput("/relative")).toBeNull()
    expect(normalizeTextLinkTargetInput("   ")).toBeNull()
  })
})
