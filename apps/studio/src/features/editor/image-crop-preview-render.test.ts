// @vitest-environment jsdom

import { act, createElement, Profiler } from "react"
import { createRoot } from "react-dom/client"
import { defaultImagePlacement } from "@webmcp/document"
import { createImageCropPreviewStore } from "@webmcp/editor/image-crop-preview-store"
import type { ImageCropPreviewFrameScheduler } from "@webmcp/editor/image-crop-preview-store"
import { imageCropSessionHasChanges } from "@webmcp/editor/image-crop-session"
import type { ImageCropSession } from "@webmcp/editor/image-crop-session"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { ImageCropToolbar } from "./image-crop-toolbar"

function createSession(): ImageCropSession {
  const placement = Object.freeze(defaultImagePlacement())
  const frame = Object.freeze({
    x: 20,
    y: 30,
    width: 320,
    height: 180,
    rotation: 0,
  })
  const frameMask = Object.freeze({ shape: "rectangle" as const })
  return Object.freeze({
    target: Object.freeze({
      documentId: "render-count-document",
      pageId: "render-count-page",
      nodeId: "render-count-image",
      assetId: "render-count-asset",
      src: "https://example.com/render-count.jpg",
    }),
    baseline: placement,
    draft: placement,
    baselineFrame: frame,
    draftFrame: frame,
    baselineFrameMask: frameMask,
    draftFrameMask: frameMask,
    draftRevision: 0,
  })
}

function createFrameScheduler() {
  let callback: (() => void) | null = null
  const scheduler: ImageCropPreviewFrameScheduler = {
    request: vi.fn((next) => {
      callback = next
      return 1
    }),
    cancel: vi.fn(() => {
      callback = null
    }),
  }
  return {
    scheduler,
    flush() {
      const pending = callback
      callback = null
      pending?.()
    },
  }
}

beforeAll(() => {
  class TestResizeObserver implements ResizeObserver {
    disconnect() {}
    observe() {}
    unobserve() {}
  }
  Object.assign(globalThis, { ResizeObserver: TestResizeObserver })
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})

describe("crop preview render boundary", () => {
  it("publishes 50 previews in one crop-bar commit without rerendering its shell", async () => {
    const session = createSession()
    const frames = createFrameScheduler()
    const previewStore = createImageCropPreviewStore(session, frames.scheduler)
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    let shellRenders = 0
    let toolbarCommits = 0

    function Shell() {
      shellRenders += 1
      return createElement(
        Profiler,
        {
          id: "crop-toolbar",
          onRender: () => {
            toolbarCommits += 1
          },
        },
        createElement(ImageCropToolbar, {
          previewStore,
          imageName: "Render-count image",
          onPreview: () => undefined,
          onRunCommand: () => undefined,
          isCommandEnabled: (commandId) =>
            commandId !== "image.reset-placement" ||
            imageCropSessionHasChanges(previewStore.getLiveSession()),
          onCancel: () => undefined,
          onDone: () => undefined,
        })
      )
    }

    try {
      await act(async () => root.render(createElement(Shell)))
      expect(shellRenders).toBe(1)
      const toolbarCommitsAfterMount = toolbarCommits
      expect(toolbarCommitsAfterMount).toBeGreaterThanOrEqual(1)
      expect(
        host.querySelector<HTMLButtonElement>(
          'button[aria-label="Reset image crop"]'
        )?.disabled
      ).toBe(true)

      await act(async () => {
        for (let index = 1; index <= 50; index += 1) {
          expect(
            previewStore.preview(session.target, {
              placement: {
                mode: "manual",
                focalX: index / 100,
              },
            })
          ).toBe("accepted")
        }
      })
      expect(frames.scheduler.request).toHaveBeenCalledTimes(1)
      expect(shellRenders).toBe(1)
      expect(toolbarCommits).toBe(toolbarCommitsAfterMount)

      await act(async () => frames.flush())

      expect(shellRenders).toBe(1)
      expect(toolbarCommits).toBe(toolbarCommitsAfterMount + 1)
      expect(previewStore.getSnapshot().draftRevision).toBe(50)
      expect(
        host.querySelector<HTMLButtonElement>(
          'button[aria-label="Reset image crop"]'
        )?.disabled
      ).toBe(false)
    } finally {
      previewStore.destroy()
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
