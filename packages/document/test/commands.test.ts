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

  it("reorders nodes without coupling the document to a renderer", () => {
    const page = northstarSeed.pages.find(
      (candidate) => candidate.id === "cover"
    )
    expect(page).toBeDefined()
    const nodeId = page?.nodeIds[0]
    expect(nodeId).toBeDefined()

    const updated = applyCommand(northstarSeed, {
      id: "cmd-reorder-cover",
      type: "reorder_node",
      actor: "human",
      at: "2026-08-26T09:30:00.000Z",
      pageId: "cover",
      nodeId: nodeId ?? "",
      toIndex: 2,
    })

    const updatedPage = updated.pages.find(
      (candidate) => candidate.id === "cover"
    )
    expect(updatedPage?.nodeIds[2]).toBe(nodeId)
  })
})
