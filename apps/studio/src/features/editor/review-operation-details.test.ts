import { describe, expect, it } from "vitest"
import { applyCommand } from "@webmcp/document"
import type { ChangeOperation } from "@webmcp/document"
import { studioAssets } from "./asset-catalog"
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

    expect(details.after).toBe(`assetId: ${asset.name} (${asset.id})`)
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
})
