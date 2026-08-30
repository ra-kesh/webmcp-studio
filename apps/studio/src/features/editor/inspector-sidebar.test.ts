import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { renderConformanceDocument } from "@webmcp/document"
import { describe, expect, it, vi } from "vitest"

import { InspectorSidebar, reviewTargetExists } from "./inspector-sidebar"

const image = renderConformanceDocument.nodes.find(
  (node) => node.type === "image"
)!

describe("InspectorSidebar image replacement capability", () => {
  it("disables Replace and explains the host-projected source binding", () => {
    const reason =
      "“Cover image” gets its image from the “Client portrait” shared asset field. Change the field value in Fields or unbind Source."
    const markup = renderToStaticMarkup(
      createElement(InspectorSidebar, {
        document: renderConformanceDocument,
        selectedNodes: [image],
        pendingChangeSet: null,
        lastResolvedChangeSet: null,
        changeSetConflict: null,
        changeSetError: null,
        isApplyingChangeSet: false,
        webMcpStatus: "ready",
        webMcpError: null,
        capabilityContext: {
          documentEditable: true,
          imageSourceStateByNodeId: {
            [image.id]: { src: image.src, readiness: "ready" },
          },
          imageReplacementConstraintByNodeId: {
            [image.id]: { reason },
          },
        },
        onUpdateNode: vi.fn(),
        onUpdateSelection: vi.fn(),
        onUpdateField: vi.fn(),
        onCreateField: vi.fn(),
        onUpdateFieldDefinition: vi.fn(),
        onRemoveField: vi.fn(),
        onBindField: vi.fn(),
        onUnbindField: vi.fn(),
        onFocusNode: vi.fn(),
        onDecideChangeOperation: vi.fn(),
        onDecideAllChangeOperations: vi.fn(),
        onApplyChangeSet: vi.fn(),
        onDiscardChangeSet: vi.fn(),
        onAlignSelection: vi.fn(),
        onAlignSelectionToPage: vi.fn(),
        onDistributeSelection: vi.fn(),
        onSetSelectionLocked: vi.fn(),
        onSetSelectionVisible: vi.fn(),
        onReorderSelection: vi.fn(),
        onDuplicateSelection: vi.fn(),
        onDeleteSelection: vi.fn(),
        onUpdateImageFrameGeometry: vi.fn(),
        onSetImagePlacement: vi.fn(),
        onSetImageFrameMask: vi.fn(),
        onRunImageCommand: vi.fn(),
        isImageCommandEnabled: (commandId) => commandId !== "image.replace",
        onRetryImageSource: vi.fn(),
        onRemoveImageLayer: vi.fn(),
      })
    )

    expect(markup).toContain(reason)
    expect(markup).toMatch(
      /<button[^>]*aria-describedby="[^"]+"[^>]*disabled=""[^>]*>[^<]*<svg[^>]*>.*Replace image…<\/button>/
    )
  })

  it("renders complete in-place recovery for an unavailable image", () => {
    const markup = renderToStaticMarkup(
      createElement(InspectorSidebar, {
        document: renderConformanceDocument,
        selectedNodes: [image],
        pendingChangeSet: null,
        lastResolvedChangeSet: null,
        changeSetConflict: null,
        changeSetError: null,
        isApplyingChangeSet: false,
        webMcpStatus: "ready",
        webMcpError: null,
        capabilityContext: {
          documentEditable: true,
          imageSourceStateByNodeId: {
            [image.id]: { src: image.src, readiness: "unavailable" },
          },
        },
        onUpdateNode: vi.fn(),
        onUpdateSelection: vi.fn(),
        onUpdateField: vi.fn(),
        onCreateField: vi.fn(),
        onUpdateFieldDefinition: vi.fn(),
        onRemoveField: vi.fn(),
        onBindField: vi.fn(),
        onUnbindField: vi.fn(),
        onFocusNode: vi.fn(),
        onDecideChangeOperation: vi.fn(),
        onDecideAllChangeOperations: vi.fn(),
        onApplyChangeSet: vi.fn(),
        onDiscardChangeSet: vi.fn(),
        onAlignSelection: vi.fn(),
        onAlignSelectionToPage: vi.fn(),
        onDistributeSelection: vi.fn(),
        onSetSelectionLocked: vi.fn(),
        onSetSelectionVisible: vi.fn(),
        onReorderSelection: vi.fn(),
        onDuplicateSelection: vi.fn(),
        onDeleteSelection: vi.fn(),
        onUpdateImageFrameGeometry: vi.fn(),
        onSetImagePlacement: vi.fn(),
        onSetImageFrameMask: vi.fn(),
        onRunImageCommand: vi.fn(),
        isImageCommandEnabled: () => true,
        onRetryImageSource: vi.fn(),
        onRemoveImageLayer: vi.fn(),
      })
    )

    expect(markup).toContain('role="alert"')
    expect(markup).toContain("Image unavailable")
    expect(markup).toContain("The frame and layer position are preserved")
    expect(markup).toContain("Retry")
    expect(markup).toContain("Locate")
    expect(markup).toContain("Remove")
    expect(markup).not.toContain("Crop image")
  })

  it("routes an unavailable local alias to shared document-image review", () => {
    const localImage = {
      ...image,
      assetId: "missing-local-image",
      src: "asset:local/missing-local-image",
    }
    const markup = renderToStaticMarkup(
      createElement(InspectorSidebar, {
        document: {
          ...renderConformanceDocument,
          nodes: renderConformanceDocument.nodes.map((node) =>
            node.id === image.id ? localImage : node
          ),
        },
        selectedNodes: [localImage],
        pendingChangeSet: null,
        lastResolvedChangeSet: null,
        changeSetConflict: null,
        changeSetError: null,
        isApplyingChangeSet: false,
        webMcpStatus: "ready",
        webMcpError: null,
        capabilityContext: {
          documentEditable: true,
          imageSourceStateByNodeId: {
            [image.id]: { src: localImage.src, readiness: "unavailable" },
          },
        },
        onUpdateNode: vi.fn(),
        onUpdateSelection: vi.fn(),
        onUpdateField: vi.fn(),
        onCreateField: vi.fn(),
        onUpdateFieldDefinition: vi.fn(),
        onRemoveField: vi.fn(),
        onBindField: vi.fn(),
        onUnbindField: vi.fn(),
        onFocusNode: vi.fn(),
        onDecideChangeOperation: vi.fn(),
        onDecideAllChangeOperations: vi.fn(),
        onApplyChangeSet: vi.fn(),
        onDiscardChangeSet: vi.fn(),
        onAlignSelection: vi.fn(),
        onAlignSelectionToPage: vi.fn(),
        onDistributeSelection: vi.fn(),
        onSetSelectionLocked: vi.fn(),
        onSetSelectionVisible: vi.fn(),
        onReorderSelection: vi.fn(),
        onDuplicateSelection: vi.fn(),
        onDeleteSelection: vi.fn(),
        onUpdateImageFrameGeometry: vi.fn(),
        onSetImagePlacement: vi.fn(),
        onSetImageFrameMask: vi.fn(),
        onRunImageCommand: vi.fn(),
        isImageCommandEnabled: () => true,
        onRetryImageSource: vi.fn(),
        onRemoveImageLayer: vi.fn(),
        onReviewDocumentImage: vi.fn(),
      })
    )

    expect(markup).toContain("Review document image")
    expect(markup).not.toContain("Retry image source")
    expect(markup).not.toContain("Locate replacement image")
    expect(markup).not.toContain("Remove image layer")
  })
})

describe("Review target navigation", () => {
  it("uses the preview document to enable additions and disable removals", () => {
    const existing = renderConformanceDocument.nodes[0]
    const added = { ...existing, id: "pending-added-node", name: "Added layer" }
    const preview = {
      ...renderConformanceDocument,
      nodes: [
        ...renderConformanceDocument.nodes.filter(
          (node) => node.id !== existing.id
        ),
        added,
      ],
    }

    expect(
      reviewTargetExists(preview, {
        kind: "node",
        id: added.id,
        label: added.name,
        pageId: preview.pages[0].id,
      })
    ).toBe(true)
    expect(
      reviewTargetExists(preview, {
        kind: "node",
        id: existing.id,
        label: existing.name,
        pageId: renderConformanceDocument.pages[0].id,
      })
    ).toBe(false)
  })
})
