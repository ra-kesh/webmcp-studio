import { builtInDesignTemplateRepository } from "@webmcp/document"
import { describe, expect, it, vi } from "vitest"
import { CanvasNodeMutationController } from "./canvas-node-mutation-controller"

describe("CanvasNodeMutationController", () => {
  it("routes Inspector edits to bound text through the canonical field command", () => {
    const document = builtInDesignTemplateRepository.materialize(
      "signal-creative-brief",
      1,
      { identity: "canonical" }
    )
    const title = document.nodes.find(
      (node) => node.type === "text" && node.name === "Title"
    )
    if (!title) throw new Error("Expected the Signal title")
    const binding = document.bindings.find(
      (candidate) =>
        candidate.nodeId === title.id && candidate.property === "text"
    )
    if (!binding) throw new Error("Expected the Signal title binding")
    const commit = vi.fn(() => true)
    const controller = new CanvasNodeMutationController(() => document, commit)

    expect(
      controller.updateNode(title.id, {
        text: "Make the useful choice feel inevitable.",
      })
    ).toBe(true)

    expect(commit).toHaveBeenCalledWith(
      [
        {
          type: "set_field",
          fieldId: binding.fieldId,
          value: "Make the useful choice feel inevitable.",
        },
      ],
      { label: "Edit text" }
    )
  })
})
