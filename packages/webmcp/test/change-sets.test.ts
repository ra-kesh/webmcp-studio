import { describe, expect, it } from "vitest"
import { northstarSeed, previewChangeSet } from "@webmcp/document"
import type { Document, SceneNode } from "@webmcp/document"
import {
  canvasPatchValuesEqual,
  createCanvasEditChangeSet,
  createDesignStyleChangeSet,
  createDesignVariableChangeSet,
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
        baseSnapshotId: "snapshot-northstar",
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
    expect(proposal.operations[1]?.command).toMatchObject({
      type: "set_field",
      fieldId: "package_price",
      value: "410000",
    })
  })

  it("rejects unknown, invalid, unchanged, and stale values", () => {
    const base = {
      documentId: northstarSeed.id,
      baseRevision: northstarSeed.revision,
      baseSnapshotId: "snapshot-northstar",
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
        { ...base, values: { package_price: "₹3,85,000" } },
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
  const imageNode: Extract<SceneNode, { type: "image" }> = {
    id: "image-noop",
    type: "image",
    name: "No-op image",
    x: 40,
    y: 60,
    width: 320,
    height: 180,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    assetId: "asset-noop",
    src: "https://example.com/noop.png",
    placement: {
      mode: "manual",
      focalX: 0.25,
      focalY: 0.75,
      zoom: 1.4,
      rotation: 15,
      flipX: true,
      flipY: false,
    },
    frameMask: { shape: "rounded_rectangle", radius: 0.16 },
    alt: "No-op image",
    decorative: false,
  }
  const documentWithImage: Document = {
    ...northstarSeed,
    pages: northstarSeed.pages.map((page, index) =>
      index === 0 ? { ...page, nodeIds: [...page.nodeIds, imageNode.id] } : page
    ),
    nodes: [...northstarSeed.nodes, imageNode],
  }

  it("compares canonical structured patch values by content", () => {
    expect(
      canvasPatchValuesEqual(
        { mode: "fill", focal: [0.5, 0.5] },
        { focal: [0.5, 0.5], mode: "fill" }
      )
    ).toBe(true)
    expect(
      canvasPatchValuesEqual({ shape: "ellipse" }, { shape: "rectangle" })
    ).toBe(false)
  })

  it.each([
    ["placement", { ...imageNode.placement }],
    ["frameMask", { ...imageNode.frameMask }],
  ])("rejects a structured %s no-op", (property, value) => {
    expect(() =>
      createCanvasEditChangeSet(
        documentWithImage,
        {
          documentId: documentWithImage.id,
          baseRevision: documentWithImage.revision,
          baseSnapshotId: "snapshot-image-noop",
          edits: [
            {
              nodeType: "image",
              nodeId: imageNode.id,
              patch: { [property]: value },
            },
          ],
        },
        identity()
      )
    ).toThrow("already has those values")
  })

  it("creates validated per-layer operations without mutating the source", () => {
    const proposal = createCanvasEditChangeSet(
      northstarSeed,
      {
        documentId: northstarSeed.id,
        baseRevision: northstarSeed.revision,
        baseSnapshotId: "snapshot-northstar",
        reason: "Give the cover more breathing room",
        edits: [
          {
            nodeType: "text",
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
      baseSnapshotId: "snapshot-northstar",
    }
    expect(() =>
      createCanvasEditChangeSet(
        northstarSeed,
        {
          ...base,
          edits: [
            {
              nodeType: "text",
              nodeId: "cover-title",
              patch: { text: "Bypass" },
            },
          ],
        },
        identity()
      )
    ).toThrow("propose_field_updates")
    expect(() =>
      createCanvasEditChangeSet(
        northstarSeed,
        {
          ...base,
          edits: [
            {
              nodeType: "text",
              nodeId: "cover-title",
              patch: { src: "https://bad" },
            },
          ],
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
            { nodeType: "text", nodeId: "cover-title", patch: { y: 700 } },
            { nodeType: "text", nodeId: "cover-title", patch: { x: 100 } },
          ],
        },
        identity()
      )
    ).toThrow("Combine duplicate edits")
  })
})

describe("design style proposals", () => {
  const textStyle = {
    id: "typography-style-editorial-hero",
    name: "Editorial / Hero",
    fontFamily: "Geist Variable",
    fontSize: 72,
    fontWeight: 600,
    italic: false,
    decoration: "none" as const,
    lineHeight: 1.05,
    letterSpacing: -1.4,
  }

  it("creates and applies canonical reusable style commands", () => {
    const { id: _styleId, ...style } = textStyle
    const creation = createDesignStyleChangeSet(
      northstarSeed,
      {
        documentId: northstarSeed.id,
        baseRevision: northstarSeed.revision,
        baseSnapshotId: "snapshot-northstar",
        changes: [
          {
            kind: "typography",
            action: "create",
            style,
          },
        ],
      },
      identity()
    )
    expect(creation.operations[0]?.command).toMatchObject({
      type: "create_typography_style",
      style: { name: "Editorial / Hero", fontSize: 72 },
    })
    expect(
      previewChangeSet(northstarSeed, creation).typographyStyles
    ).toHaveLength(1)

    const document = {
      ...northstarSeed,
      typographyStyles: [textStyle],
    }
    const application = createDesignStyleChangeSet(
      document,
      {
        documentId: document.id,
        baseRevision: document.revision,
        baseSnapshotId: "snapshot-northstar",
        changes: [
          {
            kind: "typography",
            action: "apply",
            styleId: textStyle.id,
            targets: [{ nodeId: "cover-title" }],
          },
        ],
      },
      identity()
    )
    const preview = previewChangeSet(document, application)
    expect(
      preview.nodes.find((node) => node.id === "cover-title")
    ).toMatchObject({ typographyStyleId: textStyle.id, fontSize: 72 })
  })

  it("protects attached styles from deletion", () => {
    const document = {
      ...northstarSeed,
      typographyStyles: [textStyle],
      nodes: northstarSeed.nodes.map((node) =>
        node.id === "cover-title"
          ? { ...node, typographyStyleId: textStyle.id }
          : node
      ),
    } as Document
    expect(() =>
      createDesignStyleChangeSet(
        document,
        {
          documentId: document.id,
          baseRevision: document.revision,
          baseSnapshotId: "snapshot-northstar",
          changes: [
            {
              kind: "typography",
              action: "delete",
              styleId: textStyle.id,
            },
          ],
        },
        identity()
      )
    ).toThrow("Detach it before deleting")
  })
})

describe("design variable proposals", () => {
  it("creates, binds, and propagates a typed variable through canonical commands", () => {
    const creation = createDesignVariableChangeSet(
      northstarSeed,
      {
        documentId: northstarSeed.id,
        baseRevision: northstarSeed.revision,
        baseSnapshotId: "snapshot-northstar",
        changes: [
          {
            action: "create",
            variable: {
              name: "Brand / Panel",
              type: "color",
              value: "#335C4A",
            },
          },
        ],
      },
      identity()
    )
    const created = previewChangeSet(northstarSeed, creation)
    const variable = created.variables[0]
    expect(variable).toMatchObject({ name: "Brand / Panel", type: "color" })

    const binding = createDesignVariableChangeSet(
      created,
      {
        documentId: created.id,
        baseRevision: created.revision,
        baseSnapshotId: "snapshot-created",
        changes: [
          {
            action: "bind",
            variableId: variable!.id,
            target: { kind: "node", nodeId: "cover-panel", property: "fill" },
          },
        ],
      },
      identity()
    )
    const bound = previewChangeSet(created, binding)
    expect(bound.variableBindings).toHaveLength(1)
    expect(bound.nodes.find((node) => node.id === "cover-panel")).toMatchObject(
      {
        fill: "#335C4A",
      }
    )
  })
})

describe("output variant proposals", () => {
  it("adapts one source page with cloned bindings as one atomic operation", () => {
    const proposal = createOutputVariantChangeSet(
      northstarSeed,
      {
        documentId: northstarSeed.id,
        baseRevision: northstarSeed.revision,
        baseSnapshotId: "snapshot-northstar",
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
