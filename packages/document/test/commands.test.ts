import { describe, expect, it } from "vitest"
import {
  applyCommand,
  northstarSeed,
  sceneNodeSchema,
  validateDocument,
} from "../src"

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

  it("creates, edits, and removes typed shared fields", () => {
    const added = applyCommand(northstarSeed, {
      id: "cmd-add-visibility-field",
      type: "add_field",
      actor: "human",
      at: "2026-08-26T09:30:00.000Z",
      field: {
        id: "show-cover-panel",
        key: "show_cover_panel",
        label: "Show cover panel",
        type: "boolean",
        required: false,
        defaultValue: true,
      },
    })
    expect(added.fieldValues["show-cover-panel"]).toBe(true)

    const updated = applyCommand(added, {
      id: "cmd-update-visibility-field",
      type: "update_field",
      actor: "human",
      at: "2026-08-26T09:31:00.000Z",
      fieldId: "show-cover-panel",
      patch: { label: "Display cover panel", required: true },
    })
    expect(
      updated.fields.find((field) => field.id === "show-cover-panel")
    ).toMatchObject({ label: "Display cover panel", required: true })

    const removed = applyCommand(updated, {
      id: "cmd-remove-visibility-field",
      type: "remove_field",
      actor: "human",
      at: "2026-08-26T09:32:00.000Z",
      fieldId: "show-cover-panel",
    })
    expect(
      removed.fields.some((field) => field.id === "show-cover-panel")
    ).toBe(false)
    expect(removed.fieldValues["show-cover-panel"]).toBeUndefined()
  })

  it("binds and unbinds compatible layer properties", () => {
    const withField = applyCommand(northstarSeed, {
      id: "cmd-add-panel-field",
      type: "add_field",
      actor: "human",
      at: "2026-08-26T09:30:00.000Z",
      field: {
        id: "show-cover-panel",
        key: "show_cover_panel",
        label: "Show cover panel",
        type: "boolean",
        required: false,
        defaultValue: true,
      },
    })
    const bound = applyCommand(withField, {
      id: "cmd-bind-panel-field",
      type: "bind_field",
      actor: "human",
      at: "2026-08-26T09:31:00.000Z",
      binding: {
        id: "bind-cover-panel-visible",
        fieldId: "show-cover-panel",
        nodeId: "cover-panel",
        property: "visible",
      },
    })
    const hidden = applyCommand(bound, {
      id: "cmd-hide-panel-field",
      type: "set_field",
      actor: "human",
      at: "2026-08-26T09:32:00.000Z",
      fieldId: "show-cover-panel",
      value: false,
    })
    expect(
      hidden.nodes.find((node) => node.id === "cover-panel")?.visible
    ).toBe(false)

    const authoritative = applyCommand(hidden, {
      id: "cmd-edit-bound-panel",
      type: "update_node",
      actor: "human",
      at: "2026-08-26T09:33:00.000Z",
      nodeId: "cover-panel",
      patch: { visible: true },
    })
    expect(
      authoritative.nodes.find((node) => node.id === "cover-panel")?.visible
    ).toBe(false)

    const unbound = applyCommand(authoritative, {
      id: "cmd-unbind-panel-field",
      type: "unbind_field",
      actor: "human",
      at: "2026-08-26T09:34:00.000Z",
      bindingId: "bind-cover-panel-visible",
    })
    expect(unbound.bindings).not.toContainEqual(
      expect.objectContaining({ id: "bind-cover-panel-visible" })
    )
  })

  it("rejects invalid field values and incompatible bindings", () => {
    expect(() =>
      applyCommand(northstarSeed, {
        id: "cmd-invalid-number-field",
        type: "add_field",
        actor: "human",
        at: "2026-08-26T09:30:00.000Z",
        field: {
          id: "guest-count",
          key: "guest_count",
          label: "Guest count",
          type: "number",
          required: false,
          defaultValue: "two hundred",
        },
      })
    ).toThrow("Invalid default value")

    expect(() =>
      applyCommand(northstarSeed, {
        id: "cmd-invalid-binding",
        type: "bind_field",
        actor: "human",
        at: "2026-08-26T09:30:00.000Z",
        binding: {
          id: "bind-date-to-image",
          fieldId: "event_date",
          nodeId: "cover-panel",
          property: "visible",
        },
      })
    ).toThrow("cannot bind")
  })

  it("ships a structurally valid synthetic demo document", () => {
    const structuralErrors = validateDocument(northstarSeed).filter(
      (issue) => issue.severity === "error"
    )
    expect(structuralErrors).toEqual([])
  })

  it("normalizes legacy image nodes to a centered crop", () => {
    const image = sceneNodeSchema.parse({
      id: "image-one",
      type: "image",
      name: "Editorial image",
      assetId: "asset-one",
      src: "https://example.com/image.jpg",
      x: 0,
      y: 0,
      width: 640,
      height: 480,
    })

    expect(image).toMatchObject({
      fit: "cover",
      cropX: 0.5,
      cropY: 0.5,
      alt: "",
    })
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

  it("accepts every authoring primitive through the canonical command path", () => {
    const primitives = [
      {
        id: "test-ellipse",
        type: "ellipse" as const,
        name: "Ellipse",
        x: 40,
        y: 50,
        width: 200,
        height: 160,
        rotation: 12,
        opacity: 1,
        visible: true,
        locked: false,
        fill: "#d9c9b2",
        stroke: "#1e2622",
        strokeWidth: 3,
      },
      {
        id: "test-line",
        type: "line" as const,
        name: "Line",
        x: 60,
        y: 80,
        width: 320,
        height: 1,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        stroke: "#1e2622",
        strokeWidth: 4,
      },
      {
        id: "test-icon",
        type: "icon" as const,
        name: "Heart",
        x: 100,
        y: 120,
        width: 180,
        height: 180,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        path: "M12 21 3 12 12 3 21 12Z",
        viewBox: "0 0 24 24",
        fill: "#8a5d38",
        strokeWidth: 0,
      },
    ]

    const updated = primitives.reduce(
      (document, node, index) =>
        applyCommand(document, {
          id: `cmd-add-primitive-${index}`,
          type: "add_node",
          actor: "human",
          at: "2026-08-26T09:30:00.000Z",
          pageId: "cover",
          node,
        }),
      northstarSeed
    )

    expect(updated.revision).toBe(northstarSeed.revision + primitives.length)
    expect(updated.nodes.slice(-3).map((node) => node.type)).toEqual([
      "ellipse",
      "line",
      "icon",
    ])
    expect(
      validateDocument(updated).filter((issue) => issue.severity === "error")
    ).toEqual([])
  })

  it("stores groups canonically without changing renderer layer order", () => {
    const grouped = applyCommand(northstarSeed, {
      id: "cmd-group-cover-title",
      type: "group_nodes",
      actor: "human",
      at: "2026-08-26T09:30:00.000Z",
      groupId: "cover-heading-group",
      pageId: "cover",
      name: "Cover heading",
      nodeIds: ["cover-eyebrow", "cover-title", "cover-date"],
    })

    expect(grouped.groups).toContainEqual({
      id: "cover-heading-group",
      pageId: "cover",
      name: "Cover heading",
      nodeIds: ["cover-eyebrow", "cover-title", "cover-date"],
    })
    expect(grouped.pages.find((page) => page.id === "cover")?.nodeIds).toEqual(
      northstarSeed.pages.find((page) => page.id === "cover")?.nodeIds
    )

    const ungrouped = applyCommand(grouped, {
      id: "cmd-ungroup-cover-title",
      type: "ungroup_nodes",
      actor: "human",
      at: "2026-08-26T09:31:00.000Z",
      groupId: "cover-heading-group",
    })
    expect(ungrouped.groups).toEqual([])
  })

  it("supports nested canonical groups", () => {
    const first = applyCommand(northstarSeed, {
      id: "cmd-group-cover-copy",
      type: "group_nodes",
      actor: "human",
      at: "2026-08-26T09:30:00.000Z",
      groupId: "cover-copy-group",
      pageId: "cover",
      name: "Cover copy",
      nodeIds: ["cover-eyebrow", "cover-title"],
    })
    const second = applyCommand(first, {
      id: "cmd-group-cover-meta",
      type: "group_nodes",
      actor: "human",
      at: "2026-08-26T09:31:00.000Z",
      groupId: "cover-meta-group",
      pageId: "cover",
      name: "Cover meta",
      nodeIds: ["cover-date", "cover-studio"],
    })
    const nested = applyCommand(second, {
      id: "cmd-group-cover-content",
      type: "group_nodes",
      actor: "human",
      at: "2026-08-26T09:32:00.000Z",
      groupId: "cover-content-group",
      pageId: "cover",
      name: "Cover content",
      nodeIds: ["cover-eyebrow", "cover-title", "cover-date", "cover-studio"],
    })

    expect(
      nested.groups.filter(
        (group) => group.parentGroupId === "cover-content-group"
      )
    ).toHaveLength(2)
    expect(
      nested.groups.find((group) => group.id === "cover-content-group")?.nodeIds
    ).toEqual([])
  })

  it("adds, updates, reorders, and removes pages canonically", () => {
    const page = {
      id: "proposal-extra-page",
      outputId: "proposal",
      name: "Extra page",
      width: 1240,
      height: 1754,
      background: "#ffffff",
      nodeIds: [],
    }
    const added = applyCommand(northstarSeed, {
      id: "cmd-add-page",
      type: "add_page",
      actor: "human",
      at: "2026-08-26T09:30:00.000Z",
      outputId: "proposal",
      page,
    })
    expect(added.outputs[0]?.pageIds.at(-1)).toBe(page.id)

    const updated = applyCommand(added, {
      id: "cmd-update-page",
      type: "update_page",
      actor: "human",
      at: "2026-08-26T09:31:00.000Z",
      pageId: page.id,
      patch: { name: "Renamed page", width: 1080, height: 1080 },
    })
    expect(
      updated.pages.find((candidate) => candidate.id === page.id)
    ).toMatchObject({
      name: "Renamed page",
      width: 1080,
      height: 1080,
    })

    const reordered = applyCommand(updated, {
      id: "cmd-reorder-page",
      type: "reorder_page",
      actor: "human",
      at: "2026-08-26T09:32:00.000Z",
      outputId: "proposal",
      pageId: page.id,
      toIndex: 0,
    })
    expect(reordered.outputs[0]?.pageIds[0]).toBe(page.id)

    const removed = applyCommand(reordered, {
      id: "cmd-remove-page",
      type: "remove_page",
      actor: "human",
      at: "2026-08-26T09:33:00.000Z",
      pageId: page.id,
    })
    expect(removed.pages.some((candidate) => candidate.id === page.id)).toBe(
      false
    )
  })

  it("adds and removes a named output with its first page", () => {
    const added = applyCommand(northstarSeed, {
      id: "cmd-add-output",
      type: "add_output",
      actor: "human",
      at: "2026-08-26T09:30:00.000Z",
      output: {
        id: "social-story",
        name: "Social story",
        kind: "square",
        pageIds: ["social-story-page"],
        exportFormats: ["png"],
      },
      page: {
        id: "social-story-page",
        outputId: "social-story",
        name: "Page 1",
        width: 1080,
        height: 1920,
        background: "#ffffff",
        nodeIds: [],
      },
    })
    expect(added.outputs.at(-1)?.name).toBe("Social story")

    const removed = applyCommand(added, {
      id: "cmd-remove-output",
      type: "remove_output",
      actor: "human",
      at: "2026-08-26T09:31:00.000Z",
      outputId: "social-story",
    })
    expect(removed.outputs).toHaveLength(northstarSeed.outputs.length)
    expect(removed.pages.some((page) => page.outputId === "social-story")).toBe(
      false
    )
  })

  it("adds an adapted output atomically with layers and shared bindings", () => {
    const adapted = applyCommand(northstarSeed, {
      id: "cmd-add-adapted-output",
      type: "add_output_variant",
      actor: "agent",
      at: "2026-08-26T09:30:00.000Z",
      output: {
        id: "agent-story",
        name: "Agent story",
        kind: "whatsapp_portrait",
        pageIds: ["agent-story-page"],
        exportFormats: ["png"],
      },
      page: {
        id: "agent-story-page",
        outputId: "agent-story",
        name: "Story",
        width: 1080,
        height: 1920,
        background: "#ffffff",
        nodeIds: ["agent-story-title"],
      },
      nodes: [
        {
          id: "agent-story-title",
          type: "text",
          name: "Couple names",
          text: "Placeholder",
          x: 96,
          y: 120,
          width: 888,
          height: 120,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
          color: "#111111",
          fontFamily: "Geist Variable",
          fontSize: 64,
          fontWeight: 600,
          lineHeight: 1.1,
          letterSpacing: -1,
          align: "center",
        },
      ],
      groups: [],
      bindings: [
        {
          id: "bind-agent-story-couple",
          fieldId: "couple_names",
          nodeId: "agent-story-title",
          property: "text",
        },
      ],
    })

    expect(adapted.outputs.at(-1)?.id).toBe("agent-story")
    expect(adapted.pages.at(-1)?.nodeIds).toEqual(["agent-story-title"])
    expect(adapted.nodes.at(-1)).toMatchObject({ text: "Aditi & Kabir" })
    expect(adapted.bindings.at(-1)?.nodeId).toBe("agent-story-title")
  })
})
