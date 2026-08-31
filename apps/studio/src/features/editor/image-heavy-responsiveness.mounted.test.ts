// @vitest-environment jsdom

import "fake-indexeddb/auto"
import { webcrypto } from "node:crypto"
import {
  act,
  createElement,
  Fragment,
  Profiler,
  useLayoutEffect,
  useSyncExternalStore,
} from "react"
import type { ReactElement } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { imageCropSessionHasChanges } from "@webmcp/editor/image-crop-session"
import type { ImageCropPreviewStore } from "@webmcp/editor/image-crop-preview-store"
import type * as RenderViewModule from "@webmcp/render-view"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { ImageCropToolbar } from "./image-crop-toolbar"
import {
  createImageHeavyPerformanceFixture,
  IMAGE_HEAVY_PERFORMANCE_IMAGES_PER_PAGE,
  IMAGE_HEAVY_PERFORMANCE_PAGE_COUNT,
} from "./image-heavy-performance-fixture.test-contract"
import { PageFilmstrip } from "./page-filmstrip"
import {
  StudioPersistenceTestWrapper,
  useStudioPersistence,
} from "./studio-persistence-test-wrapper"
import { useDocumentEditor } from "./use-document-editor"

const artboardAudit = vi.hoisted(() => ({
  rendersByPage: new Map<string, number>(),
}))

vi.mock("@webmcp/render-view", async (importOriginal) => {
  const actual = await importOriginal<typeof RenderViewModule>()
  return {
    ...actual,
    Artboard: ({ pageId }: { pageId: string }) => {
      artboardAudit.rendersByPage.set(
        pageId,
        (artboardAudit.rendersByPage.get(pageId) ?? 0) + 1
      )
      return null
    },
  }
})

type Editor = ReturnType<typeof useDocumentEditor>

const STORAGE_KEY = "webmcp-studio:northstar-document:v2"
const REPOSITORY_DATABASE_NAME = "webmcp-studio-documents"
const fixture = createImageHeavyPerformanceFixture()
const renderAudit = {
  shell: 0,
  toolbar: 0,
  cropRendererByPage: new Map<string, number>(),
}
let nextAnimationFrameId = 1
const animationFrames = new Map<number, FrameRequestCallback>()
const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
  const frameId = nextAnimationFrameId++
  animationFrames.set(frameId, callback)
  return frameId
})

const deleteRepositoryDatabase = () =>
  new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(REPOSITORY_DATABASE_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })

function CropRendererSubscription({
  pageId,
  previewStore,
}: {
  pageId: string
  previewStore: ImageCropPreviewStore
}) {
  useSyncExternalStore(
    previewStore.subscribe,
    previewStore.getSnapshot,
    previewStore.getSnapshot
  )
  renderAudit.cropRendererByPage.set(
    pageId,
    (renderAudit.cropRendererByPage.get(pageId) ?? 0) + 1
  )
  return null
}

function MountedPerformanceEditor({
  capture,
}: {
  capture: (editor: Editor) => void
}) {
  renderAudit.shell += 1
  const persistence = useStudioPersistence()
  const editor = useDocumentEditor({ persistence })
  useLayoutEffect(() => capture(editor))

  const previewStore = editor.imageCropPreviewStore
  const cropSession = editor.imageCropSession

  return createElement(
    Fragment,
    null,
    createElement(PageFilmstrip, {
      document: editor.previewDocument,
      activePageId: editor.activePageId,
      reviewPending: Boolean(editor.pendingChangeSet),
      onSelectPage: editor.selectPage,
      onAddPage: editor.addPage,
      onDuplicatePage: editor.duplicatePage,
      onRemovePage: editor.removePage,
      onReorderPage: editor.reorderPage,
    }),
    previewStore && cropSession
      ? createElement(
          Fragment,
          null,
          createElement(
            Profiler,
            {
              id: "image-heavy-crop-toolbar",
              onRender: () => {
                renderAudit.toolbar += 1
              },
            },
            createElement(ImageCropToolbar, {
              previewStore,
              imageName: "Image-heavy crop target",
              onPreview: editor.previewImageCrop,
              onRunCommand: () => undefined,
              isCommandEnabled: (commandId) =>
                commandId !== "image.reset-placement" ||
                imageCropSessionHasChanges(previewStore.getLiveSession()),
              onCancel: editor.discardImageCrop,
              onDone: editor.finishImageCrop,
            })
          ),
          createElement(CropRendererSubscription, {
            pageId: cropSession.target.pageId,
            previewStore,
          })
        )
      : null
  )
}

type MountedHarness = Readonly<{
  current: () => Editor
  host: HTMLDivElement
  root: Root
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

const mountEditor = async (): Promise<MountedHarness> => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(fixture.document))
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  const captured: { current: Editor | null } = { current: null }

  await act(async () => {
    root.render(
      createElement(
        StudioPersistenceTestWrapper,
        null,
        createElement(MountedPerformanceEditor, {
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
    throw new Error("Mounted editor did not migrate the image-heavy fixture")
  }
  let continued = false
  await act(async () => {
    continued = await captured.current!.openStoredDocument(fixture.document.id)
  })
  expect(continued).toBe(true)
  expect(captured.current.document).toEqual(fixture.document)
  let flushed = false
  await act(async () => {
    flushed = await captured.current!.flushActiveDraft()
  })
  expect(flushed).toBe(true)
  expect(captured.current.localSaveState.status).toBe("saved")

  const firstPageId = fixture.document.pages[0].id
  if (captured.current.activePageId !== firstPageId) {
    await act(async () => captured.current?.selectPage(firstPageId))
  }

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

const totalArtboardRenders = () =>
  [...artboardAudit.rendersByPage.values()].reduce(
    (total, count) => total + count,
    0
  )

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
    requestAnimationFrame: requestAnimationFrameMock,
    cancelAnimationFrame: (frameId: number) => {
      animationFrames.delete(frameId)
    },
  })
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})

beforeEach(async () => {
  await deleteRepositoryDatabase()
  localStorage.clear()
  artboardAudit.rendersByPage.clear()
  renderAudit.shell = 0
  renderAudit.toolbar = 0
  renderAudit.cropRendererByPage.clear()
  animationFrames.clear()
  requestAnimationFrameMock.mockClear()
})

describe("20-page image-heavy responsiveness contract", () => {
  it("keeps the fixture representative and every source page-local", () => {
    expect(fixture.document.pages).toHaveLength(
      IMAGE_HEAVY_PERFORMANCE_PAGE_COUNT
    )
    expect(fixture.document.nodes).toHaveLength(
      IMAGE_HEAVY_PERFORMANCE_PAGE_COUNT *
        IMAGE_HEAVY_PERFORMANCE_IMAGES_PER_PAGE
    )
    const imageSources = fixture.document.nodes.flatMap((node) =>
      node.type === "image" ? [node.src] : []
    )
    expect(new Set(imageSources).size).toBe(
      IMAGE_HEAVY_PERFORMANCE_PAGE_COUNT *
        IMAGE_HEAVY_PERFORMANCE_IMAGES_PER_PAGE
    )

    for (const page of fixture.document.pages) {
      expect(fixture.imageNodeIdsByPage[page.id]).toEqual(page.nodeIds)
      expect(page.nodeIds).toHaveLength(IMAGE_HEAVY_PERFORMANCE_IMAGES_PER_PAGE)
    }
  })

  it("bounds selection and 50 crop previews to the active page subscribers", async () => {
    const mounted = await mountEditor()
    try {
      expect(
        mounted.host.querySelectorAll<HTMLButtonElement>(
          'button[aria-label^="Open page "]'
        )
      ).toHaveLength(IMAGE_HEAVY_PERFORMANCE_PAGE_COUNT)

      const firstPage = fixture.document.pages[0]
      const secondPage = fixture.document.pages[1]
      const firstTarget = firstPage.nodeIds[0]
      const secondTarget = secondPage.nodeIds[0]
      const secondSibling = secondPage.nodeIds[1]

      artboardAudit.rendersByPage.clear()
      const shellBeforeNodeSelection = renderAudit.shell
      await act(async () => {
        mounted.current().setSelection({
          pageId: firstPage.id,
          nodeIds: [firstTarget],
        })
      })
      expect(renderAudit.shell).toBe(shellBeforeNodeSelection + 1)
      expect(totalArtboardRenders()).toBe(0)

      const shellBeforePageSelection = renderAudit.shell
      await act(async () => mounted.current().selectPage(secondPage.id))
      await flushReact()
      expect(renderAudit.shell).toBe(shellBeforePageSelection + 1)
      expect(totalArtboardRenders()).toBe(0)

      artboardAudit.rendersByPage.clear()
      const shellBeforeSecondSelection = renderAudit.shell
      await act(async () => {
        mounted.current().setSelection({
          pageId: secondPage.id,
          nodeIds: [secondSibling],
        })
      })
      expect(renderAudit.shell).toBe(shellBeforeSecondSelection + 1)
      expect(totalArtboardRenders()).toBe(0)

      const baselineDocument = mounted.current().document
      const baselineSnapshotId = mounted.current().snapshotId
      const baselineOperationVersion = mounted.current().operationVersion
      const shellBeforeCropEntry = renderAudit.shell
      await act(async () => {
        expect(mounted.current().beginImageCrop(secondTarget)).toBe(true)
      })
      expect(renderAudit.shell).toBe(shellBeforeCropEntry + 1)
      expect(totalArtboardRenders()).toBe(0)

      const toolbarAfterEntry = renderAudit.toolbar
      const cropRendererAfterEntry =
        renderAudit.cropRendererByPage.get(secondPage.id) ?? 0
      const shellAfterEntry = renderAudit.shell
      await act(async () => {
        for (let index = 1; index <= 50; index += 1) {
          expect(
            mounted.current().previewImageCrop({
              mode: "manual",
              focalX: 0.25 + index / 100,
              focalY: 0.75 - index / 200,
            })
          ).toBe(true)
        }
      })

      expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1)
      expect(renderAudit.shell).toBe(shellAfterEntry)
      expect(renderAudit.toolbar).toBe(toolbarAfterEntry)
      expect(renderAudit.cropRendererByPage.get(secondPage.id)).toBe(
        cropRendererAfterEntry
      )
      expect(renderAudit.cropRendererByPage.size).toBe(1)
      expect(totalArtboardRenders()).toBe(0)
      expect(mounted.current().document).toBe(baselineDocument)
      expect(mounted.current().snapshotId).toBe(baselineSnapshotId)
      expect(mounted.current().operationVersion).toBe(baselineOperationVersion)

      await flushAnimationFrames()

      expect(renderAudit.shell).toBe(shellAfterEntry)
      expect(renderAudit.toolbar).toBe(toolbarAfterEntry + 1)
      expect(renderAudit.cropRendererByPage.get(secondPage.id)).toBe(
        cropRendererAfterEntry + 1
      )
      expect(renderAudit.cropRendererByPage.size).toBe(1)
      expect(totalArtboardRenders()).toBe(0)
      expect(
        mounted.current().imageCropPreviewStore?.getSnapshot().draftRevision
      ).toBe(50)
      expect(mounted.current().document).toBe(baselineDocument)
      expect(mounted.current().snapshotId).toBe(baselineSnapshotId)
      expect(mounted.current().operationVersion).toBe(baselineOperationVersion)

      await act(async () => {
        expect(mounted.current().finishImageCrop()).toBe(true)
      })
      expect(mounted.current().imageCropSession).toBeNull()
      expect(mounted.current().document.revision).toBe(
        baselineDocument.revision + 1
      )
      expect(mounted.current().snapshotId).not.toBe(baselineSnapshotId)
      expect(mounted.current().operationVersion).toBe(
        baselineOperationVersion + 1
      )
      expect(mounted.current().canUndo).toBe(true)

      await act(async () => mounted.current().undo())
      expect(mounted.current().document).toBe(baselineDocument)
      expect(mounted.current().snapshotId).toBe(baselineSnapshotId)
      expect(mounted.current().operationVersion).toBe(
        baselineOperationVersion + 2
      )
    } finally {
      await mounted.unmount()
    }
  })
})
