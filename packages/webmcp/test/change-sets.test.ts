import { describe, expect, it } from "vitest"
import { northstarSeed, previewChangeSet } from "@webmcp/document"
import {
  createCanvasEditChangeSet,
  createFieldUpdateChangeSet,
  createOutputVariantChangeSet,
} from "../src"

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

describe("canvas edit proposals", () => {
  it("creates validated per-layer operations without mutating the source", () => {
    const proposal = createCanvasEditChangeSet(
      northstarSeed,
      {
        documentId: northstarSeed.id,
        baseRevision: northstarSeed.revision,
        reason: "Give the cover more breathing room",
        edits: [
          {
            nodeId: "cover-title",
            patch: { y: 760, color: "#f3eadc" },
          },
        ],
      },
      identity()
    )

    expect(proposal.operations[0]?.command).toMatchObject({
      type: "update_node",
      nodeId: "cover-title",
      patch: { y: 760, color: "#f3eadc" },
    })
    expect(
      northstarSeed.nodes.find((node) => node.id === "cover-title")?.y
    ).not.toBe(760)
    expect(
      previewChangeSet(northstarSeed, proposal).nodes.find(
        (node) => node.id === "cover-title"
      )
    ).toMatchObject({ y: 760, color: "#f3eadc" })
  })

  it("rejects bound, unsafe, and duplicate layer edits", () => {
    const base = {
      documentId: northstarSeed.id,
      baseRevision: northstarSeed.revision,
    }
    expect(() =>
      createCanvasEditChangeSet(
        northstarSeed,
        {
          ...base,
          edits: [{ nodeId: "cover-title", patch: { text: "Bypass" } }],
        },
        identity()
      )
    ).toThrow("propose_field_updates")
    expect(() =>
      createCanvasEditChangeSet(
        northstarSeed,
        {
          ...base,
          edits: [{ nodeId: "cover-title", patch: { src: "https://bad" } }],
        },
        identity()
      )
    ).toThrow("cannot be changed")
    expect(() =>
      createCanvasEditChangeSet(
        northstarSeed,
        {
          ...base,
          edits: [
            { nodeId: "cover-title", patch: { y: 700 } },
            { nodeId: "cover-title", patch: { x: 100 } },
          ],
        },
        identity()
      )
    ).toThrow("Combine duplicate edits")
  })
})

describe("output variant proposals", () => {
  it("adapts one source page with cloned bindings as one atomic operation", () => {
    const proposal = createOutputVariantChangeSet(
      northstarSeed,
      {
        documentId: northstarSeed.id,
        baseRevision: northstarSeed.revision,
        sourcePageId: "cover",
        name: "Instagram portrait",
        kind: "whatsapp_portrait",
        width: 1080,
        height: 1350,
        exportFormats: ["png"],
      },
      identity()
    )
    expect(proposal.operations).toHaveLength(1)
    expect(proposal.operations[0]?.command).toMatchObject({
      type: "add_output_variant",
      output: { name: "Instagram portrait" },
      page: { width: 1080, height: 1350 },
    })

    const preview = previewChangeSet(northstarSeed, proposal)
    const output = preview.outputs.at(-1)
    const page = preview.pages.find(
      (candidate) => candidate.id === output?.pageIds[0]
    )
    expect(output?.name).toBe("Instagram portrait")
    expect(page?.nodeIds).toHaveLength(
      northstarSeed.pages.find((candidate) => candidate.id === "cover")?.nodeIds
        .length
    )
    expect(
      preview.bindings.filter((binding) =>
        page?.nodeIds.includes(binding.nodeId)
      )
    ).not.toHaveLength(0)
  })
})
