// @vitest-environment jsdom

import "fake-indexeddb/auto"
import { webcrypto } from "node:crypto"
import { act, useLayoutEffect } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { documentSchema } from "@webmcp/document"
import type { ChangeSet, SceneNode } from "@webmcp/document"
import {
  deriveEditorImageCommandCapabilities,
  isEditorCommandEnabled,
  projectEditorCommandCapabilities,
} from "@webmcp/editor/commands"
import type {
  EditorCommandContext,
  EditorCommandId,
} from "@webmcp/editor/commands"
import { imageCropSessionHasChanges } from "@webmcp/editor/image-crop-session"
import { createInspectorSelectionModel } from "@webmcp/editor/inspector"
import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import type { StudioWebMcpCommandCapability, WebMcpTool } from "@webmcp/webmcp"

import { studioAssets } from "./asset-catalog"
import { quotationStarter } from "./quotation-starter"
import {
  StudioPersistenceTestWrapper,
  useStudioPersistence,
} from "./studio-persistence-test-wrapper"
import { useDocumentEditor } from "./use-document-editor"
import { useStudioWebMcp } from "./use-studio-webmcp"

type Editor = ReturnType<typeof useDocumentEditor>
type ImageNode = Extract<SceneNode, { type: "image" }>

const STORAGE_KEY = "webmcp-studio:northstar-document:v2"
const REPOSITORY_DATABASE_NAME = "webmcp-studio-documents"
const registeredTools = new Map<string, WebMcpTool>()
const renderAudit = { composition: 0 }
const animationFrames = new Map<number, FrameRequestCallback>()
let nextAnimationFrameId = 1

const deleteRepositoryDatabase = () =>
  new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(REPOSITORY_DATABASE_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })

const asset = studioAssets[0]
const image: ImageNode = {
  id: "mounted-webmcp-image",
  type: "image",
  name: "Mounted WebMCP image",
  x: 80,
  y: 120,
  width: 420,
  height: 280,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  assetId: asset.id,
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
  alt: asset.description,
  decorative: false,
}

const fixtureDocument = () => {
  const source = structuredClone(quotationStarter.document)
  const firstPage = source.pages[0]
  return documentSchema.parse({
    ...source,
    id: "mounted-webmcp-document",
    pages: source.pages.map((page) =>
      page.id === firstPage.id
        ? { ...page, nodeIds: [...page.nodeIds, image.id] }
        : page
    ),
    nodes: [...source.nodes, image],
  })
}

type CapturedComposition = Readonly<{
  editor: Editor
  webMcpStatus: ReturnType<typeof useStudioWebMcp>["status"]
}>

function MountedEditorWebMcpComposition({
  capture,
}: {
  capture: (value: CapturedComposition) => void
}) {
  renderAudit.composition += 1
  const persistence = useStudioPersistence()
  const editor = useDocumentEditor({ persistence })
  const activeCropNodeId = editor.imageCropSession?.target.nodeId ?? null
  const inspectorCapabilities = createInspectorSelectionModel(
    editor.selectedNodes,
    {
      documentEditable: !editor.pendingChangeSet,
      activeImageCropNodeId: activeCropNodeId,
      imageSourceStateByNodeId: {
        [image.id]: { src: image.src, readiness: "ready" },
      },
    }
  ).capabilities
  const imageCapabilities = deriveEditorImageCommandCapabilities({
    selectedNodes: editor.selectedNodes,
    inspectorCapabilities,
    documentEditable: !editor.pendingChangeSet,
    imageCropActive: Boolean(editor.imageCropSession),
    imageCropDraftChanged: editor.imageCropSession
      ? imageCropSessionHasChanges(editor.imageCropSession)
      : false,
    cropFrameMaskDraftSupported: true,
    activeImagePlacement: editor.imageCropSession?.draft,
    activeImageFrameMask: editor.imageCropSession?.draftFrameMask,
  })
  const commandContext: EditorCommandContext = {
    reviewPending: Boolean(editor.pendingChangeSet),
    hasSelection: Boolean(editor.selection?.nodeIds.length),
    selectedNodeCount: editor.selectedNodes.length,
    hasSelectedGroup: Boolean(editor.selectedGroupId),
    hasClipboard: editor.canPaste,
    hasUndo: editor.canUndo,
    hasRedo: editor.canRedo,
    hasZoomSelection: editor.selectedNodes.length > 0,
    canCropImage: inspectorCapabilities.canEnterCrop,
    canTransformImage: inspectorCapabilities.canFlipImage,
    imageCropActive: Boolean(editor.imageCropSession),
    image: imageCapabilities,
  }

  const commandEnabled = (commandId: EditorCommandId) => {
    const liveSession =
      editor.imageCropPreviewStore?.getLiveSession() ?? editor.imageCropSession
    if (!liveSession) {
      return isEditorCommandEnabled(commandId, commandContext)
    }
    return isEditorCommandEnabled(commandId, {
      ...commandContext,
      imageCropActive: true,
      image: deriveEditorImageCommandCapabilities({
        selectedNodes: editor.selectedNodes,
        inspectorCapabilities,
        documentEditable: !editor.pendingChangeSet,
        imageCropActive: true,
        imageCropDraftChanged: imageCropSessionHasChanges(liveSession),
        cropFrameMaskDraftSupported: true,
        activeImagePlacement: liveSession.draft,
        activeImageFrameMask: liveSession.draftFrameMask,
      }),
    })
  }

  const webMcp = useStudioWebMcp({
    document: editor.document,
    snapshotId: editor.snapshotId,
    operationVersion: editor.operationVersion,
    activePageId: editor.activePageId,
    selection: editor.selection,
    pendingChangeSet: editor.pendingChangeSet,
    assets: studioAssets,
    publishedVersion: null,
    renderHistory: [],
    getCommandCapabilities: () =>
      projectEditorCommandCapabilities(commandContext).map((capability) => ({
        ...capability,
        enabled: commandEnabled(capability.id),
      })),
    proposeChangeSet: (changeSet: ChangeSet) =>
      editor.proposeChangeSet(changeSet),
    publishTemplate: () =>
      Promise.reject(new Error("Publish is outside this mounted test.")),
    renderTemplate: () =>
      Promise.reject(new Error("Render is outside this mounted test.")),
  })

  useLayoutEffect(() => capture({ editor, webMcpStatus: webMcp.status }))
  return null
}

type MountedHarness = Readonly<{
  current: () => CapturedComposition
  root: Root
  host: HTMLDivElement
  unmount: () => Promise<void>
}>

const flushReact = async () => {
  await act(async () => {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
  })
}

const flushAnimationFrames = async () => {
  const callbacks = [...animationFrames.values()]
  animationFrames.clear()
  await act(async () => {
    for (const callback of callbacks) callback(performance.now())
  })
}

const mountComposition = async (): Promise<MountedHarness> => {
  const expectedDocument = fixtureDocument()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(expectedDocument))
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  const captured: { current: CapturedComposition | null } = { current: null }

  await act(async () => {
    root.render(
      <StudioPersistenceTestWrapper>
        <MountedEditorWebMcpComposition
          capture={(value) => {
            captured.current = value
          }}
        />
      </StudioPersistenceTestWrapper>
    )
  })

  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (
      captured.current?.editor.repositoryLifecycle.status === "ready" &&
      captured.current.editor.startModel.status === "ready"
    )
      break
    await flushReact()
  }
  if (
    !captured.current ||
    captured.current.editor.repositoryLifecycle.status !== "ready" ||
    captured.current.editor.startModel.status !== "ready"
  ) {
    throw new Error("Mounted editor did not migrate the WebMCP crop fixture")
  }
  let continued = false
  await act(async () => {
    continued = await captured.current!.editor.openStoredDocument(
      expectedDocument.id
    )
  })
  expect(continued).toBe(true)
  expect(captured.current.editor.document).toEqual(expectedDocument)

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (
      captured.current.webMcpStatus === "ready" &&
      registeredTools.has("inspect_design")
    )
      break
    await flushReact()
  }
  if (
    captured.current.editor.document.id !== expectedDocument.id ||
    captured.current.webMcpStatus !== "ready" ||
    !registeredTools.has("inspect_design")
  ) {
    throw new Error(
      "Mounted editor and WebMCP composition did not become ready"
    )
  }

  return {
    current: () => {
      if (!captured.current)
        throw new Error("Mounted composition is unavailable")
      return captured.current
    },
    root,
    host,
    unmount: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

const inspectCapabilities = async () => {
  const inspected = await registeredTools.get("inspect_design")?.execute({})
  if (inspected?.isError || !inspected?.structuredContent) {
    throw new Error(inspected?.content[0]?.text ?? "inspect_design failed")
  }
  return (
    inspected.structuredContent as {
      commandCapabilities: readonly StudioWebMcpCommandCapability[]
    }
  ).commandCapabilities
}

const capability = (
  capabilities: readonly StudioWebMcpCommandCapability[],
  id: string
) => {
  const current = capabilities.find((candidate) => candidate.id === id)
  if (!current) throw new Error(`Missing command capability ${id}`)
  return current
}

beforeAll(() => {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto,
  })
  class TestResizeObserver implements ResizeObserver {
    disconnect() {}
    observe() {}
    unobserve() {}
  }
  Object.assign(globalThis, { ResizeObserver: TestResizeObserver })
  Object.assign(globalThis, {
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      const frameId = nextAnimationFrameId++
      animationFrames.set(frameId, callback)
      return frameId
    },
    cancelAnimationFrame: (frameId: number) => {
      animationFrames.delete(frameId)
    },
    IS_REACT_ACT_ENVIRONMENT: true,
  })
})

beforeEach(async () => {
  await deleteRepositoryDatabase()
  localStorage.clear()
  registeredTools.clear()
  renderAudit.composition = 0
  animationFrames.clear()
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: {
      registerTool: async (tool: WebMcpTool) => {
        registeredTools.set(tool.name, tool)
        return undefined
      },
    },
  })
})

describe("mounted Studio WebMCP live crop capabilities", () => {
  it("inspects the live crop draft before and after frame publication without a composition rerender", async () => {
    const mounted = await mountComposition()
    try {
      const firstPageId = mounted.current().editor.document.pages[0].id
      await act(async () => {
        mounted.current().editor.setSelection({
          pageId: firstPageId,
          nodeIds: [image.id],
        })
      })

      const selectedCapabilities = await inspectCapabilities()
      expect(capability(selectedCapabilities, "image.crop").enabled).toBe(true)
      expect(
        capability(selectedCapabilities, "image.reset-placement").enabled
      ).toBe(false)

      await act(async () => {
        expect(mounted.current().editor.beginImageCrop(image.id)).toBe(true)
      })
      const previewStore = mounted.current().editor.imageCropPreviewStore
      if (!previewStore) throw new Error("Expected a live crop preview store")
      const rendersAfterCropEntry = renderAudit.composition

      const baselineCapabilities = await inspectCapabilities()
      expect(capability(baselineCapabilities, "image.crop").enabled).toBe(false)
      expect(
        capability(baselineCapabilities, "image.reset-placement").enabled
      ).toBe(false)
      expect(capability(baselineCapabilities, "image.fill").enabled).toBe(false)
      expect(
        capability(baselineCapabilities, "image.rotation.reset").enabled
      ).toBe(false)

      await act(async () => {
        expect(
          mounted.current().editor.previewImageCrop({
            mode: "manual",
            focalX: 0.68,
            focalY: 0.37,
            rotation: 13,
          })
        ).toBe(true)
      })

      expect(renderAudit.composition).toBe(rendersAfterCropEntry)
      expect(previewStore.getLiveSession().draftRevision).toBe(1)
      expect(previewStore.getSnapshot().draftRevision).toBe(0)
      expect(mounted.current().editor.imageCropSession?.draftRevision).toBe(0)

      const liveCapabilities = await inspectCapabilities()
      expect(
        capability(liveCapabilities, "image.reset-placement").enabled
      ).toBe(true)
      expect(capability(liveCapabilities, "image.fill").enabled).toBe(true)
      expect(capability(liveCapabilities, "image.rotation.reset").enabled).toBe(
        true
      )
      expect(renderAudit.composition).toBe(rendersAfterCropEntry)

      await flushAnimationFrames()
      expect(previewStore.getSnapshot().draftRevision).toBe(1)
      expect(renderAudit.composition).toBe(rendersAfterCropEntry)

      const publishedCapabilities = await inspectCapabilities()
      expect(publishedCapabilities).toEqual(liveCapabilities)
      expect(renderAudit.composition).toBe(rendersAfterCropEntry)

      await act(async () => {
        expect(
          mounted.current().editor.previewImageCrop({
            ...image.placement,
          })
        ).toBe(true)
      })
      expect(previewStore.getLiveSession().draftRevision).toBe(2)
      expect(previewStore.getSnapshot().draftRevision).toBe(1)
      expect(renderAudit.composition).toBe(rendersAfterCropEntry)

      const revertedLiveCapabilities = await inspectCapabilities()
      expect(
        capability(revertedLiveCapabilities, "image.reset-placement").enabled
      ).toBe(false)
      expect(capability(revertedLiveCapabilities, "image.fill").enabled).toBe(
        false
      )
      expect(
        capability(revertedLiveCapabilities, "image.rotation.reset").enabled
      ).toBe(false)
      expect(renderAudit.composition).toBe(rendersAfterCropEntry)
    } finally {
      await mounted.unmount()
      delete document.modelContext
    }
  })
})
