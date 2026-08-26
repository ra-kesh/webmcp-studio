import { describe, expect, it } from "vitest"
import { applyCommand, northstarSeed, validateDocument } from "../src"

describe("canonical document commands", () => {
  it("applies one shared field to every bound output", () => {
    const updated = applyCommand(northstarSeed, {
      id: "cmd-package-name",
      type: "set_field",
      actor: "agent",
      at: "2026-08-26T09:30:00.000Z",
      fieldId: "package_name",
      value: "The Monsoon Weekend",
    })

    expect(updated.revision).toBe(northstarSeed.revision + 1)
    expect(
      updated.nodes.find((node) => node.id === "package-name")
    ).toMatchObject({
      text: "The Monsoon Weekend",
    })
    expect(updated.nodes.find((node) => node.id === "wa-title")).toMatchObject({
      text: "The Monsoon Weekend",
    })
  })

  it("ships a structurally valid synthetic demo document", () => {
    const structuralErrors = validateDocument(northstarSeed).filter(
      (issue) => issue.severity === "error"
    )
    expect(structuralErrors).toEqual([])
  })
})
