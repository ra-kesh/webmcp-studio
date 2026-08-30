import { describe, expect, it } from "vitest"
import {
  applyCommand,
  northstarSeed,
  sceneNodeSchema,
  validateDocument,
} from "../src"

describe("canonical document commands", () => {
  it("clears stale ranges when replacing text and canonicalizes supplied runs", () => {
    const document = structuredClone(northstarSeed)
    const title = document.nodes.find((node) => node.id === "cover-eyebrow")
    if (!title || title.type !== "text") throw new Error("Expected cover title")
    title.runs = [{ start: 0, end: 5, style: { fontWeight: 700 } }]
    title.links = [
      { start: 0, end: 5, target: "https://example.com", newTab: true },
    ]

    const replaced = applyCommand(document, {
      id: "cmd-replace-rich-text",
      type: "update_node",
      actor: "human",
      at: "2026-08-26T09:29:00.000Z",
      nodeId: title.id,
      patch: { text: "New title" },
    })
    expect(replaced.nodes.find((node) => node.id === title.id)).toMatchObject({
      text: "New title",
      runs: [],
      paragraphs: [],
      links: [],
    })

    const styled = applyCommand(replaced, {
      id: "cmd-style-rich-text",
      type: "update_node",
      actor: "human",
      at: "2026-08-26T09:29:30.000Z",
      nodeId: title.id,
      patch: {
        runs: [
          { start: 4, end: 9, style: { fontWeight: 700 } },
          { start: 0, end: 4, style: { fontWeight: 700 } },
        ],
      },
    })
    expect(styled.nodes.find((node) => node.id === title.id)).toMatchObject({
      runs: [{ start: 0, end: 9, style: { fontWeight: 700 } }],
    })
  })

  it("rejects a rich-text update whose ranges split a surrogate pair", () => {
    const document = structuredClone(northstarSeed)
    const title = document.nodes.find((node) => node.id === "cover-eyebrow")
    if (!title || title.type !== "text") throw new Error("Expected cover title")

    expect(() =>
      applyCommand(document, {
        id: "cmd-invalid-rich-text",
        type: "update_node",
        actor: "human",
        at: "2026-08-26T09:29:00.000Z",
        nodeId: title.id,
        patch: {
          text: "A😀B",
          runs: [{ start: 1, end: 2, style: { fontWeight: 700 } }],
        },
      })
    ).toThrow("splits a surrogate pair")
  })

  it("applies one shared field to every bound output", () => {
    const document = structuredClone(northstarSeed)
    const packageName = document.nodes.find(
      (node) => node.id === "package-name"
    )
    if (!packageName || packageName.type !== "text") {
      throw new Error("Expected package name")
    }
    packageName.runs = [{ start: 0, end: 3, style: { fontWeight: 700 } }]
    const updated = applyCommand(document, {
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
      runs: [],
      paragraphs: [],
      links: [],
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
        agentDescription: "Controls cover panel visibility",
        validation: {},
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
        agentDescription: "Controls cover panel visibility",
        validation: {},
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
          agentDescription: "Guest count",
          validation: {},
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

  it("defaults image nodes to centered fill placement and a rectangular frame", () => {
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
      alt: "",
      decorative: false,
    })
  })

  it("updates a bound managed image source and public asset ID atomically", () => {
    const document = structuredClone(northstarSeed)
    document.nodes.push({
      id: "bound-managed-image",
      type: "image",
      name: "Bound managed image",
      assetId: "asset-aaaaaaaaaa",
      src: "asset:managed/asset-aaaaaaaaaa",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
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
      alt: "",
      decorative: false,
    })
    document.pages[0]!.nodeIds.push("bound-managed-image")
    document.fields.push({
      id: "bound_managed_asset",
      key: "bound_managed_asset",
      label: "Bound managed asset",
      type: "asset",
      required: true,
      defaultValue: "asset:managed/asset-aaaaaaaaaa",
      agentDescription: "",
      validation: {},
    })
    document.fieldValues.bound_managed_asset = "asset:managed/asset-aaaaaaaaaa"
    document.bindings.push({
      id: "bind-managed-image",
      fieldId: "bound_managed_asset",
      nodeId: "bound-managed-image",
      property: "src",
    })

    const applied = applyCommand(document, {
      id: "cmd-update-bound-managed-image",
      type: "set_field",
      actor: "human",
      at: "2026-08-28T12:00:00.000Z",
      fieldId: "bound_managed_asset",
      value: "asset:managed/asset-bbbbbbbbbb",
    })

    expect(
      applied.nodes.find((node) => node.id === "bound-managed-image")
    ).toMatchObject({
      assetId: "asset-bbbbbbbbbb",
      src: "asset:managed/asset-bbbbbbbbbb",
    })
    expect(sceneNodeSchema.safeParse(applied.nodes.at(-1)).success).toBe(true)
  })

  it("commits typed image placement and frame-mask commands", () => {
    const image = sceneNodeSchema.parse({
      id: "editable-image",
      type: "image",
      name: "Editable image",
      assetId: "asset-editable",
      src: "https://assets.example.test/editable.png",
      x: 0,
      y: 0,
      width: 320,
      height: 180,
    })
    const withImage = applyCommand(northstarSeed, {
      id: "add-editable-image",
      type: "add_node",
      actor: "human",
      at: "2026-08-28T12:00:00.000Z",
      pageId: "cover",
      node: image,
    })
    const placed = applyCommand(withImage, {
      id: "place-editable-image",
      type: "set_image_placement",
      actor: "human",
      at: "2026-08-28T12:01:00.000Z",
      nodeId: image.id,
      placement: {
        mode: "manual",
        focalX: 0.25,
        focalY: 0.75,
        zoom: 1.4,
        rotation: 12,
        flipX: true,
        flipY: false,
      },
    })
    const masked = applyCommand(placed, {
      id: "mask-editable-image",
      type: "set_image_frame_mask",
      actor: "human",
      at: "2026-08-28T12:02:00.000Z",
      nodeId: image.id,
      frameMask: { shape: "rounded_rectangle", radius: 0.2 },
    })

    expect(masked.nodes.find((node) => node.id === image.id)).toMatchObject({
      placement: {
        mode: "manual",
        focalX: 0.25,
        focalY: 0.75,
        zoom: 1.4,
        rotation: 12,
        flipX: true,
        flipY: false,
      },
      frameMask: { shape: "rounded_rectangle", radius: 0.2 },
    })
    expect(masked.revision).toBe(withImage.revision + 2)
  })

  it("replaces only unbound image sources and preserves presentation", () => {
    const image = sceneNodeSchema.parse({
      id: "replacement-image",
      type: "image",
      name: "Replacement image",
      assetId: "asset-before",
      src: "https://assets.example.test/before.png",
      alt: "Original description",
      placement: {
        mode: "manual",
        focalX: 0.3,
        focalY: 0.6,
        zoom: 1.25,
        rotation: -8,
        flipX: false,
        flipY: true,
      },
      frameMask: { shape: "ellipse" },
      x: 10,
      y: 20,
      width: 320,
      height: 180,
    })
    const withImage = applyCommand(northstarSeed, {
      id: "add-replacement-image",
      type: "add_node",
      actor: "human",
      at: "2026-08-28T12:00:00.000Z",
      pageId: "cover",
      node: image,
    })
    const replaced = applyCommand(withImage, {
      id: "replace-image-source",
      type: "replace_image_source",
      actor: "human",
      at: "2026-08-28T12:01:00.000Z",
      nodeId: image.id,
      assetId: "asset-after",
      src: "https://assets.example.test/after.png",
    })

    expect(replaced.nodes.find((node) => node.id === image.id)).toEqual({
      ...image,
      assetId: "asset-after",
      src: "https://assets.example.test/after.png",
    })
  })

  it("records direct alt edits as authored provenance", () => {
    const image = sceneNodeSchema.parse({
      id: "alt-provenance-image",
      type: "image",
      name: "Alt provenance image",
      assetId: "asset-before",
      src: "https://assets.example.test/before.png",
      alt: "Generated filename.png",
      altProvenance: "generated",
      x: 10,
      y: 20,
      width: 320,
      height: 180,
    })
    const withImage = applyCommand(northstarSeed, {
      id: "add-alt-provenance-image",
      type: "add_node",
      actor: "human",
      at: "2026-08-28T12:00:00.000Z",
      pageId: "cover",
      node: image,
    })
    const updated = applyCommand(withImage, {
      id: "author-alt-provenance-image",
      type: "update_node",
      actor: "human",
      at: "2026-08-28T12:01:00.000Z",
      nodeId: image.id,
      patch: { alt: "A couple walking beneath marigold petals" },
    })

    expect(updated.nodes.find((node) => node.id === image.id)).toMatchObject({
      alt: "A couple walking beneath marigold petals",
      altProvenance: "authored",
    })
  })

  it("keeps generated provenance when replacement supplies a new generated alt", () => {
    const image = sceneNodeSchema.parse({
      id: "generated-alt-image",
      type: "image",
      name: "Generated alt image",
      assetId: "asset-before",
      src: "https://assets.example.test/before.png",
      alt: "before.png",
      altProvenance: "generated",
      x: 10,
      y: 20,
      width: 320,
      height: 180,
    })
    const withImage = applyCommand(northstarSeed, {
      id: "add-generated-alt-image",
      type: "add_node",
      actor: "human",
      at: "2026-08-28T12:00:00.000Z",
      pageId: "cover",
      node: image,
    })
    const replaced = applyCommand(withImage, {
      id: "replace-generated-alt-image",
      type: "replace_image_source",
      actor: "human",
      at: "2026-08-28T12:01:00.000Z",
      nodeId: image.id,
      assetId: "asset-after",
      src: "https://assets.example.test/after.png",
      alt: "after.png",
      altProvenance: "generated",
    })

    expect(replaced.nodes.find((node) => node.id === image.id)).toMatchObject({
      assetId: "asset-after",
      src: "https://assets.example.test/after.png",
      alt: "after.png",
      altProvenance: "generated",
    })
  })

  it("defaults replacement-provided alt to authored provenance", () => {
    const image = sceneNodeSchema.parse({
      id: "replacement-authored-alt-image",
      type: "image",
      name: "Replacement authored alt image",
      assetId: "asset-before",
      src: "https://assets.example.test/before.png",
      alt: "before.png",
      altProvenance: "generated",
      x: 10,
      y: 20,
      width: 320,
      height: 180,
    })
    const withImage = applyCommand(northstarSeed, {
      id: "add-replacement-authored-alt-image",
      type: "add_node",
      actor: "human",
      at: "2026-08-28T12:00:00.000Z",
      pageId: "cover",
      node: image,
    })
    const replaced = applyCommand(withImage, {
      id: "replace-authored-alt-image",
      type: "replace_image_source",
      actor: "human",
      at: "2026-08-28T12:01:00.000Z",
      nodeId: image.id,
      assetId: "asset-after",
      src: "https://assets.example.test/after.png",
      alt: "The couple walking together",
    })

    expect(replaced.nodes.find((node) => node.id === image.id)).toMatchObject({
      alt: "The couple walking together",
      altProvenance: "authored",
    })
  })

  it("blocks source replacement when an asset field owns the layer", () => {
    const image = sceneNodeSchema.parse({
      id: "source-bound-image",
      type: "image",
      name: "Source-bound image",
      assetId: "asset-aaaaaaaaaa",
      src: "asset:managed/asset-aaaaaaaaaa",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    })
    const document = structuredClone(northstarSeed)
    document.nodes.push(image)
    document.pages[0]!.nodeIds.push(image.id)
    document.fields.push({
      id: "portrait_asset",
      key: "portrait_asset",
      label: "Portrait asset",
      type: "asset",
      required: true,
      defaultValue: "asset:managed/asset-aaaaaaaaaa",
      agentDescription: "",
      validation: {},
    })
    document.fieldValues.portrait_asset = "asset:managed/asset-aaaaaaaaaa"
    document.bindings.push({
      id: "bind-portrait-asset",
      fieldId: "portrait_asset",
      nodeId: image.id,
      property: "src",
    })

    expect(() =>
      applyCommand(document, {
        id: "replace-source-bound-image",
        type: "replace_image_source",
        actor: "human",
        at: "2026-08-28T12:01:00.000Z",
        nodeId: image.id,
        assetId: "asset-bbbbbbbbbb",
        src: "asset:managed/asset-bbbbbbbbbb",
      })
    ).toThrow("Portrait asset controls this layer")
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

  it("reorders a complete layer block while preserving its internal paint order", () => {
    const page = northstarSeed.pages.find(
      (candidate) => candidate.id === "cover"
    )
    expect(page).toBeDefined()
    const block = page?.nodeIds.slice(1, 4) ?? []
    const updated = applyCommand(northstarSeed, {
      id: "cmd-reorder-cover-block",
      type: "reorder_nodes",
      actor: "human",
      at: "2026-08-26T09:30:00.000Z",
      pageId: "cover",
      nodeIds: block,
      toIndex: 0,
    })

    expect(
      updated.pages
        .find((candidate) => candidate.id === "cover")
        ?.nodeIds.slice(0, 3)
    ).toEqual(block)
    expect(
      validateDocument(updated).filter((issue) => issue.severity === "error")
    ).toEqual([])
  })

  it("reparents layers atomically and keeps every group stack contiguous", () => {
    const grouped = applyCommand(northstarSeed, {
      id: "cmd-group-cover-content",
      type: "group_nodes",
      actor: "human",
      at: "2026-08-26T09:30:00.000Z",
      groupId: "cover-content",
      pageId: "cover",
      name: "Cover content",
      nodeIds: ["cover-eyebrow", "cover-title"],
    })
    const reparented = applyCommand(grouped, {
      id: "cmd-reparent-cover-date",
      type: "reparent_node",
      actor: "human",
      at: "2026-08-26T09:31:00.000Z",
      pageId: "cover",
      nodeId: "cover-date",
      targetGroupId: "cover-content",
    })
    const pageOrder =
      reparented.pages.find((page) => page.id === "cover")?.nodeIds ?? []
    const group = reparented.groups.find(
      (candidate) => candidate.id === "cover-content"
    )
    const indexes = (group?.nodeIds ?? [])
      .map((nodeId) => pageOrder.indexOf(nodeId))
      .sort((a, b) => a - b)

    expect(group?.nodeIds).toContain("cover-date")
    expect(indexes).toEqual([
      indexes[0],
      (indexes[0] ?? 0) + 1,
      (indexes[0] ?? 0) + 2,
    ])
    expect(
      validateDocument(reparented).filter((issue) => issue.severity === "error")
    ).toEqual([])

    const rooted = applyCommand(reparented, {
      id: "cmd-root-cover-date",
      type: "reparent_node",
      actor: "human",
      at: "2026-08-26T09:32:00.000Z",
      pageId: "cover",
      nodeId: "cover-date",
    })
    expect(
      rooted.groups.find((candidate) => candidate.id === "cover-content")
        ?.nodeIds
    ).not.toContain("cover-date")
  })

  it("rejects circular and cross-page group reparenting", () => {
    const child = applyCommand(northstarSeed, {
      id: "cmd-group-child",
      type: "group_nodes",
      actor: "human",
      at: "2026-08-26T09:30:00.000Z",
      groupId: "child-group",
      pageId: "cover",
      name: "Child group",
      nodeIds: ["cover-eyebrow", "cover-title"],
    })
    const nested = applyCommand(child, {
      id: "cmd-group-parent",
      type: "group_nodes",
      actor: "human",
      at: "2026-08-26T09:31:00.000Z",
      groupId: "parent-group",
      pageId: "cover",
      name: "Parent group",
      nodeIds: ["cover-eyebrow", "cover-title", "cover-date"],
    })

    expect(() =>
      applyCommand(nested, {
        id: "cmd-cycle-group",
        type: "reparent_group",
        actor: "human",
        at: "2026-08-26T09:32:00.000Z",
        pageId: "cover",
        groupId: "parent-group",
        targetGroupId: "child-group",
      })
    ).toThrow("descendants")

    expect(() =>
      applyCommand(nested, {
        id: "cmd-cross-page-layer",
        type: "reparent_node",
        actor: "human",
        at: "2026-08-26T09:33:00.000Z",
        pageId: "story",
        nodeId: "story-title",
        targetGroupId: "parent-group",
      })
    ).toThrow("another page")
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

  it("recursively prunes empty group ancestors after removing their last node", () => {
    const nested = {
      ...northstarSeed,
      groups: [
        {
          id: "leaf-group",
          pageId: "cover",
          name: "Leaf",
          nodeIds: ["cover-title"],
          parentGroupId: "middle-group",
        },
        {
          id: "middle-group",
          pageId: "cover",
          name: "Middle",
          nodeIds: [],
          parentGroupId: "root-group",
        },
        {
          id: "root-group",
          pageId: "cover",
          name: "Root",
          nodeIds: [],
        },
      ],
    }

    const removed = applyCommand(nested, {
      id: "cmd-remove-last-nested-node",
      type: "remove_node",
      actor: "human",
      at: "2026-08-26T09:33:00.000Z",
      nodeId: "cover-title",
    })

    expect(removed.groups).toEqual([])
    expect(
      validateDocument(removed).filter((issue) => issue.severity === "error")
    ).toEqual([])
  })

  it("preserves an empty parent while it still contains a child group", () => {
    const nested = {
      ...northstarSeed,
      groups: [
        {
          id: "child-group",
          pageId: "cover",
          name: "Child",
          nodeIds: ["cover-title"],
          parentGroupId: "parent-group",
        },
        {
          id: "parent-group",
          pageId: "cover",
          name: "Parent",
          nodeIds: ["cover-date"],
        },
      ],
    }

    const removed = applyCommand(nested, {
      id: "cmd-remove-parent-direct-node",
      type: "remove_node",
      actor: "human",
      at: "2026-08-26T09:34:00.000Z",
      nodeId: "cover-date",
    })

    expect(removed.groups).toEqual([
      {
        id: "child-group",
        pageId: "cover",
        name: "Child",
        nodeIds: ["cover-title"],
        parentGroupId: "parent-group",
      },
      {
        id: "parent-group",
        pageId: "cover",
        name: "Parent",
        nodeIds: [],
      },
    ])
    expect(
      validateDocument(removed).filter((issue) => issue.severity === "error")
    ).toEqual([])
  })

  it("prunes the emptied source group after reparenting a node", () => {
    const grouped = {
      ...northstarSeed,
      groups: [
        {
          id: "source-group",
          pageId: "cover",
          name: "Source",
          nodeIds: ["cover-title"],
        },
        {
          id: "target-group",
          pageId: "cover",
          name: "Target",
          nodeIds: ["cover-date"],
        },
      ],
    }

    const reparented = applyCommand(grouped, {
      id: "cmd-reparent-and-prune-source",
      type: "reparent_node",
      actor: "human",
      at: "2026-08-26T09:35:00.000Z",
      pageId: "cover",
      nodeId: "cover-title",
      targetGroupId: "target-group",
    })

    expect(reparented.groups).toEqual([
      {
        id: "target-group",
        pageId: "cover",
        name: "Target",
        nodeIds: ["cover-date", "cover-title"],
      },
    ])
    expect(
      validateDocument(reparented).filter((issue) => issue.severity === "error")
    ).toEqual([])
  })

  it("recursively prunes the old ancestry after reparenting a group", () => {
    const nested = {
      ...northstarSeed,
      groups: [
        {
          id: "moving-group",
          pageId: "cover",
          name: "Moving",
          nodeIds: ["cover-title"],
          parentGroupId: "old-parent",
        },
        {
          id: "old-parent",
          pageId: "cover",
          name: "Old parent",
          nodeIds: [],
          parentGroupId: "old-root",
        },
        {
          id: "old-root",
          pageId: "cover",
          name: "Old root",
          nodeIds: [],
        },
        {
          id: "target-group",
          pageId: "cover",
          name: "Target",
          nodeIds: ["cover-date"],
        },
      ],
    }

    const reparented = applyCommand(nested, {
      id: "cmd-reparent-group-and-prune-ancestry",
      type: "reparent_group",
      actor: "human",
      at: "2026-08-26T09:36:00.000Z",
      pageId: "cover",
      groupId: "moving-group",
      targetGroupId: "target-group",
    })

    expect(reparented.groups.map((group) => group.id)).toEqual([
      "moving-group",
      "target-group",
    ])
    expect(
      reparented.groups.find((group) => group.id === "moving-group")
        ?.parentGroupId
    ).toBe("target-group")
    expect(
      validateDocument(reparented).filter((issue) => issue.severity === "error")
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
          runs: [],
          paragraphs: [],
          links: [],
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
          italic: false,
          decoration: "none",
          lineHeight: 1.1,
          letterSpacing: -1,
          align: "center",
          sizingMode: "fixed",
        },
      ],
      groups: [],
      componentInstances: [],
      bindings: [
        {
          id: "bind-agent-story-couple",
          fieldId: "couple_names",
          nodeId: "agent-story-title",
          property: "text",
        },
      ],
      variableBindings: [],
    })

    expect(adapted.outputs.at(-1)?.id).toBe("agent-story")
    expect(adapted.pages.at(-1)?.nodeIds).toEqual(["agent-story-title"])
    expect(adapted.nodes.at(-1)).toMatchObject({ text: "Aditi & Kabir" })
    expect(adapted.bindings.at(-1)?.nodeId).toBe("agent-story-title")
  })
})
