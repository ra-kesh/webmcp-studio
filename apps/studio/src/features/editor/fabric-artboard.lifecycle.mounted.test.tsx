// @vitest-environment jsdom

import { act, createRef } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
  CanvasAdapter,
  CanvasAdapterEvents,
  CanvasTextEditingState,
} from "@webmcp/editor"
import { renderConformanceDocument } from "@webmcp/document"
import { quotationStarter } from "./quotation-starter"
import { FabricArtboard } from "./fabric-artboard"
import type { FabricArtboardHandle } from "./fabric-artboard"
import { MultiArtboardRenderRegistry } from "./multi-artboard-render-registry"
import { MultiArtboardRenderRegistryContext } from "./multi-artboard-render-registry-context"

const reactEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}
reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

const fakeAdapter = (
  overrides: Partial<CanvasAdapter> = {}
): CanvasAdapter => ({
  mount: vi.fn(),
  unmount: vi.fn(async () => undefined),
  requestRender: vi.fn(),
  sync: vi.fn(async () => undefined),
  setViewportZoom: vi.fn(),
  previewNodePatch: vi.fn(() => false),
  restoreNodePreview: vi.fn(() => false),
  setSnapTargets: vi.fn(),
  select: vi.fn(),
  getSelection: vi.fn(() => null),
  enterTextEditing: vi.fn(() => false),
  commitTextEditing: vi.fn(() => false),
  cancelTextEditing: vi.fn(() => false),
  applyTextEditingStyle: vi.fn(() => false),
  applyTextEditingParagraphStyle: vi.fn(() => false),
  cancelTransform: vi.fn(() => false),
  setImageCropMode: vi.fn(() => false),
  previewImageCropDraft: vi.fn(() => false),
  nudgeImageCrop: vi.fn(() => false),
  getImageNaturalSize: vi.fn(() => null),
  getImageSourceReadiness: vi.fn(() => null),
  retryImageSource: vi.fn(async () => null),
  exportPng: vi.fn(() => null),
  ...overrides,
})

const adapterModule = (
  factory: (events: CanvasAdapterEvents) => CanvasAdapter
) => {
  function FabricCanvasAdapter(events: CanvasAdapterEvents) {
    return factory(events)
  }
  return {
    FabricCanvasAdapter: FabricCanvasAdapter as unknown as new (
      events: CanvasAdapterEvents
    ) => CanvasAdapter,
  }
}

const baseProps = {
  document: quotationStarter.document,
  pageId: quotationStarter.document.pages[0].id,
  selection: null,
  zoom: 1,
  onNodesChange: vi.fn(() => false),
  onSelectionChange: vi.fn(),
}

describe("FabricArtboard lifecycle", () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    vi.useFakeTimers()
    host = window.document.createElement("div")
    window.document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("turns a stalled adapter import into an accessible retry state", async () => {
    const onRuntimeStateChange = vi.fn()
    const loadAdapter = vi.fn(() => new Promise<never>(() => undefined))

    await act(async () => {
      root.render(
        <FabricArtboard
          {...baseProps}
          onRuntimeStateChange={onRuntimeStateChange}
          runtimeOptions={{ loadAdapter, startupTimeoutMs: 25 }}
        />
      )
    })
    expect(host.textContent).toContain("Preparing canvas")

    await act(async () => vi.advanceTimersByTimeAsync(25))

    expect(host.querySelector('[role="alert"]')).not.toBeNull()
    expect(host.textContent).toContain("Canvas unavailable")
    expect(host.textContent).toContain("Retry canvas")
    expect(onRuntimeStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "error", stage: "startup", attempt: 0 })
    )
  })

  it("registers its page controller with the multi-artboard registry", async () => {
    const registry = new MultiArtboardRenderRegistry()
    const adapter = fakeAdapter()

    await act(async () => {
      root.render(
        <MultiArtboardRenderRegistryContext.Provider value={registry}>
          <FabricArtboard
            {...baseProps}
            runtimeOptions={{
              loadAdapter: async () => adapterModule(() => adapter),
            }}
          />
        </MultiArtboardRenderRegistryContext.Provider>
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(registry.getSnapshot().mountedPageIds).toEqual([
      quotationStarter.document.pages[0].id,
    ])

    await act(async () => {
      root.render(
        <MultiArtboardRenderRegistryContext.Provider value={registry}>
          {null}
        </MultiArtboardRenderRegistryContext.Provider>
      )
      await Promise.resolve()
    })

    expect(registry.getSnapshot().mountedPageIds).toEqual([])
  })

  it("waits for exact prior teardown before a retry mounts another adapter", async () => {
    const firstUnmount = deferred<void>()
    const firstSync = vi.fn(
      (_document, _pageId, signal?: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          })
        })
    )
    const first = fakeAdapter({
      sync: firstSync,
      unmount: vi.fn(() => firstUnmount.promise),
    })
    const second = fakeAdapter()
    const adapters = [first, second]
    const loadAdapter = vi.fn(async () =>
      adapterModule(() => {
        const adapter = adapters.shift()
        if (!adapter) throw new Error("Unexpected adapter mount")
        return adapter
      })
    )

    await act(async () => {
      root.render(
        <FabricArtboard
          {...baseProps}
          runtimeOptions={{
            loadAdapter,
            startupTimeoutMs: 1_000,
            syncTimeoutMs: 25,
          }}
        />
      )
    })
    await act(async () => vi.advanceTimersByTimeAsync(25))
    expect(host.textContent).toContain("Retry canvas")

    await act(async () => {
      host.querySelector<HTMLButtonElement>("button")?.click()
      await Promise.resolve()
    })

    expect(first.unmount).toHaveBeenCalledOnce()
    expect(loadAdapter).toHaveBeenCalledOnce()
    expect(second.mount).not.toHaveBeenCalled()

    await act(async () => {
      firstUnmount.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(loadAdapter).toHaveBeenCalledTimes(2)
    expect(second.mount).toHaveBeenCalledOnce()
    expect(firstSync).toHaveBeenCalledWith(
      quotationStarter.document,
      quotationStarter.document.pages[0].id,
      expect.any(AbortSignal)
    )
  })

  it("blocks remount and requires reload when prior teardown fails", async () => {
    const first = fakeAdapter({
      sync: vi.fn(
        (_document, _pageId, signal?: AbortSignal) =>
          new Promise<void>((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            })
          })
      ),
      unmount: vi.fn(async () => {
        throw new Error("dispose failed")
      }),
    })
    const second = fakeAdapter()
    const adapters = [first, second]
    const loadAdapter = vi.fn(async () =>
      adapterModule(() => {
        const adapter = adapters.shift()
        if (!adapter) throw new Error("Unexpected adapter mount")
        return adapter
      })
    )

    await act(async () => {
      root.render(
        <FabricArtboard
          {...baseProps}
          runtimeOptions={{ loadAdapter, syncTimeoutMs: 25 }}
        />
      )
    })
    await act(async () => vi.advanceTimersByTimeAsync(25))
    await act(async () => {
      host.querySelector<HTMLButtonElement>("button")?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(first.unmount).toHaveBeenCalledOnce()
    expect(loadAdapter).toHaveBeenCalledOnce()
    expect(second.mount).not.toHaveBeenCalled()
    expect(host.textContent).toContain("Reload editor")
    expect(host.textContent).not.toContain("Retry canvas")
  })

  it("keeps the canvas inert until the retried exact attempt is ready", async () => {
    const first = fakeAdapter({
      sync: vi.fn(
        (_document, _pageId, signal?: AbortSignal) =>
          new Promise<void>((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            })
          })
      ),
    })
    let upperCanvas: HTMLButtonElement | null = null
    const second = fakeAdapter({
      mount: vi.fn((canvas) => {
        upperCanvas = window.document.createElement("button")
        upperCanvas.className = "upper-canvas"
        canvas.parentElement?.appendChild(upperCanvas)
      }),
    })
    const adapters = [first, second]
    const loadAdapter = vi.fn(async () =>
      adapterModule(() => {
        const adapter = adapters.shift()
        if (!adapter) throw new Error("Unexpected adapter mount")
        return adapter
      })
    )

    await act(async () => {
      root.render(
        <FabricArtboard
          {...baseProps}
          runtimeOptions={{ loadAdapter, syncTimeoutMs: 25 }}
        />
      )
    })
    expect(host.querySelector("[inert]")).not.toBeNull()
    await act(async () => vi.advanceTimersByTimeAsync(25))

    await act(async () => {
      host.querySelector<HTMLButtonElement>("button")?.click()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(host.querySelector("[inert]")).toBeNull()
    expect(upperCanvas).not.toBeNull()
    expect(window.document.activeElement).toBe(upperCanvas)
  })

  it("restores a requested text selection only after the latest canvas sync", async () => {
    const textNode = quotationStarter.document.nodes.find(
      (node) => node.type === "text"
    )
    if (!textNode) throw new Error("Expected a text node fixture")
    const updateSync = deferred<void>()
    let syncCount = 0
    const enterTextEditing = vi.fn(() => true)
    const adapter = fakeAdapter({
      sync: vi.fn(async () => {
        syncCount += 1
        if (syncCount === 2) await updateSync.promise
      }),
      enterTextEditing,
    })
    const loadAdapter = async () => adapterModule(() => adapter)
    const onTextEditingStart = vi.fn()

    await act(async () => {
      root.render(
        <FabricArtboard {...baseProps} runtimeOptions={{ loadAdapter }} />
      )
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(adapter.sync).toHaveBeenCalledTimes(1)

    const selection = { anchor: 1, focus: 7 }
    await act(async () => {
      root.render(
        <FabricArtboard
          {...baseProps}
          document={{
            ...quotationStarter.document,
            revision: quotationStarter.document.revision + 1,
          }}
          textEditingNodeId={textNode.id}
          textEditingSelection={selection}
          onTextEditingStart={onTextEditingStart}
          runtimeOptions={{ loadAdapter }}
        />
      )
      await Promise.resolve()
    })

    expect(enterTextEditing).not.toHaveBeenCalled()

    await act(async () => {
      updateSync.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(0)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(enterTextEditing).toHaveBeenCalledWith(textNode.id, selection)
    expect(onTextEditingStart).toHaveBeenCalledWith(textNode.id)
  })

  it("removes duplicate selection chrome while direct text editing is active", async () => {
    const textNode = quotationStarter.document.nodes.find(
      (node) => node.type === "text"
    )
    if (!textNode || textNode.type !== "text") {
      throw new Error("Expected an editable text node fixture")
    }
    let adapterEvents: CanvasAdapterEvents | undefined
    const adapter = fakeAdapter()
    const loadAdapter = async () =>
      adapterModule((events) => {
        adapterEvents = events
        return adapter
      })

    await act(async () => {
      root.render(
        <FabricArtboard
          {...baseProps}
          selection={{
            pageId: quotationStarter.document.pages[0].id,
            nodeIds: [textNode.id],
          }}
          runtimeOptions={{ loadAdapter }}
        />
      )
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(host.querySelector('[data-node-outline="selection"]')).not.toBeNull()

    const editingState: CanvasTextEditingState = {
      nodeId: textNode.id,
      text: textNode.text,
      selection: { anchor: 0, focus: 0 },
      typographyStyle: { kind: "value", value: null },
      paintStyle: { kind: "value", value: null },
      link: { kind: "none" },
      paragraph: {
        align: { kind: "value", value: textNode.align },
        list: { kind: "value", value: null },
      },
      style: {
        color: { kind: "value", value: textNode.color },
        fontFamily: { kind: "value", value: textNode.fontFamily },
        fontSize: { kind: "value", value: textNode.fontSize },
        fontWeight: { kind: "value", value: textNode.fontWeight },
        italic: { kind: "value", value: false },
        decoration: { kind: "value", value: "none" },
        lineHeight: { kind: "value", value: textNode.lineHeight },
        letterSpacing: { kind: "value", value: textNode.letterSpacing },
      },
    }
    await act(async () => adapterEvents?.onTextEditingChange?.(editingState))
    expect(host.querySelector('[data-node-outline="selection"]')).toBeNull()

    await act(async () => adapterEvents?.onTextEditingChange?.(null))
    expect(host.querySelector('[data-node-outline="selection"]')).not.toBeNull()
  })

  it("bounds a visible image retry and reports the exact resource token", async () => {
    const image = renderConformanceDocument.nodes.find(
      (node) => node.id === "image-cover"
    )
    const page = renderConformanceDocument.pages.find((candidate) =>
      candidate.nodeIds.includes("image-cover")
    )
    if (image?.type !== "image" || !page) {
      throw new Error("Expected image retry fixtures")
    }
    const adapter = fakeAdapter({
      getImageSourceReadiness: vi.fn(() => "unavailable" as const),
      retryImageSource: vi.fn(() => new Promise<null>(() => undefined)),
    })
    const onImageSourceStateChange = vi.fn()
    const artboardRef = createRef<FabricArtboardHandle>()
    const document = {
      ...renderConformanceDocument,
      nodes: [image],
      pages: [{ ...page, nodeIds: [image.id] }],
      groups: [],
    }

    await act(async () => {
      root.render(
        <FabricArtboard
          ref={artboardRef}
          {...baseProps}
          document={document}
          pageId={page.id}
          imageResourceTokens={{ [image.id]: "asset-generation-2" }}
          onImageSourceStateChange={onImageSourceStateChange}
          runtimeOptions={{
            loadAdapter: async () => adapterModule(() => adapter),
          }}
        />
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    onImageSourceStateChange.mockClear()

    act(() => artboardRef.current?.retryImageSource(image.id))
    await act(async () => vi.advanceTimersByTimeAsync(8_000))

    expect(adapter.retryImageSource).toHaveBeenCalledWith(
      image.id,
      expect.any(AbortSignal)
    )
    expect(onImageSourceStateChange).toHaveBeenNthCalledWith(1, {
      nodeId: image.id,
      src: image.src,
      resourceToken: "asset-generation-2",
      readiness: "loading",
    })
    expect(onImageSourceStateChange).toHaveBeenLastCalledWith({
      nodeId: image.id,
      src: image.src,
      resourceToken: "asset-generation-2",
      readiness: "unavailable",
    })
  })
})
