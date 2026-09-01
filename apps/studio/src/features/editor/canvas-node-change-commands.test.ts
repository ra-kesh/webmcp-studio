import { describe, expect, it } from "vitest"
import { builtInDesignTemplateRepository } from "@webmcp/document"
import { canvasNodeChangeCommands } from "./canvas-node-change-commands"

describe("canvas node change commands", () => {
  it("routes direct edits of field-bound text through the canonical field", () => {
    const document = builtInDesignTemplateRepository.materialize(
      "signal-creative-brief",
      1
    )
    const binding = document.bindings.find(
      (candidate) => candidate.property === "text"
    )
    if (!binding) throw new Error("Expected a text binding")

    expect(
      canvasNodeChangeCommands(document, [
        {
          nodeId: binding.nodeId,
          patch: {
            text: "A direct canvas edit",
            runs: [],
            paragraphs: [],
            links: [],
          },
        },
      ])
    ).toEqual([
      {
        type: "set_field",
        fieldId: binding.fieldId,
        value: "A direct canvas edit",
      },
      {
        type: "update_node",
        nodeId: binding.nodeId,
        patch: { runs: [], paragraphs: [], links: [] },
      },
    ])
  })

  it("keeps ordinary unbound canvas changes as node updates", () => {
    const document = builtInDesignTemplateRepository.materialize(
      "signal-creative-brief",
      1
    )
    const node = document.nodes.find(
      (candidate) =>
        !document.bindings.some((binding) => binding.nodeId === candidate.id)
    )
    if (!node) throw new Error("Expected an unbound node")

    expect(
      canvasNodeChangeCommands(document, [
        { nodeId: node.id, patch: { x: node.x + 12 } },
      ])
    ).toEqual([
      { type: "update_node", nodeId: node.id, patch: { x: node.x + 12 } },
    ])
  })
})
