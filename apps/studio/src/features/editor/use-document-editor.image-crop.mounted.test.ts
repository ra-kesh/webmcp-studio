// @vitest-environment jsdom

import "fake-indexeddb/auto"
import { webcrypto } from "node:crypto"
import { act, createElement, useLayoutEffect } from "react"
import type { ReactElement } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { documentSchema } from "@webmcp/document"
import type { ChangeSet, SceneNode } from "@webmcp/document"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { imageCropSessionHasChanges } from "@webmcp/editor/image-crop-session"
import type * as EditorHistoryModule from "@webmcp/editor/history"

import { ImageCropToolbar } from "./image-crop-toolbar"
import { quotationStarter } from "./quotation-starter"
import {
  StudioPersistenceTestWrapper,
  useStudioPersistence,
} from "./studio-persistence-test-wrapper"
import { useDocumentEditor } from "./use-document-editor"

const historyAudit = vi.hoisted(() => ({
  commits: [] as Array<{
    label: string | undefined
    beforeSnapshotId: string
    afterSnapshotId: string
    beforeDocument: unknown
    afterDocument: unknown
    commandTypes: string[]
  }>,
}))

vi.mock("@webmcp/editor/history", async (importOriginal) => {
  const actual = await importOriginal<typeof EditorHistoryModule>()
  return {
    ...actual,
    commitCommandsWithResult: (
      ...args: Parameters<typeof actual.commitCommandsWithResult>
    ): ReturnType<typeof actual.commitCommandsWithResult> => {
      const [history, commands, options] = args
      const result = actual.commitCommandsWithResult(...args)
      if (!result) return result
      historyAudit.commits.push({
        label: options?.label,
        beforeSnapshotId: history.snapshotId,
        afterSnapshotId: result.history.snapshotId,
        beforeDocument: history.document,
        afterDocument: result.history.document,
        commandTypes: commands.map((command) => command.type),
      })
      return result
    },
  }
})

type Editor = ReturnType<typeof useDocumentEditor>
type ImageNode = Extract<SceneNode, { type: "image" }>

const STORAGE_KEY = "webmcp-studio:northstar-document:v2"
const REPOSITORY_DATABASE_NAME = "webmcp-studio-documents"
const renderAudit = { editor: 0 }
let nextAnimationFrameId = 1
const animationFrames = new Map<number, FrameRequestCallback>()

const deleteRepositoryDatabase = () =>
  new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(REPOSITORY_DATABASE_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })

const image: ImageNode = {
  id: "mounted-crop-image",
  type: "image",
  name: "Mounted crop image",
  x: 80,
  y: 120,
  width: 420,
  height: 280,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  assetId: "mounted-crop-asset",
  src: "https://example.com/mounted-crop.jpg",
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
  alt: "Mounted crop integration fixture",
  decorative: false,
}

const fixtureDocument = () => {
  const source = structuredClone(quotationStarter.document)
  const firstPage = source.pages[0]
  return documentSchema.parse({
    ...source,
    id: "mounted-crop-document",
    pages: source.pages.map((page) =>
      page.id === firstPage.id
        ? { ...page, nodeIds: [...page.nodeIds, image.id] }
        : page
    ),
    nodes: [...source.nodes, image],
  })
}

const imageFrom = (editor: Editor) =>
  editor.document.nodes.find(
    (node): node is ImageNode => node.id === image.id && node.type === "image"
  )!

const reviewChangeSet = (editor: Editor): ChangeSet => ({
  id: "mounted-review",
  documentId: editor.document.id,
  baseRevision: editor.document.revision,
  baseSnapshotId: editor.snapshotId,
  title: "Review cancels crop",
  createdAt: "2026-08-28T10:00:00.000Z",
  createdBy: "agent",
  status: "pending",
  operations: [
    {
      id: "mounted-review-operation",
      summary: "Dim the image after crop review",
      status: "pending",
      command: {
        id: "mounted-review-command",
        type: "update_node",
        actor: "agent",
        at: "2026-08-28T10:00:00.000Z",
        nodeId: image.id,
        patch: { opacity: 0.9 },
      },
    },
  ],
})

function MountedEditor({ capture }: { capture: (editor: Editor) => void }) {
  renderAudit.editor += 1
  const persistence = useStudioPersistence()
  const editor = useDocumentEditor({ persistence })
  useLayoutEffect(() => capture(editor))

  const session = editor.imageCropSession
  const previewStore = editor.imageCropPreviewStore
  if (!session || !previewStore) return null
  return createElement(ImageCropToolbar, {
    previewStore,
    imageName: image.name,
    onPreview: editor.previewImageCrop,
    onRunCommand: () => undefined,
    isCommandEnabled: (commandId) =>
      commandId !== "image.reset-placement" ||
      imageCropSessionHasChanges(previewStore.getLiveSession()),
    onCancel: editor.discardImageCrop,
    onDone: editor.finishImageCrop,
  })
}

type MountedHarness = {
  current: () => Editor
  host: HTMLDivElement
  root: Root
  unmount: () => Promise<void>
}

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

const mountEditor = async (): Promise<MountedHarness> => {
  const expectedDocument = fixtureDocument()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(expectedDocument))
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  const captured: { current: Editor | null } = { current: null }

  await act(async () => {
    root.render(
      createElement(
        StudioPersistenceTestWrapper,
        null,
        createElement(MountedEditor, {
          capture: (next: Editor) => {
            captured.current = next
          },
        })
      ) as ReactElement
    )
  })

  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (
      captured.current?.repositoryLifecycle.status === "ready" &&
      captured.current.startModel.status === "ready"
    )
      break
    await flushReact()
  }
  if (
    !captured.current ||
    captured.current.repositoryLifecycle.status !== "ready" ||
    captured.current.startModel.status !== "ready"
  ) {
    throw new Error("Mounted editor did not migrate the crop fixture")
  }
  let continued = false
  await act(async () => {
    continued = await captured.current!.openStoredDocument(expectedDocument.id)
  })
  expect(continued).toBe(true)
  expect(captured.current.document).toEqual(expectedDocument)

  return {
    current: () => {
      if (!captured.current) throw new Error("Mounted editor is unavailable")
      return captured.current
    },
    host,
    root,
    unmount: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

const beginCrop = async (mounted: MountedHarness) => {
  await act(async () => {
    expect(mounted.current().beginImageCrop(image.id)).toBe(true)
  })
  expect(mounted.current().imageCropSession?.target.nodeId).toBe(image.id)
}

const previewMany = async (mounted: MountedHarness, count: number) => {
  await act(async () => {
    for (let index = 0; index < count; index += 1) {
      expect(
        mounted.current().previewImageCrop({
          mode: "manual",
          focalX: 0.501 + index / 1_000,
          focalY: 0.499 - index / 2_000,
        })
      ).toBe(true)
    }
  })
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
  })
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})

beforeEach(async () => {
  await deleteRepositoryDatabase()
  localStorage.clear()
  historyAudit.commits.length = 0
  renderAudit.editor = 0
  animationFrames.clear()
})

describe("mounted useDocumentEditor image crop integration", () => {
  it("commits one named canvas transform and Undo restores exact geometry", async () => {
    const mounted = await mountEditor()
    try {
      const baseline = mounted.current()
      const baselineImage = imageFrom(baseline)
      const baselineSnapshotId = baseline.snapshotId
      const baselineOperationVersion = baseline.operationVersion
      const baselineRevision = baseline.document.revision
      const selection = {
        pageId: baseline.document.pages[0].id,
        nodeIds: [image.id],
      }
      await act(async () => baseline.setSelection(selection))
      historyAudit.commits.length = 0

      await act(async () => {
        expect(
          mounted.current().updateNodes([
            {
              nodeId: image.id,
              patch: {
                x: baselineImage.x + 36,
                y: baselineImage.y + 18,
                width: baselineImage.width,
                height: baselineImage.height,
                rotation: baselineImage.rotation,
              },
            },
          ])
        ).toBe(true)
      })

      const committed = mounted.current()
      expect(imageFrom(committed)).toMatchObject({
        x: baselineImage.x + 36,
        y: baselineImage.y + 18,
      })
      expect(committed.document.revision).toBe(baselineRevision + 1)
      expect(committed.operationVersion).toBe(baselineOperationVersion + 1)
      expect(committed.snapshotId).not.toBe(baselineSnapshotId)
      expect(committed.selection).toEqual(selection)
      expect(historyAudit.commits).toEqual([
        expect.objectContaining({
          label: "Move selection",
          beforeSnapshotId: baselineSnapshotId,
          afterSnapshotId: committed.snapshotId,
          commandTypes: ["update_node"],
        }),
      ])

      await act(async () => mounted.current().undo())

      const undone = mounted.current()
      expect(imageFrom(undone)).toMatchObject({
        x: baselineImage.x,
        y: baselineImage.y,
        width: baselineImage.width,
        height: baselineImage.height,
        rotation: baselineImage.rotation,
      })
      expect(undone.snapshotId).toBe(baselineSnapshotId)
      expect(undone.operationVersion).toBe(baselineOperationVersion + 2)
      expect(undone.selection).toEqual(selection)
      expect(undone.canUndo).toBe(false)
      expect(undone.canRedo).toBe(true)
    } finally {
      await mounted.unmount()
    }
  })

  it("keeps 50 previews ephemeral and commits duplicate Enter/Done exactly once", async () => {
    const mounted = await mountEditor()
    try {
      const baseline = mounted.current()
      const baselineDocument = baseline.document
      const baselineSnapshotId = baseline.snapshotId
      const baselineOperationVersion = baseline.operationVersion
      const baselineRevision = baseline.document.revision

      await beginCrop(mounted)
      const editorRendersAfterEntry = renderAudit.editor
      const resetBeforePreview = mounted.host.querySelector<HTMLButtonElement>(
        'button[aria-label="Reset image crop"]'
      )
      expect(resetBeforePreview?.disabled).toBe(true)
      await previewMany(mounted, 50)

      expect(
        mounted.current().imageCropPreviewStore?.getLiveSession().draftRevision
      ).toBe(50)
      expect(renderAudit.editor).toBe(editorRendersAfterEntry)
      expect(mounted.current().document).toBe(baselineDocument)
      expect(mounted.current().snapshotId).toBe(baselineSnapshotId)
      expect(mounted.current().operationVersion).toBe(baselineOperationVersion)
      expect(historyAudit.commits).toEqual([])

      await flushAnimationFrames()
      const resetAfterPreview = mounted.host.querySelector<HTMLButtonElement>(
        'button[aria-label="Reset image crop"]'
      )
      if (!resetAfterPreview) throw new Error("Expected crop reset action")
      expect(resetAfterPreview.disabled).toBe(false)

      const toolbar = mounted.host.querySelector<HTMLElement>(
        '[role="toolbar"][aria-label^="Crop image:"]'
      )!
      const done = [
        ...mounted.host.querySelectorAll<HTMLButtonElement>("button"),
      ].find((button) => button.textContent.includes("Done"))!
      let deliveredStimuli = 0
      toolbar.addEventListener("keydown", () => {
        deliveredStimuli += 1
      })
      done.addEventListener("click", () => {
        deliveredStimuli += 1
      })

      await act(async () => {
        toolbar.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
        )
        done.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      })

      const committed = mounted.current()
      const committedDocument = committed.document
      const committedSnapshotId = committed.snapshotId
      expect(deliveredStimuli).toBe(2)
      expect(committed.imageCropSession).toBeNull()
      expect(committed.document.revision).toBe(baselineRevision + 1)
      expect(committed.operationVersion).toBe(baselineOperationVersion + 1)
      expect(committed.snapshotId).not.toBe(baselineSnapshotId)
      expect(historyAudit.commits).toEqual([
        expect.objectContaining({
          label: "Crop image",
          beforeSnapshotId: baselineSnapshotId,
          afterSnapshotId: committedSnapshotId,
          beforeDocument: baselineDocument,
          afterDocument: committedDocument,
          commandTypes: ["set_image_placement"],
        }),
      ])

      await act(async () => mounted.current().undo())
      expect(mounted.current().document).toBe(baselineDocument)
      expect(mounted.current().snapshotId).toBe(baselineSnapshotId)
      expect(mounted.current().operationVersion).toBe(
        baselineOperationVersion + 2
      )
      expect(mounted.current().canRedo).toBe(true)

      await act(async () => mounted.current().redo())
      expect(mounted.current().document).toBe(committedDocument)
      expect(mounted.current().snapshotId).toBe(committedSnapshotId)
      expect(mounted.current().operationVersion).toBe(
        baselineOperationVersion + 3
      )
      expect(historyAudit.commits).toHaveLength(1)
      expect(historyAudit.commits[0]?.label).toBe("Crop image")
    } finally {
      await mounted.unmount()
    }
  })

  it("cancels a changed crop without changing history or snapshot identity", async () => {
    const mounted = await mountEditor()
    try {
      const before = mounted.current()
      const baselineImage = imageFrom(before)
      await beginCrop(mounted)
      await previewMany(mounted, 12)

      await act(async () => {
        expect(mounted.current().discardImageCrop()).toBe(true)
        expect(mounted.current().discardImageCrop()).toBe(true)
      })

      expect(mounted.current().imageCropSession).toBeNull()
      expect(mounted.current().document).toBe(before.document)
      expect(mounted.current().snapshotId).toBe(before.snapshotId)
      expect(imageFrom(mounted.current()).placement).toEqual(
        baselineImage.placement
      )
      expect(historyAudit.commits).toEqual([])
    } finally {
      await mounted.unmount()
    }
  })

  it("keeps Inspector placement and mask edits in one crop transaction", async () => {
    const mounted = await mountEditor()
    try {
      const baseline = mounted.current()
      const baselineDocument = baseline.document
      const baselineSnapshotId = baseline.snapshotId
      await beginCrop(mounted)

      await act(async () => {
        expect(
          mounted.current().setImagePlacement(image.id, {
            ...image.placement,
            mode: "manual",
            focalX: 0.72,
            focalY: 0.31,
            zoom: 1.65,
            rotation: 17,
          })
        ).toBe(true)
        expect(
          mounted.current().setImageFrameMask(image.id, {
            shape: "rounded_rectangle",
            radius: 0.18,
          })
        ).toBe(true)
      })

      const draft = mounted.current().imageCropPreviewStore?.getLiveSession()
      expect(draft).toMatchObject({
        draft: {
          mode: "manual",
          focalX: 0.72,
          focalY: 0.31,
          zoom: 1.65,
          rotation: 17,
        },
        draftFrameMask: { shape: "rounded_rectangle", radius: 0.18 },
      })
      expect(mounted.current().document).toBe(baselineDocument)
      expect(mounted.current().snapshotId).toBe(baselineSnapshotId)
      expect(historyAudit.commits).toEqual([])

      await act(async () => {
        expect(mounted.current().finishImageCrop()).toBe(true)
      })

      expect(mounted.current().imageCropSession).toBeNull()
      expect(imageFrom(mounted.current())).toMatchObject({
        placement: {
          mode: "manual",
          focalX: 0.72,
          focalY: 0.31,
          zoom: 1.65,
          rotation: 17,
        },
        frameMask: { shape: "rounded_rectangle", radius: 0.18 },
      })
      expect(historyAudit.commits).toEqual([
        expect.objectContaining({
          label: "Crop image",
          beforeSnapshotId: baselineSnapshotId,
          commandTypes: ["set_image_placement", "set_image_frame_mask"],
        }),
      ])
    } finally {
      await mounted.unmount()
    }
  })

  it("settles changed crops once before selection and page transitions", async () => {
    const mounted = await mountEditor()
    try {
      const firstPage = mounted.current().document.pages[0]
      const secondPage = mounted.current().document.pages[1]
      const otherNodeId = firstPage.nodeIds.find(
        (nodeId) => nodeId !== image.id
      )!

      await beginCrop(mounted)
      await previewMany(mounted, 5)
      const firstSnapshot = mounted.current().snapshotId
      await act(async () => {
        mounted.current().setSelection({
          pageId: firstPage.id,
          nodeIds: [otherNodeId],
        })
      })

      expect(mounted.current().selection).toEqual({
        pageId: firstPage.id,
        nodeIds: [otherNodeId],
      })
      expect(historyAudit.commits).toHaveLength(1)
      expect(historyAudit.commits[0]).toMatchObject({
        label: "Crop image",
        beforeSnapshotId: firstSnapshot,
      })

      await act(async () => {
        mounted.current().setSelection({
          pageId: firstPage.id,
          nodeIds: [image.id],
        })
      })
      await beginCrop(mounted)
      await previewMany(mounted, 7)
      const secondBeforeSnapshot = mounted.current().snapshotId
      await act(async () => mounted.current().selectPage(secondPage.id))

      expect(mounted.current().activePageId).toBe(secondPage.id)
      expect(mounted.current().selection).toBeNull()
      expect(historyAudit.commits).toHaveLength(2)
      expect(historyAudit.commits[1]).toMatchObject({
        label: "Crop image",
        beforeSnapshotId: secondBeforeSnapshot,
        afterSnapshotId: mounted.current().snapshotId,
      })
    } finally {
      await mounted.unmount()
    }
  })

  it("cancels the draft before entering review and before Undo or Redo", async () => {
    const mounted = await mountEditor()
    try {
      const baselineDocument = mounted.current().document
      const baselineSnapshot = mounted.current().snapshotId
      const baselinePlacement = imageFrom(mounted.current()).placement

      await beginCrop(mounted)
      await previewMany(mounted, 9)
      await act(async () => {
        mounted.current().proposeChangeSet(reviewChangeSet(mounted.current()))
      })

      expect(mounted.current().pendingChangeSet?.id).toBe("mounted-review")
      expect(mounted.current().imageCropSession).toBeNull()
      expect(mounted.current().document).toBe(baselineDocument)
      expect(mounted.current().snapshotId).toBe(baselineSnapshot)
      expect(imageFrom(mounted.current()).placement).toEqual(baselinePlacement)
      expect(historyAudit.commits).toEqual([])

      await act(async () => mounted.current().discardChangeSet())
      await beginCrop(mounted)
      await previewMany(mounted, 3)
      await act(async () => mounted.current().undo())
      expect(mounted.current().imageCropSession).toBeNull()
      expect(mounted.current().snapshotId).toBe(baselineSnapshot)

      await beginCrop(mounted)
      await previewMany(mounted, 3)
      await act(async () => mounted.current().redo())
      expect(mounted.current().imageCropSession).toBeNull()
      expect(mounted.current().snapshotId).toBe(baselineSnapshot)
      expect(historyAudit.commits).toEqual([])
    } finally {
      await mounted.unmount()
    }
  })
})
