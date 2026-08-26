import { describe, expect, it } from "vitest"
import {
  createTemplateVersion,
  materializeTemplateVersion,
  northstarSeed,
} from "../src"

const published = createTemplateVersion(northstarSeed, {
  id: "version-1",
  templateId: "northstar-wedding-proposal",
  version: 1,
  publishedAt: "2026-08-26T10:00:00.000Z",
})

describe("template rendering", () => {
  it("materializes API values without mutating the published snapshot", () => {
    const rendered = materializeTemplateVersion(published, {
      couple_names: "Mira & Kabir",
      package_name: "The Monsoon Weekend",
      package_price: "₹4,10,000",
    })

    expect(
      rendered.nodes.find((node) => node.id === "cover-title")
    ).toMatchObject({ text: "Mira & Kabir" })
    expect(rendered.nodes.find((node) => node.id === "wa-title")).toMatchObject(
      { text: "The Monsoon Weekend" }
    )
    expect(published.document.fieldValues.couple_names).toBe("Aditi & Kabir")
  })

  it("rejects unknown, mistyped, and empty required parameters", () => {
    expect(() =>
      materializeTemplateVersion(published, { typo_name: "Value" })
    ).toThrow("Unknown template parameter")
    expect(() =>
      materializeTemplateVersion(published, { package_name: false })
    ).toThrow("wrong value type")
    expect(() =>
      materializeTemplateVersion(published, { package_name: "" })
    ).toThrow("cannot be empty")
  })
})
