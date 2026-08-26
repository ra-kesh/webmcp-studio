import { describe, expect, it } from "vitest"
import { northstarSeed } from "@webmcp/document"
import { createFieldUpdateChangeSet } from "../src"

const identity = () => {
  let sequence = 0
  return {
    id: () => String(++sequence),
    now: () => "2026-08-26T10:00:00.000Z",
  }
}

describe("field update proposals", () => {
  it("turns field keys into typed canonical commands", () => {
    const proposal = createFieldUpdateChangeSet(
      northstarSeed,
      {
        documentId: northstarSeed.id,
        baseRevision: northstarSeed.revision,
        reason: "Adapt the package for a smaller celebration",
        values: {
          package_name: "The Saffron Weekend",
          package_price: "₹4,10,000",
        },
      },
      identity()
    )

    expect(proposal.title).toBe("Adapt the package for a smaller celebration")
    expect(proposal.operations).toHaveLength(2)
    expect(proposal.operations[0]?.command).toMatchObject({
      type: "set_field",
      actor: "agent",
      fieldId: "package_name",
      value: "The Saffron Weekend",
    })
  })

  it("rejects unknown, invalid, unchanged, and stale values", () => {
    const base = {
      documentId: northstarSeed.id,
      baseRevision: northstarSeed.revision,
    }
    expect(() =>
      createFieldUpdateChangeSet(
        northstarSeed,
        { ...base, values: { unknown: "value" } },
        identity()
      )
    ).toThrow("Unknown shared field")
    expect(() =>
      createFieldUpdateChangeSet(
        northstarSeed,
        { ...base, values: { package_name: true } },
        identity()
      )
    ).toThrow("Invalid value")
    expect(() =>
      createFieldUpdateChangeSet(
        northstarSeed,
        { ...base, values: { package_name: "The Heirloom Weekend" } },
        identity()
      )
    ).toThrow("already match")
    expect(() =>
      createFieldUpdateChangeSet(
        northstarSeed,
        { ...base, baseRevision: 0, values: { package_name: "New" } },
        identity()
      )
    ).toThrow("document changed")
  })
})
