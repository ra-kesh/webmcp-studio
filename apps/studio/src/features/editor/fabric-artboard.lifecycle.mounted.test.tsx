// @vitest-environment jsdom

import { act, createRef, useCallback, useState } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
  CanvasAdapter,
  CanvasAdapterEvents,
  CanvasTextEditingState,
} from "@webmcp/editor"
import { renderConformanceDocument } from "@webmcp/document"
import type { Document } from "@webmcp/document"
import { quotationStarter } from "./quotation-starter"
import { FabricArtboard } from "./fabric-artboard"
import type { FabricArtboardHandle } from "./fabric-artboard"
import { MultiArtboardRenderRegistry } from "./multi-artboard-render-registry"
import { MultiArtboardRenderRegistryContext } from "./multi-artboard-render-registry-context"
import {
  canvasPageMutationAdmitted,
  canvasMountedDocumentMutationAdmitted,
  reduceCanvasRuntimeAdmission,
  releaseCanvasRuntimeAdmission,
} from "./canvas-runtime-admission"
import type { CanvasRuntimeAdmissionRegistry } from "./canvas-runtime-admission"

const reactEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}

function TwoPageRuntimeAdmissionHarness({
  document,
  firstPageSyncIdentity,
  loadAdapter,
}: {
  document: Document
  firstPageSyncIdentity: string
  loadAdapter: () => Promise<ReturnType<typeof adapterModule>>
}) {
  const [registry, setRegistry] = useState<CanvasRuntimeAdmissionRegistry>(
    () => new Map()
  )
  const onRuntimeStateChange = useCallback(
    (report: Parameters<typeof reduceCanvasRuntimeAdmission>[1]) =>
      setRegistry((current) => reduceCanvasRuntimeAdmission(current, report)),
    []
  )
  const onRuntimeOwnerRelease = useCallback(
    (owner: Parameters<typeof releaseCanvasRuntimeAdmission>[1]) =>
      setRegistry((current) => releaseCanvasRuntimeAdmission(current, owner)),
    []
  )
  const [firstPage, secondPage] = document.pages
  const requests = new Map([
    [
      firstPage.id,
      {
        documentId: document.id,
        documentRevision: document.revision,
        pageId: firstPage.id,
        documentSyncIdentity: firstPageSyncIdentity,
      },
    ],
    [
      secondPage.id,
      {
        documentId: document.id,
        documentRevision: document.revision,
        pageId: secondPage.id,
        documentSyncIdentity: "second-page-stable",
      },
    ],
  ])
  return (
    <div
      data-all-mounted-admitted={canvasMountedDocumentMutationAdmitted(
        registry,
        document.id,
        requests
      )}
    >
      {[firstPage, secondPage].map((page, index) => (
        <FabricArtboard
          key={page.id}
          {...baseProps}
          document={document}
          documentSyncIdentity={
            index === 0 ? firstPageSyncIdentity : "second-page-stable"
          }
          pageId={page.id}
          onRuntimeOwnerRelease={onRuntimeOwnerRelease}
          onRuntimeStateChange={onRuntimeStateChange}
          runtimeOptions={{ loadAdapter }}
        />
      ))}
    </div>
  )
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
  setMutationAdmission: vi.fn(),
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

function RuntimeAdmissionHarness({
  loadAdapter,
  mounted,
}: {
  loadAdapter: () => Promise<ReturnType<typeof adapterModule>>
  mounted: boolean
}) {
  const [registry, setRegistry] = useState<CanvasRuntimeAdmissionRegistry>(
    () => new Map()
  )
  const onRuntimeStateChange = useCallback(
    (report: Parameters<typeof reduceCanvasRuntimeAdmission>[1]) =>
      setRegistry((current) => reduceCanvasRuntimeAdmission(current, report)),
    []
  )
  const onRuntimeOwnerRelease = useCallback(
    (owner: Parameters<typeof releaseCanvasRuntimeAdmission>[1]) =>
      setRegistry((current) => releaseCanvasRuntimeAdmission(current, owner)),
    []
  )
  const requestedIdentity = {
    documentId: quotationStarter.document.id,
    documentRevision: quotationStarter.document.revision,
    pageId: quotationStarter.document.pages[0].id,
    documentSyncIdentity: "remount-page-sync",
  }
  return (
    <div
      data-shell-mutation-admitted={canvasPageMutationAdmitted(
        registry,
        requestedIdentity
      )}
    >
      {mounted ? (
        <FabricArtboard
          {...baseProps}
          documentSyncIdentity={requestedIdentity.documentSyncIdentity}
          onRuntimeOwnerRelease={onRuntimeOwnerRelease}
          onRuntimeStateChange={onRuntimeStateChange}
          runtimeOptions={{ loadAdapter }}
        />
      ) : null}
    </div>
  )
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

  it("closes shell mutation admission when a culled page remounts", async () => {
    const secondSync = deferred<void>()
    const adapters = [
      fakeAdapter(),
      fakeAdapter({ sync: vi.fn(() => secondSync.promise) }),
    ]
    const loadAdapter = vi.fn(async () =>
      adapterModule(() => {
        const adapter = adapters.shift()
        if (!adapter) throw new Error("Unexpected adapter mount")
        return adapter
      })
    )
    const render = (mounted: boolean) => (
      <RuntimeAdmissionHarness loadAdapter={loadAdapter} mounted={mounted} />
    )

    await act(async () => {
      root.render(render(true))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(
      host
        .querySelector("[data-shell-mutation-admitted]")
        ?.getAttribute("data-shell-mutation-admitted")
    ).toBe("true")

    await act(async () => root.render(render(false)))
    await act(async () => {
      root.render(render(true))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(
      host
        .querySelector("[data-shell-mutation-admitted]")
        ?.getAttribute("data-shell-mutation-admitted")
    ).toBe("false")

    await act(async () => {
      secondSync.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(
      host
        .querySelector("[data-shell-mutation-admitted]")
        ?.getAttribute("data-shell-mutation-admitted")
    ).toBe("true")
  })

  it("keeps an unchanged mounted page ready when another page revision syncs", async () => {
    const loadAdapter = vi.fn(async () => adapterModule(() => fakeAdapter()))
    const render = (document: Document, firstPageSyncIdentity: string) => (
      <TwoPageRuntimeAdmissionHarness
        document={document}
        firstPageSyncIdentity={firstPageSyncIdentity}
        loadAdapter={loadAdapter}
      />
    )

    await act(async () => {
      root.render(render(renderConformanceDocument, "first-page:1"))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(
      host
        .querySelector("[data-all-mounted-admitted]")
        ?.getAttribute("data-all-mounted-admitted")
    ).toBe("true")

    const revisedDocument: Document = {
      ...renderConformanceDocument,
      revision: renderConformanceDocument.revision + 1,
    }
    await act(async () => {
      root.render(render(revisedDocument, "first-page:2"))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(
      host
        .querySelector("[data-all-mounted-admitted]")
        ?.getAttribute("data-all-mounted-admitted")
    ).toBe("true")
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

  it("keeps the last good frame visible but mutation-inert while an incremental sync settles", async () => {
    const textNode = quotationStarter.document.nodes.find(
      (node) => node.type === "text"
    )
    if (!textNode) throw new Error("Expected a text node fixture")
    const updateSync = deferred<void>()
    let syncCount = 0
    const adapter = fakeAdapter({
      sync: vi.fn(async () => {
        syncCount += 1
        if (syncCount === 2) await updateSync.promise
      }),
    })
    const loadAdapter = async () => adapterModule(() => adapter)

    await act(async () => {
      root.render(
        <FabricArtboard {...baseProps} runtimeOptions={{ loadAdapter }} />
      )
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(
      host.querySelector('[data-canvas-runtime-state="ready"]')
    ).not.toBeNull()

    await act(async () => {
      root.render(
        <FabricArtboard
          {...baseProps}
          interactive={false}
          runtimeOptions={{ loadAdapter }}
        />
      )
      await Promise.resolve()
    })
    expect(adapter.sync).toHaveBeenCalledTimes(1)
    expect(adapter.cancelTextEditing).toHaveBeenCalled()
    expect(adapter.cancelTransform).toHaveBeenCalled()

    const selection = {
      pageId: quotationStarter.document.pages[0].id,
      nodeIds: [textNode.id],
    }
    await act(async () => {
      root.render(
        <FabricArtboard
          {...baseProps}
          document={{
            ...quotationStarter.document,
            revision: quotationStarter.document.revision + 1,
          }}
          selection={selection}
          interactive
          runtimeOptions={{ loadAdapter }}
        />
      )
      await Promise.resolve()
    })

    expect(adapter.sync).toHaveBeenCalledTimes(2)
    expect(
      host.querySelector('[data-canvas-runtime-state="syncing"]')
    ).not.toBeNull()
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "Updating canvas"
    )
    expect(host.querySelector("[inert]")).not.toBeNull()
    expect(adapter.setMutationAdmission).toHaveBeenLastCalledWith(false)
    expect(adapter.select).not.toHaveBeenCalledWith(selection)

    await act(async () => {
      updateSync.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(adapter.select).toHaveBeenLastCalledWith(selection)
    expect(adapter.setMutationAdmission).toHaveBeenLastCalledWith(true)
    expect(host.querySelector('[data-node-outline="selection"]')).not.toBeNull()
  })

  it("marks a failed incremental sync stale, rejects stale events, and retries the current identity without remounting", async () => {
    const updateSync = deferred<void>()
    let syncCount = 0
    let adapterEvents: CanvasAdapterEvents | undefined
    const adapter = fakeAdapter({
      sync: vi.fn(async () => {
        syncCount += 1
        if (syncCount === 2) await updateSync.promise
      }),
    })
    const loadAdapter = vi.fn(async () =>
      adapterModule((events) => {
        adapterEvents = events
        return adapter
      })
    )
    const onNodesChange = vi.fn(() => false)
    const onSelectionChange = vi.fn()
    const onRuntimeStateChange = vi.fn()
    const updatedDocument = {
      ...quotationStarter.document,
      revision: quotationStarter.document.revision + 1,
    }

    await act(async () => {
      root.render(
        <FabricArtboard
          {...baseProps}
          onNodesChange={onNodesChange}
          onSelectionChange={onSelectionChange}
          onRuntimeStateChange={onRuntimeStateChange}
          runtimeOptions={{ loadAdapter }}
        />
      )
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      root.render(
        <FabricArtboard
          {...baseProps}
          document={updatedDocument}
          documentSyncIdentity="page-v2"
          onNodesChange={onNodesChange}
          onSelectionChange={onSelectionChange}
          onRuntimeStateChange={onRuntimeStateChange}
          runtimeOptions={{ loadAdapter }}
        />
      )
      await Promise.resolve()
    })

    expect(adapterEvents?.onNodesChange([{ nodeId: "stale", patch: {} }])).toBe(
      false
    )
    adapterEvents?.onSelectionChange({
      pageId: baseProps.pageId,
      nodeIds: ["stale"],
    })
    expect(onNodesChange).not.toHaveBeenCalled()
    expect(onSelectionChange).not.toHaveBeenCalled()

    await act(async () => {
      updateSync.reject(new Error("incremental sync failed"))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(
      host.querySelector('[data-canvas-runtime-state="stale_error"]')
    ).not.toBeNull()
    expect(host.textContent).toContain("Canvas is out of date")
    expect(host.textContent).toContain("Retry update")
    expect(host.querySelector("canvas")).not.toBeNull()
    expect(host.querySelector("[inert]")).not.toBeNull()
    expect(adapter.setMutationAdmission).toHaveBeenLastCalledWith(false)
    expect(onRuntimeStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "stale_error",
        documentId: updatedDocument.id,
        documentRevision: updatedDocument.revision,
        pageId: baseProps.pageId,
        documentSyncIdentity: "page-v2",
        appliedIdentity: expect.objectContaining({
          documentId: quotationStarter.document.id,
          documentRevision: quotationStarter.document.revision,
          pageId: baseProps.pageId,
        }),
      })
    )

    await act(async () => {
      host.querySelector<HTMLButtonElement>("button")?.click()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(loadAdapter).toHaveBeenCalledOnce()
    expect(adapter.sync).toHaveBeenCalledTimes(3)
    expect(adapter.sync).toHaveBeenLastCalledWith(
      updatedDocument,
      baseProps.pageId,
      expect.any(AbortSignal)
    )
    expect(
      host.querySelector('[data-canvas-runtime-state="ready"]')
    ).not.toBeNull()
    expect(adapter.setMutationAdmission).toHaveBeenLastCalledWith(true)
  })

  it("times out a failed incremental sync into the same stale retry state", async () => {
    let syncCount = 0
    const adapter = fakeAdapter({
      sync: vi.fn(async () => {
        syncCount += 1
        if (syncCount === 2) await new Promise<void>(() => undefined)
      }),
    })
    const loadAdapter = async () => adapterModule(() => adapter)

    await act(async () => {
      root.render(
        <FabricArtboard
          {...baseProps}
          runtimeOptions={{ loadAdapter, syncTimeoutMs: 25 }}
        />
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      root.render(
        <FabricArtboard
          {...baseProps}
          document={{
            ...quotationStarter.document,
            revision: quotationStarter.document.revision + 1,
          }}
          documentSyncIdentity="timed-out-v2"
          runtimeOptions={{ loadAdapter, syncTimeoutMs: 25 }}
        />
      )
      await Promise.resolve()
    })
    await act(async () => vi.advanceTimersByTimeAsync(25))

    expect(
      host.querySelector('[data-canvas-runtime-state="stale_error"]')
    ).not.toBeNull()
    expect(host.textContent).toContain("Retry update")
    expect(adapter.setMutationAdmission).toHaveBeenLastCalledWith(false)
  })

  it("does not reuse an applied frame when another document has the same page id", async () => {
    let syncCount = 0
    const adapter = fakeAdapter({
      sync: vi.fn(async () => {
        syncCount += 1
        if (syncCount === 2) throw new Error("replacement document failed")
      }),
    })
    const loadAdapter = async () => adapterModule(() => adapter)

    await act(async () => {
      root.render(
        <FabricArtboard {...baseProps} runtimeOptions={{ loadAdapter }} />
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    const replacementDocument = {
      ...quotationStarter.document,
      id: "replacement-document-same-page-id",
      revision: 0,
    }
    await act(async () => {
      root.render(
        <FabricArtboard
          {...baseProps}
          document={replacementDocument}
          documentSyncIdentity="replacement-page-v0"
          runtimeOptions={{ loadAdapter }}
        />
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(
      host.querySelector('[data-canvas-runtime-state="error"]')
    ).not.toBeNull()
    expect(host.querySelector("[data-canvas-applied-document-id]")).toBeNull()
    expect(host.textContent).toContain("Canvas unavailable")
    expect(host.textContent).not.toContain("Canvas is out of date")
  })

  it("isolates applied identity and stale admission between mounted artboards", async () => {
    const firstPage = quotationStarter.document.pages[0]
    const secondPage = quotationStarter.document.pages[1]
    const firstUpdate = deferred<void>()
    let firstSyncCount = 0
    const firstAdapter = fakeAdapter({
      sync: vi.fn(async () => {
        firstSyncCount += 1
        if (firstSyncCount === 2) await firstUpdate.promise
      }),
    })
    const secondAdapter = fakeAdapter()
    const firstRuntimeOptions = {
      loadAdapter: async () => adapterModule(() => firstAdapter),
    }
    const secondRuntimeOptions = {
      loadAdapter: async () => adapterModule(() => secondAdapter),
    }
    const renderPair = (documentRevision: number, firstIdentity: string) => (
      <>
        <FabricArtboard
          {...baseProps}
          document={{
            ...quotationStarter.document,
            revision: documentRevision,
          }}
          documentSyncIdentity={firstIdentity}
          pageId={firstPage.id}
          runtimeOptions={firstRuntimeOptions}
        />
        <FabricArtboard
          {...baseProps}
          document={{
            ...quotationStarter.document,
            revision: documentRevision,
          }}
          documentSyncIdentity="second-page-v1"
          pageId={secondPage.id}
          runtimeOptions={secondRuntimeOptions}
        />
      </>
    )

    await act(async () => {
      root.render(
        renderPair(quotationStarter.document.revision, "first-page-v1")
      )
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      root.render(
        renderPair(quotationStarter.document.revision + 1, "first-page-v2")
      )
      await Promise.resolve()
    })

    const firstShell = host.querySelector(
      `[data-canvas-page-id="${firstPage.id}"]`
    )
    const secondShell = host.querySelector(
      `[data-canvas-page-id="${secondPage.id}"]`
    )
    expect(firstShell?.getAttribute("data-canvas-runtime-state")).toBe(
      "syncing"
    )
    expect(secondShell?.getAttribute("data-canvas-runtime-state")).toBe("ready")
    expect(firstAdapter.sync).toHaveBeenCalledTimes(2)
    expect(secondAdapter.sync).toHaveBeenCalledOnce()
    expect(firstAdapter.setMutationAdmission).toHaveBeenLastCalledWith(false)
    expect(secondAdapter.setMutationAdmission).toHaveBeenLastCalledWith(true)

    await act(async () => {
      firstUpdate.reject(new Error("first artboard failed"))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(firstShell?.getAttribute("data-canvas-runtime-state")).toBe(
      "stale_error"
    )
    expect(secondShell?.getAttribute("data-canvas-runtime-state")).toBe("ready")
    expect(secondAdapter.setMutationAdmission).toHaveBeenLastCalledWith(true)
  })

  it("removes duplicate selection chrome while direct text editing is active", async () => {
    const textNode = quotationStarter.document.nodes.find(
      (node) => node.type === "text"
    )
    if (!textNode) {
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

  it("restores the canonical selection when admission reopens without a sync", async () => {
    const adapter = fakeAdapter()
    const selection = {
      pageId: quotationStarter.document.pages[0].id,
      nodeIds: [quotationStarter.document.pages[0].nodeIds[0]],
    }
    const render = (interactive: boolean) => (
      <FabricArtboard
        {...baseProps}
        interactive={interactive}
        selection={selection}
        runtimeOptions={{
          loadAdapter: async () => adapterModule(() => adapter),
        }}
      />
    )

    await act(async () => {
      root.render(render(true))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(adapter.sync).toHaveBeenCalledOnce()
    expect(adapter.select).toHaveBeenLastCalledWith(selection)

    await act(async () => root.render(render(false)))
    expect(adapter.setMutationAdmission).toHaveBeenLastCalledWith(false)
    vi.mocked(adapter.select).mockClear()

    await act(async () => root.render(render(true)))
    expect(adapter.setMutationAdmission).toHaveBeenLastCalledWith(true)
    expect(adapter.select).toHaveBeenCalledOnce()
    expect(adapter.select).toHaveBeenLastCalledWith(selection)
    expect(adapter.sync).toHaveBeenCalledOnce()
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
