import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { renderConformanceDocument, type SceneNode } from "@webmcp/document"
import { maskRenderConformanceDocument } from "@webmcp/document/internal/mask-render-conformance"
import type { ProductCommandRuntimeContext } from "@webmcp/editor/product-commands"
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

const renderSelectedInspector = (
  selectedNode: SceneNode,
  sourceDocument = renderConformanceDocument
) =>
  renderToStaticMarkup(
    createElement(InspectorSidebar, {
      document: {
        ...sourceDocument,
        nodes: sourceDocument.nodes.map((node) =>
          node.id === selectedNode.id ? selectedNode : node
        ),
      },
      selectedNodes: [selectedNode],
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

const renderImageSourceInspector = (selectedImage: typeof image) =>
  renderSelectedInspector(selectedImage)

describe("InspectorSidebar basic property controls", () => {
  it("exposes canonical advanced text layout controls", () => {
    if (textNode.type !== "text") throw new Error("Expected text")
    const markup = renderSelectedInspector({
      ...textNode,
      align: "justify",
      direction: "rtl",
      verticalAlign: "middle",
      textCase: "uppercase",
      truncation: "ellipsis",
      maxLines: 2,
    })

    expect(markup).toContain('aria-label="Align text justify"')
    expect(markup).toContain('aria-label="Text direction"')
    expect(markup).toContain('aria-label="Text vertical alignment"')
    expect(markup).toContain('aria-label="Text case"')
    expect(markup).toContain('aria-label="Text truncation"')
    expect(markup).toContain('aria-label="Limit text lines"')
    expect(markup).toContain("Maximum lines")
  })

  it("exposes compact independent image-corner controls", () => {
    if (image.type !== "image") throw new Error("Expected image")
    const markup = renderImageSourceInspector({
      ...image,
      frameMask: {
        shape: "rounded_rectangle",
        radius: 0.1,
        cornerRadii: {
          topLeft: 0.05,
          topRight: 0.1,
          bottomRight: 0.15,
          bottomLeft: 0.2,
        },
        cornerSmoothing: 0.5,
      },
    })

    expect(markup).toContain('aria-label="Independent image corners"')
    expect(markup).toContain("Top left")
    expect(markup).toContain("Bottom right")
    expect(markup).toContain("Corner smoothing")
  })

  it("exposes frame flow and clipping controls", () => {
    const markup = renderSelectedInspector({
      id: "inspector-frame",
      type: "frame",
      name: "Inspector frame",
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      constraints: { horizontal: "min", vertical: "min" },
      fill: "#ffffff",
      radius: 12,
      independentCorners: true,
      cornerRadii: {
        topLeft: 4,
        topRight: 8,
        bottomRight: 12,
        bottomLeft: 16,
      },
      cornerSmoothing: 0.6,
      strokeWidth: 0,
      children: [],
      autoLayout: {
        direction: "vertical",
        horizontalSizing: "fixed",
        verticalSizing: "hug",
        gap: 12,
        padding: { top: 8, right: 16, bottom: 8, left: 16 },
        primaryAlign: "center",
        counterAlign: "stretch",
      },
      clipsContent: true,
      layoutGrids: [
        {
          id: "inspector-columns",
          pattern: "columns",
          visible: true,
          color: "#2563eb",
          opacity: 0.12,
          alignment: "stretch",
          count: 12,
          offset: 24,
          sectionSize: 1,
          gutter: 16,
        },
      ],
    })

    expect(markup).toContain('data-inspector-property="autoLayout"')
    expect(markup).toContain('aria-label="Frame layout direction"')
    expect(markup).toContain('aria-label="Frame horizontal sizing"')
    expect(markup).toContain('aria-label="Frame vertical sizing"')
    expect(markup).toContain('aria-label="Frame primary alignment"')
    expect(markup).toContain('aria-label="Frame counter alignment"')
    expect(markup).toContain('aria-label="Padding top"')
    expect(markup).toContain("Clip content")
    expect(markup).toContain('data-inspector-property="layoutGrids"')
    expect(markup).toContain(
      'data-layout-grid-inspector-id="inspector-columns"'
    )
    expect(markup).toContain('aria-label="Layout guide 1 pattern"')
    expect(markup).toContain("Guide color")
    expect(markup).toContain("Fill")
    expect(markup).toContain('aria-label="Blend mode"')
    expect(markup).toContain('aria-label="Independent corners"')
    expect(markup).toContain("Top left")
    expect(markup).toContain("Bottom right")
    expect(markup).toContain("Corner smoothing")
  })

  it("exposes positioning and sizing for a selected frame child", () => {
    const document = structuredClone(renderConformanceDocument)
    const child = document.nodes.find((node) => node.type === "text")!
    const page = document.pages.find((candidate) =>
      candidate.nodeIds.includes(child.id)
    )!
    page.nodeIds = [
      "inspector-child-frame",
      child.id,
      ...page.nodeIds.filter((nodeId) => nodeId !== child.id),
    ]
    document.nodes.push({
      id: "inspector-child-frame",
      type: "frame",
      name: "Inspector child frame",
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      constraints: { horizontal: "min", vertical: "min" },
      fill: "#ffffff",
      radius: 0,
      strokeWidth: 0,
      children: [
        {
          nodeId: child.id,
          positioning: "auto",
          horizontalSizing: "fill",
          verticalSizing: "fixed",
          offsetX: 0,
          offsetY: 0,
          grow: 1,
        },
      ],
      autoLayout: null,
      clipsContent: false,
    })

    const markup = renderSelectedInspector(child, document)

    expect(markup).toContain('data-inspector-property="frameChildLayout"')
    expect(markup).toContain('aria-label="Frame child positioning"')
    expect(markup).toContain('aria-label="Frame child horizontal sizing"')
    expect(markup).toContain('aria-label="Frame child vertical sizing"')
    expect(markup).toContain('aria-label="Frame child grow"')
  })

  it("exposes both page-resize constraint axes for a selected layer", () => {
    const markup = renderImageSourceInspector({
      ...image,
      constraints: { horizontal: "max", vertical: "stretch" },
    })

    expect(markup).toContain('data-inspector-property="constraints"')
    expect(markup).toContain('aria-label="Horizontal constraint"')
    expect(markup).toContain('aria-label="Vertical constraint"')
    expect(markup).toContain(
      "Controls how this layer responds when its page is resized."
    )
  })

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

    expect(markup).toContain('aria-label="fills 1 color"')
    expect(markup).not.toContain('aria-label="fills 1 color" disabled=""')
  })
})

describe("InspectorSidebar mask controls", () => {
  it("shows Vector selected and gives exact reasons for deferred mask types", () => {
    const document = structuredClone(maskRenderConformanceDocument)
    const group = document.groups[0]!
    if (group.role !== "mask") throw new Error("Mask fixture is missing")
    const firstSource = document.nodes.find(
      (node) => node.id === group.mask.sourceNodeIds[0]
    )!
    const secondSource = {
      ...structuredClone(firstSource),
      id: "mask-source-b",
      name: "Source B",
    }
    firstSource.name = "Source A"
    document.nodes.push(secondSource)
    group.nodeIds.splice(1, 0, secondSource.id)
    group.mask.sourceNodeIds = [secondSource.id, firstSource.id]
    const page = document.pages[0]!
    page.nodeIds.splice(1, 0, secondSource.id)
    const selectedNodes = group.nodeIds.flatMap((nodeId) => {
      const node = document.nodes.find((candidate) => candidate.id === nodeId)
      return node ? [node] : []
    })
    const productCommandContext = {
      documentId: document.id,
      snapshotId: "snapshot-mask",
      activePageId: page.id,
      activeOutputId: document.outputs[0]!.id,
      pageIds: [page.id],
      outputIds: [document.outputs[0]!.id],
      nodeIds: page.nodeIds,
      groupIds: [group.id],
      selection: {
        pageId: page.id,
        nodeIds: group.nodeIds,
        nodeTypes: selectedNodes.map((node) => node.type),
        groupId: group.id,
        anyLocked: false,
        allLocked: false,
        allVisible: true,
        allHidden: false,
      },
      activeTool: "select",
      editor: {
        reviewPending: false,
        hasSelection: true,
        selectedNodeCount: selectedNodes.length,
        hasSelectedGroup: true,
        hasClipboard: false,
        hasUndo: false,
        hasRedo: false,
        hasZoomSelection: true,
        canCropImage: false,
        imageCropActive: false,
      },
    } satisfies ProductCommandRuntimeContext
    const markup = renderToStaticMarkup(
      createElement(InspectorSidebar, {
        document,
        selectedNodes,
        selectedGroupId: group.id,
        pendingChangeSet: null,
        lastResolvedChangeSet: null,
        changeSetConflict: null,
        changeSetError: null,
        isApplyingChangeSet: false,
        webMcpStatus: "ready",
        webMcpError: null,
        productCommandContext,
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

    expect(markup).toContain('data-mask-inspector="true"')
    expect(markup).toContain('aria-label="Vector mask"')
    expect(markup).toContain('data-state="on"')
    expect(markup).toContain('aria-label="Alpha mask"')
    expect(markup).toContain('aria-label="Luminance mask"')
    expect(markup).toContain('aria-label="Mask source layers"')
    expect(markup).toContain("Source layers")
    expect(markup).toContain("2/4")
    const sourceBIndex = markup.indexOf("Source B")
    const sourceAIndex = markup.indexOf("Source A")
    expect(sourceBIndex).toBeGreaterThan(-1)
    expect(sourceAIndex).toBeGreaterThan(sourceBIndex)
    expect(markup).toContain('aria-label="Mask source 1 of 2"')
    expect(markup).toContain('aria-label="Mask source 2 of 2"')
    expect(markup).toContain(
      'aria-label="Remove source 1, Source B, from mask sources"'
    )
    expect(markup).toContain(
      'aria-label="Remove source 2, Source A, from mask sources"'
    )
    expect(markup).toContain("Available to add")
    expect(markup).toContain('aria-label="Add Masked content as mask source"')
    expect(markup).toContain("Release mask")
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
      "“Cover image” gets its image from the “Client portrait” shared asset field. Change the field value in Data or unbind Source."
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

    expect(markup).toContain('aria-label="Layer name"')
    expect(markup).toContain('aria-label="Layer type: Image"')
    expect(markup).not.toContain(">Selection</p>")
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
  it("places compact text content before position and outside typography", () => {
    const markup = renderToStaticMarkup(
      createElement(InspectorSidebar, {
        document: renderConformanceDocument,
        selectedNodes: [textNode],
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
      })
    )

    const contentIndex = markup.indexOf(">Content</h3>")
    const positionIndex = markup.indexOf(">Position</h3>")
    const typographyIndex = markup.indexOf(">Typography</h3>")

    expect(contentIndex).toBeGreaterThan(-1)
    expect(contentIndex).toBeLessThan(positionIndex)
    expect(positionIndex).toBeLessThan(typographyIndex)
    expect(markup).toContain('aria-label="Text content"')
    expect(markup).not.toContain("Text shown on the canvas.")
  })

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
    expect(markup).toContain('aria-label="Align selection to page"')
    expect(markup).toContain('aria-label="Paragraph alignment"')
    expect(markup).toContain("pr-2.5")
    expect(markup).toContain("pb-3")
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

describe("Generated document Review", () => {
  it("renders candidate page thumbnails and keeps creation explicit", () => {
    const candidate = structuredClone(renderConformanceDocument)
    candidate.id = "generated-review-preview"
    candidate.name = "Generated campaign"
    const markup = renderToStaticMarkup(
      createElement(InspectorSidebar, {
        document: renderConformanceDocument,
        selectedNodes: [],
        pendingGeneratedDocument: {
          requestId: "request-review-preview",
          rootRequestId: "request-review-preview",
          attempt: 1,
          idempotencyKey: "key-review-preview",
          requestHash: "hash-review-preview",
          createdAt: "2026-08-31T08:00:00.000Z",
          start: {
            kind: "blank",
            presetId: "portrait",
            designPlanVersion: 1,
          },
          candidate,
          summary: {
            pages: candidate.pages.map(({ id, name, width, height }) => ({
              id,
              name,
              width,
              height,
            })),
            nodesByType: {},
            fields: candidate.fields.map((field) => field.key),
            assets: [],
            structuralChanges: ["Created editable layers"],
          },
          provenance: {
            skill: { kind: "repository", title: "studio-document" },
            designGuides: [],
            references: [],
          },
          validation: [],
          warnings: [],
        },
        pendingChangeSet: null,
        lastResolvedChangeSet: null,
        changeSetConflict: null,
        changeSetError: null,
        isApplyingChangeSet: false,
        webMcpStatus: "ready",
        webMcpError: null,
        capabilityContext: { documentEditable: false },
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

    expect(markup).toContain("Generated campaign")
    expect(markup).toContain('data-page-id="')
    expect(markup).toContain("Create editable document")
    expect(markup).toContain("studio-document")
  })
})
