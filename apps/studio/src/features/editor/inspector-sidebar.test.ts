import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { renderConformanceDocument } from "@webmcp/document"
import { describe, expect, it, vi } from "vitest"
import { studioMediaManifest } from "../../content/library/media/manifest"

import { InspectorSidebar, reviewTargetExists } from "./inspector-sidebar"

const image = renderConformanceDocument.nodes.find(
  (node) => node.type === "image"
)!
const textNode = renderConformanceDocument.nodes.find(
  (node) => node.type === "text"
)!
const rectangleNode = renderConformanceDocument.nodes.find(
  (node) => node.type === "rect"
)!

const renderImageSourceInspector = (selectedImage: typeof image) =>
  renderToStaticMarkup(
    createElement(InspectorSidebar, {
      document: {
        ...renderConformanceDocument,
        nodes: renderConformanceDocument.nodes.map((node) =>
          node.id === selectedImage.id ? selectedImage : node
        ),
      },
      selectedNodes: [selectedImage],
      pendingChangeSet: null,
      lastResolvedChangeSet: null,
      changeSetConflict: null,
      changeSetError: null,
      isApplyingChangeSet: false,
      webMcpStatus: "ready",
      webMcpError: null,
      capabilityContext: { documentEditable: true },
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

describe("InspectorSidebar basic property controls", () => {
  it("keeps Fill editable for an unlocked rectangle", () => {
    const unlockedRectangle = { ...rectangleNode, locked: false }
    const markup = renderToStaticMarkup(
      createElement(InspectorSidebar, {
        document: renderConformanceDocument,
        selectedNodes: [unlockedRectangle],
        pendingChangeSet: null,
        lastResolvedChangeSet: null,
        changeSetConflict: null,
        changeSetError: null,
        isApplyingChangeSet: false,
        webMcpStatus: "ready",
        webMcpError: null,
        capabilityContext: { documentEditable: true },
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
        isImageCommandEnabled: () => false,
        onRetryImageSource: vi.fn(),
        onRemoveImageLayer: vi.fn(),
      })
    )

    expect(markup).toContain('aria-label="Fill color picker"')
    expect(markup).not.toContain(
      'aria-label="Fill color picker" type="color" disabled=""'
    )
  })
})

describe("InspectorSidebar image replacement capability", () => {
  it.each([
    {
      label: "canonical curated",
      assetId: studioMediaManifest[0].id,
      src: studioMediaManifest[0].resourcePath,
      expected: `${studioMediaManifest[0].name} · Curated Studio asset`,
    },
    {
      label: "workspace managed",
      assetId: "asset-managed-source-1",
      src: "asset:managed/asset-managed-source-1",
      expected: "Workspace-managed image (asset-managed-source-1)",
    },
    {
      label: "device local",
      assetId: "local-source-1",
      src: "asset:local/local-source-1",
      expected: "Device-local image (local-source-1)",
    },
  ])("labels $label image sources without exposing the locator", (source) => {
    const selectedImage = {
      ...image,
      assetId: source.assetId,
      src: source.src,
    }
    const markup = renderImageSourceInspector(selectedImage)

    expect(markup).toContain(source.expected)
    expect(markup).not.toContain(source.src)
    expect(markup).not.toContain("External image")
  })

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

    expect(markup).toContain("Name in Layers")
    expect(markup).toContain('data-slot="inspector-section"')
    expect(markup).toContain(">Image</h3>")
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

describe("InspectorSidebar text selection state", () => {
  it("separates live character formatting from layer defaults", () => {
    const markup = renderToStaticMarkup(
      createElement(InspectorSidebar, {
        document: renderConformanceDocument,
        selectedNodes: [textNode],
        textEditingState: {
          nodeId: textNode.id,
          text: textNode.text,
          selection: { anchor: 0, focus: 5 },
          typographyStyle: { kind: "value", value: null },
          paintStyle: { kind: "value", value: null },
          link: {
            kind: "value",
            target: "https://example.com",
            newTab: true,
          },
          paragraph: {
            align: { kind: "value", value: "left" },
            list: { kind: "value", value: null },
          },
          style: {
            color: { kind: "value", value: "#111827" },
            fontFamily: { kind: "value", value: "Geist Variable" },
            fontSize: { kind: "mixed" },
            fontWeight: { kind: "value", value: 700 },
            italic: { kind: "value", value: false },
            decoration: { kind: "value", value: "underline" },
            lineHeight: { kind: "value", value: 1.2 },
            letterSpacing: { kind: "value", value: 0 },
          },
        },
        pendingChangeSet: null,
        lastResolvedChangeSet: null,
        changeSetConflict: null,
        changeSetError: null,
        isApplyingChangeSet: false,
        webMcpStatus: "ready",
        webMcpError: null,
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
        onApplyTextEditingStyle: vi.fn(),
        onEditTextLink: vi.fn(),
      })
    )

    expect(markup).toContain('data-text-selection-inspector="true"')
    expect(markup).toContain("5 characters selected")
    expect(markup).toContain('aria-label="Mixed font sizes"')
    expect(markup).toContain('aria-label="Edit link for selected text"')
    expect(markup).toContain('data-font-weight-cycle="true"')
    expect(markup).toContain("Weight</span>")
    expect(markup).toContain("Geist Variable")
    expect(markup).toContain('data-reusable-style-field="Text style"')
    expect(markup).toContain('data-reusable-style-field="Paint style"')
    expect(markup).toContain("Layer defaults")
    expect(markup).not.toMatch(/<textarea[^>]* disabled=""/)
    expect(markup).not.toContain(
      'aria-label="Text color picker" type="color" disabled=""'
    )
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
