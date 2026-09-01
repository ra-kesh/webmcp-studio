import { describe, expect, it } from "vitest"
import { applyCommand } from "@webmcp/document"
import type { ChangeOperation } from "@webmcp/document"
import { studioAssets } from "./asset-catalog"
import { studioMediaManifest } from "../../content/library/media/manifest"
import { quotationStarter } from "./quotation-starter"
import { operationDetails } from "./review-operation-details"

function documentWithImage() {
  const asset = studioAssets[0]
  const page = quotationStarter.document.pages[0]
  return applyCommand(quotationStarter.document, {
    id: "add-review-image",
    type: "add_node",
    actor: "human",
    at: "2026-08-28T14:59:00.000Z",
    pageId: page.id,
    node: {
      id: "review-image",
      type: "image",
      name: "Review image",
      x: 40,
      y: 40,
      width: 240,
      height: 240,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      constraints: { horizontal: "min", vertical: "min" },
      assetId: `library-${asset.id}`,
      src: asset.src,
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
      decorative: false,
      alt: asset.name,
    },
  })
}

describe("review operation details", () => {
  const exactSources = [
    {
      label: "curated",
      assetId: studioMediaManifest[0].id,
      src: studioMediaManifest[0].resourcePath,
      expected: `${studioMediaManifest[0].name} · Curated Studio asset`,
    },
    {
      label: "managed",
      assetId: "asset-review-managed-1",
      src: "asset:managed/asset-review-managed-1",
      expected: "Workspace-managed image (asset-review-managed-1)",
    },
    {
      label: "local",
      assetId: "local-review-image-1",
      src: "asset:local/local-review-image-1",
      expected: "Device-local image (local-review-image-1)",
    },
  ] as const

  it("names both axes of a constraint proposal", () => {
    const document = quotationStarter.document
    const node = document.nodes[0]!
    const operation: ChangeOperation = {
      id: "constraint-operation",
      status: "pending",
      summary: "Pin the layer",
      command: {
        id: "constraint-command",
        type: "update_node",
        actor: "agent",
        at: "2026-09-01T09:20:00.000Z",
        nodeId: node.id,
        patch: {
          constraints: { horizontal: "max", vertical: "stretch" },
        },
      },
    }

    const details = operationDetails(document, operation)

    expect(details.before).toContain("Horizontal: min · Vertical: min")
    expect(details.after).toContain("Horizontal: max · Vertical: stretch")
  })

  it("omits private image sources and names the approved catalog asset", () => {
    const document = documentWithImage()
    const image = document.nodes.find((node) => node.type === "image")
    const asset = studioAssets[1]
    if (!image) throw new Error("The image fixture is unavailable")
    const operation: ChangeOperation = {
      id: "replace-image-operation",
      status: "pending",
      summary: "Replace the image",
      command: {
        id: "replace-image-command",
        type: "update_node",
        actor: "agent",
        at: "2026-08-28T15:00:00.000Z",
        nodeId: image.id,
        patch: {
          src: asset.src,
          assetId: `library-${asset.id}`,
        },
      },
    }

    const details = operationDetails(document, operation)

    expect(details.after).toBe(`assetId: ${asset.name} · Legacy curated value`)
    expect(details.context).toBe("1 public layer property")
    expect(JSON.stringify(details)).not.toContain("data:image")
    expect(JSON.stringify(details)).not.toContain("src:")
  })

  it("does not reveal a source-only internal patch", () => {
    const document = documentWithImage()
    const image = document.nodes.find((node) => node.type === "image")
    if (!image) throw new Error("The image fixture is unavailable")
    const operation: ChangeOperation = {
      id: "source-only-operation",
      status: "pending",
      summary: "Resolve an internal renderer source",
      command: {
        id: "source-only-command",
        type: "update_node",
        actor: "agent",
        at: "2026-08-28T15:01:00.000Z",
        nodeId: image.id,
        patch: { src: studioAssets[0]?.src ?? "data:image/png;base64,private" },
      },
    }

    const details = operationDetails(document, operation)

    expect(details.before).toBe("No public property changes")
    expect(details.after).toBe("No public property changes")
    expect(JSON.stringify(details)).not.toContain("data:image")
  })

  it.each(exactSources)(
    "describes an exact $label replacement without exposing its locator",
    (source) => {
      const document = documentWithImage()
      const image = document.nodes.find((node) => node.type === "image")
      if (!image) throw new Error("The image fixture is unavailable")
      const operation: ChangeOperation = {
        id: `replace-${source.label}-operation`,
        status: "pending",
        summary: "Replace the image",
        command: {
          id: `replace-${source.label}-command`,
          type: "replace_image_source",
          actor: "agent",
          at: "2026-08-31T12:00:00.000Z",
          nodeId: image.id,
          assetId: source.assetId,
          src: source.src,
        },
      }

      const details = operationDetails(document, operation)

      expect(details.context).toBe("Image source")
      expect(details.after).toBe(source.expected)
      expect(JSON.stringify(details)).not.toContain(source.src)
    }
  )

  it.each(exactSources)(
    "describes an exact $label image insertion without exposing its locator",
    (source) => {
      const document = documentWithImage()
      const image = document.nodes.find((node) => node.type === "image")
      if (!image) throw new Error("The image fixture is unavailable")
      const operation: ChangeOperation = {
        id: `insert-${source.label}-operation`,
        status: "pending",
        summary: "Insert the image",
        command: {
          id: `insert-${source.label}-command`,
          type: "add_node",
          actor: "agent",
          at: "2026-08-31T12:00:00.000Z",
          pageId: document.pages[0].id,
          node: {
            ...image,
            id: `insert-${source.label}-image`,
            assetId: source.assetId,
            src: source.src,
          },
        },
      }

      const details = operationDetails(document, operation)

      expect(details.context).toContain("image layer")
      expect(details.after).toContain(source.expected)
      expect(JSON.stringify(details)).not.toContain(source.src)
    }
  )

  it("names every source and content layer in a mask proposal", () => {
    const document = quotationStarter.document
    const page = document.pages[0]!
    const source = document.nodes.find(
      (node) => page.nodeIds.includes(node.id) && node.type === "rect"
    )!
    const content = document.nodes.find(
      (node) => page.nodeIds.includes(node.id) && node.id !== source.id
    )!
    const operation: ChangeOperation = {
      id: "create-mask-operation",
      status: "pending",
      summary: "Create a vector mask",
      command: {
        id: "create-mask-command",
        type: "create_mask_group",
        actor: "agent",
        at: "2026-08-31T12:10:00.000Z",
        expectedRevision: document.revision,
        pageId: page.id,
        groupId: "review-mask-group",
        name: "Portrait mask",
        nodeIds: [source.id, content.id],
        sourceNodeIds: [source.id],
        maskType: "vector",
      },
    }

    const details = operationDetails(document, operation)

    expect(details).toEqual({
      label: "Portrait mask",
      context: "vector mask · 1 source · 1 content layer · top level",
      before: `Separate layers: ${source.name} · ${content.name}`,
      after: `Mask source: ${source.name}`,
    })

    const parent = document.groups[0]!
    if (operation.command.type !== "create_mask_group") {
      throw new Error("Expected a create mask command")
    }
    expect(
      operationDetails(document, {
        ...operation,
        command: { ...operation.command, parentGroupId: parent.id },
      })
    ).toEqual({
      label: "Portrait mask",
      context: `vector mask · 1 source · 1 content layer · inside ${parent.name}`,
      before: `Separate layers: ${source.name} · ${content.name}`,
      after: `Mask source: ${source.name} · Parent: ${parent.name}`,
    })
  })

  it("describes source reassignment and release from canonical group state", () => {
    const document = structuredClone(quotationStarter.document)
    const page = document.pages[0]!
    const source = document.nodes.find(
      (node) => page.nodeIds.includes(node.id) && node.type === "rect"
    )!
    const content = document.nodes.find(
      (node) => page.nodeIds.includes(node.id) && node.id !== source.id
    )!
    document.groups.push({
      id: "review-mask-group",
      role: "mask",
      pageId: page.id,
      name: "Portrait mask",
      nodeIds: [source.id, content.id],
      mask: { type: "vector", sourceNodeIds: [source.id] },
    })
    const release: ChangeOperation = {
      id: "release-mask-operation",
      status: "pending",
      summary: "Release the mask",
      command: {
        id: "release-mask-command",
        type: "release_mask_group",
        actor: "agent",
        at: "2026-08-31T12:11:00.000Z",
        expectedRevision: document.revision,
        pageId: page.id,
        groupId: "review-mask-group",
      },
    }
    const setSources: ChangeOperation = {
      id: "set-mask-source-operation",
      status: "pending",
      summary: "Change the mask source",
      command: {
        id: "set-mask-source-command",
        type: "set_mask_sources",
        actor: "agent",
        at: "2026-08-31T12:12:00.000Z",
        expectedRevision: document.revision,
        pageId: page.id,
        groupId: "review-mask-group",
        sourceNodeIds: [content.id],
      },
    }

    expect(operationDetails(document, release)).toMatchObject({
      label: "Portrait mask",
      context: "Release mask",
      before: `Mask source: ${source.name}`,
      after: "Mask group removed; layers remain on the page",
    })
    const parent = document.groups[0]!
    document.groups.find(
      (group) => group.id === "review-mask-group"
    )!.parentGroupId = parent.id
    expect(operationDetails(document, release)).toMatchObject({
      label: "Portrait mask",
      context: `Release nested mask · ${parent.name}`,
      after: `Mask group removed; layers return to ${parent.name}`,
    })
    expect(operationDetails(document, setSources)).toMatchObject({
      label: "Portrait mask",
      context: "Mask source",
      before: source.name,
      after: content.name,
    })
  })
})
