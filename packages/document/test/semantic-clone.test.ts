import { describe, expect, it } from "vitest"
import {
  applyCommand,
  captureSemanticFragment,
  cloneSemanticFragment,
  createTemplateManifest,
  documentSchema,
  validateDocument,
  type Document,
} from "../src"

const at = "2026-08-28T01:00:00.000Z"

function semanticFixture(): Document {
  return documentSchema.parse({
    schemaVersion: 5,
    id: "semantic-document",
    name: "Semantic clone fixture",
    revision: 1,
    createdAt: at,
    updatedAt: at,
    outputs: [
      {
        id: "proposal",
        name: "Proposal",
        kind: "proposal",
        pageIds: ["cover"],
        exportFormats: ["pdf", "png"],
      },
    ],
    pages: [
      {
        id: "cover",
        outputId: "proposal",
        name: "Cover",
        width: 1000,
        height: 1400,
        background: "#ffffff",
        nodeIds: ["panel", "title", "portrait", "divider"],
      },
    ],
    nodes: [
      {
        id: "panel",
        type: "rect",
        name: "Panel",
        x: 40,
        y: 40,
        width: 920,
        height: 420,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        fill: "#000000",
        radius: 24,
        strokeWidth: 0,
      },
      {
        id: "title",
        type: "text",
        name: "Title",
        x: 80,
        y: 80,
        width: 600,
        height: 100,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        text: "Placeholder",
        color: "#ffffff",
        fontFamily: "Geist Variable",
        fontSize: 64,
        fontWeight: 600,
        lineHeight: 1.1,
        letterSpacing: -1,
        align: "left",
        runs: [
          {
            start: 0,
            end: 5,
            style: { fontWeight: 760, italic: true, color: "#fde68a" },
          },
        ],
        paragraphs: [{ start: 0, end: 11, style: { align: "center" } }],
        links: [
          {
            start: 6,
            end: 11,
            target: "https://example.com/proposal",
            newTab: true,
          },
        ],
      },
      {
        id: "portrait",
        type: "image",
        name: "Portrait",
        x: 80,
        y: 220,
        width: 300,
        height: 180,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        assetId: "portrait-asset",
        src: "https://assets.example.test/placeholder.png",
        placement: {
          mode: "fill",
          focalX: 0.5,
          focalY: 0.5,
          zoom: 1,
          rotation: 0,
          flipX: false,
          flipY: false,
        },
        frameMask: { shape: "rectangle" },
        alt: "Couple portrait",
        decorative: false,
      },
      {
        id: "divider",
        type: "line",
        name: "Divider",
        x: 80,
        y: 420,
        width: 600,
        height: 1,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        stroke: "#ffffff",
        strokeWidth: 2,
      },
    ],
    typographyStyles: [],
    paintStyles: [],
    variables: [
      {
        id: "variable-title-size",
        name: "Type / Title size",
        type: "number",
        value: 64,
      },
    ],
    components: [],
    componentInstances: [],
    variableBindings: [
      {
        id: "variable-binding-title-size",
        variableId: "variable-title-size",
        target: { kind: "node", nodeId: "title", property: "fontSize" },
      },
    ],
    groups: [
      {
        id: "cover-group",
        pageId: "cover",
        name: "Cover group",
        nodeIds: ["panel", "title"],
        role: "organize",
      },
      {
        id: "media-group",
        pageId: "cover",
        name: "Media group",
        nodeIds: ["portrait", "divider"],
        parentGroupId: "cover-group",
        role: "organize",
      },
    ],
    fields: [
      {
        id: "title-field",
        key: "title",
        label: "Title",
        type: "text",
        required: true,
        defaultValue: "Aditi & Kabir",
      },
      {
        id: "portrait-field",
        key: "portrait",
        label: "Portrait",
        type: "asset",
        required: true,
        defaultValue: "https://assets.example.test/couple.png",
      },
      {
        id: "visible-field",
        key: "show_divider",
        label: "Show divider",
        type: "boolean",
        required: true,
        defaultValue: true,
      },
      {
        id: "fill-field",
        key: "panel_fill",
        label: "Panel fill",
        type: "color",
        required: true,
        defaultValue: "#223329",
      },
    ],
    fieldValues: {
      "title-field": "Aditi & Kabir",
      "portrait-field": "https://assets.example.test/couple.png",
      "visible-field": true,
      "fill-field": "#223329",
    },
    bindings: [
      {
        id: "title-binding",
        fieldId: "title-field",
        nodeId: "title",
        property: "text",
      },
      {
        id: "portrait-binding",
        fieldId: "portrait-field",
        nodeId: "portrait",
        property: "src",
      },
      {
        id: "visible-binding",
        fieldId: "visible-field",
        nodeId: "divider",
        property: "visible",
      },
      {
        id: "fill-binding",
        fieldId: "fill-field",
        nodeId: "panel",
        property: "fill",
      },
    ],
  })
}

const deterministicId = (kind: string, sourceId: string) =>
  `${kind}-copy-${sourceId}`

function maskSemanticFixture(): Document {
  const document = semanticFixture()
  return {
    ...document,
    groups: [
      {
        id: "cover-mask",
        pageId: "cover",
        name: "Cover mask",
        nodeIds: ["panel", "title"],
        role: "mask",
        mask: { type: "vector", sourceNodeIds: ["panel"] },
      },
      {
        id: "media-group",
        pageId: "cover",
        name: "Media group",
        nodeIds: ["portrait", "divider"],
        role: "organize",
      },
    ],
  }
}

describe("semantic document cloning", () => {
  it("remaps mask sources for page duplication and omits a partial relation", () => {
    const source = maskSemanticFixture()
    const full = captureSemanticFragment(
      source,
      "cover",
      source.pages[0]?.nodeIds ?? []
    )
    const clone = cloneSemanticFragment(full, {
      targetPageId: "cover-mask-copy",
      createId: deterministicId,
    })
    const clonedMask = clone.groups.find(
      (group) => group.id === "group-copy-cover-mask"
    )
    expect(clonedMask).toEqual({
      id: "group-copy-cover-mask",
      pageId: "cover-mask-copy",
      name: "Cover mask",
      nodeIds: ["node-copy-panel", "node-copy-title"],
      role: "mask",
      mask: { type: "vector", sourceNodeIds: ["node-copy-panel"] },
    })
    expect(
      clonedMask?.role === "mask"
        ? clonedMask.mask.sourceNodeIds.includes("panel")
        : true
    ).toBe(false)

    const danglingGroups = clone.groups.map((group) =>
      group.role === "mask"
        ? {
            ...group,
            mask: {
              ...group.mask,
              sourceNodeIds: ["panel"] as [string],
            },
          }
        : group
    )
    expect(() =>
      applyCommand(source, {
        id: "reject-dangling-mask-copy",
        type: "duplicate_nodes",
        actor: "human",
        at,
        pageId: "cover",
        nodes: clone.nodes,
        groups: danglingGroups,
        componentInstances: clone.componentInstances,
        bindings: clone.bindings,
        variableBindings: clone.variableBindings,
      })
    ).toThrow("invalid group references")

    const duplicated = applyCommand(source, {
      id: "duplicate-mask-cover",
      type: "duplicate_page",
      actor: "human",
      at,
      outputId: "proposal",
      page: {
        ...source.pages[0]!,
        id: "cover-mask-copy",
        name: "Cover mask copy",
        nodeIds: clone.nodeIds,
      },
      nodes: clone.nodes,
      groups: clone.groups,
      componentInstances: clone.componentInstances,
      bindings: clone.bindings,
      variableBindings: clone.variableBindings,
    })
    expect(validateDocument(duplicated)).toEqual([])

    const partial = captureSemanticFragment(source, "cover", ["panel"])
    expect(partial.groups).toEqual([])
  })

  it("duplicates a page with fresh hierarchy and every shared-field target", () => {
    const source = semanticFixture()
    const fragment = captureSemanticFragment(
      source,
      "cover",
      source.pages[0]?.nodeIds ?? []
    )
    const clone = cloneSemanticFragment(fragment, {
      targetPageId: "cover-copy",
      createId: deterministicId,
    })
    const duplicated = applyCommand(source, {
      id: "duplicate-cover",
      type: "duplicate_page",
      actor: "human",
      at,
      outputId: "proposal",
      page: {
        ...source.pages[0]!,
        id: "cover-copy",
        name: "Cover copy",
        nodeIds: clone.nodeIds,
      },
      nodes: clone.nodes,
      groups: clone.groups,
      componentInstances: clone.componentInstances,
      bindings: clone.bindings,
      variableBindings: clone.variableBindings,
    })

    expect(validateDocument(duplicated)).toEqual([])
    expect(new Set(clone.nodeIds).size).toBe(4)
    expect(clone.nodeIds).not.toEqual(fragment.nodeIds)
    expect(clone.groups).toEqual([
      expect.objectContaining({
        id: "group-copy-cover-group",
        pageId: "cover-copy",
        nodeIds: ["node-copy-panel", "node-copy-title"],
      }),
      expect.objectContaining({
        id: "group-copy-media-group",
        pageId: "cover-copy",
        nodeIds: ["node-copy-portrait", "node-copy-divider"],
        parentGroupId: "group-copy-cover-group",
      }),
    ])
    expect(clone.bindings.map((binding) => binding.property).sort()).toEqual([
      "fill",
      "src",
      "text",
      "visible",
    ])
    expect(
      clone.bindings.every(
        (binding) =>
          !source.bindings.some((candidate) => candidate.id === binding.id) &&
          clone.nodeIds.includes(binding.nodeId)
      )
    ).toBe(true)
    expect(clone.variableBindings).toEqual([
      {
        id: "variable_binding-copy-variable-binding-title-size",
        variableId: "variable-title-size",
        target: {
          kind: "node",
          nodeId: "node-copy-title",
          property: "fontSize",
        },
      },
    ])
    const sourceTitle = source.nodes.find((node) => node.id === "title")
    if (!sourceTitle || sourceTitle.type !== "text") {
      throw new Error("Expected rich title")
    }
    expect(
      clone.nodes.find((node) => node.id === "node-copy-title")
    ).toMatchObject({
      runs: sourceTitle.runs,
      paragraphs: sourceTitle.paragraphs,
      links: sourceTitle.links,
    })

    const manifest = createTemplateManifest(duplicated)
    for (const field of manifest.parameters) {
      expect(field.bindings).toHaveLength(2)
      expect(
        new Set(field.bindings.map((binding) => binding.nodeId)).size
      ).toBe(2)
    }

    const titleUpdated = applyCommand(duplicated, {
      id: "update-title",
      type: "set_field",
      actor: "api",
      at,
      fieldId: "title-field",
      value: "Mira & Dev",
    })
    const portraitUpdated = applyCommand(titleUpdated, {
      id: "update-portrait",
      type: "set_field",
      actor: "api",
      at,
      fieldId: "portrait-field",
      value: "https://assets.example.test/new-couple.png",
    })
    const visibilityUpdated = applyCommand(portraitUpdated, {
      id: "update-visibility",
      type: "set_field",
      actor: "api",
      at,
      fieldId: "visible-field",
      value: false,
    })
    const updated = applyCommand(visibilityUpdated, {
      id: "update-fill",
      type: "set_field",
      actor: "api",
      at,
      fieldId: "fill-field",
      value: "#9a4d32",
    })
    expect(
      updated.nodes
        .filter((node) => node.id === "title" || node.id === "node-copy-title")
        .map((node) => (node.type === "text" ? node.text : null))
    ).toEqual(["Mira & Dev", "Mira & Dev"])
    expect(
      updated.nodes
        .filter(
          (node) => node.id === "portrait" || node.id === "node-copy-portrait"
        )
        .map((node) => (node.type === "image" ? node.src : null))
    ).toEqual([
      "https://assets.example.test/new-couple.png",
      "https://assets.example.test/new-couple.png",
    ])
    expect(
      updated.nodes
        .filter(
          (node) => node.id === "divider" || node.id === "node-copy-divider"
        )
        .map((node) => node.visible)
    ).toEqual([false, false])
    expect(
      updated.nodes
        .filter((node) => node.id === "panel" || node.id === "node-copy-panel")
        .map((node) => (node.type === "rect" ? node.fill : null))
    ).toEqual(["#9a4d32", "#9a4d32"])

    const resized = applyCommand(updated, {
      id: "update-title-size-variable",
      type: "update_variable",
      actor: "human",
      at,
      variableId: "variable-title-size",
      patch: { value: 72 },
    })
    expect(
      resized.nodes
        .filter((node) => node.id === "title" || node.id === "node-copy-title")
        .map((node) => (node.type === "text" ? node.fontSize : null))
    ).toEqual([72, 72])
  })

  it("keeps complete nested groups and detaches partial selections", () => {
    const source = semanticFixture()
    const full = captureSemanticFragment(source, "cover", [
      "panel",
      "title",
      "portrait",
      "divider",
    ])
    expect(full.groups.map((group) => group.id)).toEqual([
      "cover-group",
      "media-group",
    ])

    const partial = captureSemanticFragment(source, "cover", ["portrait"])
    expect(partial.groups).toEqual([])
    expect(partial.bindings).toEqual([
      expect.objectContaining({
        id: "portrait-binding",
        fieldId: "portrait-field",
      }),
    ])
  })

  it("captures clipboard content as a snapshot before later source edits", () => {
    const source = semanticFixture()
    const clipboard = captureSemanticFragment(source, "cover", ["title"])
    const edited = applyCommand(source, {
      id: "edit-source-title",
      type: "update_node",
      actor: "human",
      at,
      nodeId: "title",
      patch: { name: "Edited after copy" },
    })
    expect(edited.nodes.find((node) => node.id === "title")?.name).toBe(
      "Edited after copy"
    )

    const pasted = cloneSemanticFragment(clipboard, {
      targetPageId: "cover",
      offsetX: 24,
      offsetY: 24,
      createId: deterministicId,
    })
    expect(pasted.nodes[0]).toMatchObject({
      name: "Title",
      x: 104,
      y: 104,
    })
    expect(pasted.bindings[0]).toMatchObject({
      fieldId: "title-field",
      nodeId: "node-copy-title",
    })
  })
})
