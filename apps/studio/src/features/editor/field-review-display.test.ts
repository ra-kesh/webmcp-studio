import { describe, expect, it } from "vitest"
import type { FieldDefinition } from "@webmcp/document"
import { studioAssets } from "./asset-catalog"
import { displayFieldChangeValue } from "./field-review-display"

const field = (
  type: FieldDefinition["type"],
  overrides: Partial<FieldDefinition> = {}
): FieldDefinition => ({
  id: `${type}_field`,
  key: `${type}_field`,
  label: `${type} field`,
  type,
  required: false,
  defaultValue: type === "number" ? 0 : type === "boolean" ? false : "",
  agentDescription: "",
  validation: {},
  ...overrides,
})

describe("field-aware review display", () => {
  it("formats canonical currency, date, and choice values for people", () => {
    expect(displayFieldChangeValue(field("currency"), "385000.50")).toBe(
      "₹3,85,000.50"
    )
    expect(displayFieldChangeValue(field("date"), "2028-02-29")).toBe(
      "29 February 2028"
    )
    expect(
      displayFieldChangeValue(
        field("choice", {
          validation: {
            options: [
              {
                value: "midnight",
                label: "Midnight Film",
                agentDescription: "",
              },
            ],
          },
        }),
        "midnight"
      )
    ).toBe("Midnight Film")
  })

  it("uses catalog identity and never exposes renderer sources", () => {
    const catalogAsset = studioAssets[0]
    expect(displayFieldChangeValue(field("asset"), catalogAsset.src)).toBe(
      `${catalogAsset.name} (${catalogAsset.id})`
    )
    expect(
      displayFieldChangeValue(
        field("asset"),
        "https://assets.example.test/private-source.png"
      )
    ).toBe("External asset awaiting upload")
    expect(
      displayFieldChangeValue(
        field("asset"),
        "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M0%200h1v1z%22%2F%3E%3C%2Fsvg%3E"
      )
    ).toBe("Embedded renderer-safe asset")
  })
})
