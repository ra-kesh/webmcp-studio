// @vitest-environment jsdom

import { act, useLayoutEffect, useSyncExternalStore } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import type { CurrentDraftEnvelope } from "./current-draft-repository"
import type {
  DocumentDraftRecord,
  DocumentDraftSummary,
  DraftListResult,
  DraftRepositoryFailure,
  DraftWriteResult,
} from "./document-draft-repository"
import {
  RecentDocumentsController,
  RECENT_DOCUMENTS_PAGE_SIZE,
} from "./recent-documents-controller"
import type { RecentDocumentsDependencies } from "./recent-documents-controller"
import type { RecentDocumentsCommands } from "./recent-documents-provider"
import { projectRecentDocumentsModel } from "./recent-documents-model"
import type { RecentDocumentsModel } from "./recent-documents-model"
import { RecentDocumentsView } from "./recent-documents"

const NOW = Date.parse("2026-08-29T12:00:00.000Z")

type DraftListOptions = Parameters<RecentDocumentsDependencies["list"]>[0]

const summary = (
  index: number,
  overrides: Partial<DocumentDraftSummary> = {}
): DocumentDraftSummary => {
  const documentId = overrides.documentId ?? `document-${index}`
  const activityAt = new Date(NOW - index * 60_000).toISOString()
  return {
    schemaVersion: 1,
    documentId,
    name: overrides.name ?? `Proposal ${index}`,
    recordVersion: overrides.recordVersion ?? 1,
    contentSnapshotId:
      overrides.contentSnapshotId ?? `sha256-${String(index % 10).repeat(64)}`,
    draftSnapshotId:
      overrides.draftSnapshotId ??
      `sha256-${String((index + 1) % 10).repeat(64)}`,
    documentRevision: overrides.documentRevision ?? 0,
    createdAt: overrides.createdAt ?? activityAt,
    savedAt: overrides.savedAt ?? activityAt,
    lastOpenedAt: overrides.lastOpenedAt ?? activityAt,
    activityAt: overrides.activityAt ?? activityAt,
    deletedAt: overrides.deletedAt ?? null,
    pageCount: overrides.pageCount ?? 1,
    outputCount: overrides.outputCount ?? 1,
    firstPageId: overrides.firstPageId ?? "page-1",
    firstPageName: overrides.firstPageName ?? "Cover",
    firstPageWidth: overrides.firstPageWidth ?? 1240,
    firstPageHeight: overrides.firstPageHeight ?? 1754,
    encodedByteLength: overrides.encodedByteLength ?? 1024,
    exportFormats: overrides.exportFormats ?? ["png", "pdf"],
    sourceKind: overrides.sourceKind ?? null,
    origin: overrides.origin ?? { kind: "blank" },
    lastPublished: overrides.lastPublished ?? null,
  }
}

const record = (item: DocumentDraftSummary): DocumentDraftRecord => ({
  summary: item,
  envelope: {
    document: { id: item.documentId, name: item.name },
    sourceContext: null,
  } as unknown as CurrentDraftEnvelope,
})

const writeSuccess = (item: DocumentDraftSummary): DraftWriteResult => ({
  ok: true,
  record: record(item),
  created: false,
  unchanged: false,
})

class DeterministicDocumentRepository {
  readonly list = vi.fn(
    (options?: DraftListOptions): Promise<DraftListResult> => {
      if (this.#holdNextList) {
        this.#holdNextList = false
        return new Promise<DraftListResult>(() => undefined)
      }
      const state = options?.state ?? "active"
      const query = options?.query?.toLocaleLowerCase() ?? ""
      const limit = options?.limit ?? RECENT_DOCUMENTS_PAGE_SIZE
      const start = options?.cursor ? Number(options.cursor) : 0
      const matching = [...this.#documents.values()]
        .filter((item) =>
          state === "all"
            ? true
            : state === "active"
              ? item.deletedAt === null
              : item.deletedAt !== null
        )
        .filter(
          (item) => !query || item.name.toLocaleLowerCase().includes(query)
        )
        .sort((left, right) => {
          const time =
            Date.parse(right.activityAt) - Date.parse(left.activityAt)
          if (time !== 0) return time
          return left.documentId > right.documentId ? -1 : 1
        })
      const items = matching.slice(start, start + limit)
      const next = start + items.length
      return Promise.resolve({
        ok: true,
        page: {
          items,
          nextCursor: next < matching.length ? String(next) : null,
          recoveryItems: [],
        },
      })
    }
  )

  readonly rename = vi.fn(
    async (
      documentId: string,
      expectedRecordVersion: number,
      name: string
    ): Promise<DraftWriteResult> => {
      const failure = this.#renameFailure
      if (failure) {
        return {
          ok: false,
          reason: "storage_unavailable",
          failure,
        }
      }
      const current = this.#documents.get(documentId)
      if (!current || current.recordVersion !== expectedRecordVersion) {
        return { ok: false, reason: "missing" }
      }
      const committed = {
        ...current,
        name,
        recordVersion: current.recordVersion + 1,
      }
      this.#documents.set(documentId, committed)
      return writeSuccess(committed)
    }
  )

  readonly duplicate = vi.fn(async (): Promise<DraftWriteResult> => ({
    ok: false,
    reason: "storage_unavailable",
    failure: { kind: "request_failed", message: "Not used by this harness." },
  }))

  readonly softDelete = vi.fn(
    async (
      documentId: string,
      expectedRecordVersion: number
    ): Promise<DraftWriteResult> => {
      if (this.#failedActions.has("trash")) {
        return {
          ok: false,
          reason: "storage_unavailable",
          failure: {
            kind: "request_failed",
            message: "Move to Trash failed.",
          },
        }
      }
      const current = this.#documents.get(documentId)
      if (!current || current.recordVersion !== expectedRecordVersion) {
        return { ok: false, reason: "missing" }
      }
      const committed = {
        ...current,
        recordVersion: current.recordVersion + 1,
        activityAt: new Date(NOW + ++this.#mutation * 60_000).toISOString(),
        deletedAt: new Date(NOW + this.#mutation * 60_000).toISOString(),
      }
      this.#documents.set(documentId, committed)
      return writeSuccess(committed)
    }
  )

  readonly restore = vi.fn(
    async (
      documentId: string,
      expectedRecordVersion: number
    ): Promise<DraftWriteResult> => {
      if (this.#failedActions.has("restore")) {
        return {
          ok: false,
          reason: "storage_unavailable",
          failure: { kind: "request_failed", message: "Restore failed." },
        }
      }
      const current = this.#documents.get(documentId)
      if (!current || current.recordVersion !== expectedRecordVersion) {
        return { ok: false, reason: "missing" }
      }
      const committed = {
        ...current,
        recordVersion: current.recordVersion + 1,
        activityAt: new Date(NOW + ++this.#mutation * 60_000).toISOString(),
        deletedAt: null,
      }
      this.#documents.set(documentId, committed)
      return writeSuccess(committed)
    }
  )

  readonly getForDownload = vi.fn(async (documentId: string) => {
    if (this.#failedActions.has("download")) {
      return {
        ok: false,
        reason: "storage_unavailable",
        failure: { kind: "request_failed", message: "Download failed." },
      } as const
    }
    const item = this.#documents.get(documentId)
    return item
      ? ({ ok: true, status: "found", record: record(item) } as const)
      : ({ ok: true, status: "missing" } as const)
  })

  readonly #documents = new Map<string, DocumentDraftSummary>()
  readonly #failedActions = new Set<"download" | "restore" | "trash">()
  #renameFailure: DraftRepositoryFailure | null = null
  #mutation = 0
  #holdNextList = false

  constructor(items: readonly DocumentDraftSummary[]) {
    for (const item of items) this.#documents.set(item.documentId, item)
  }

  setRenameFailure(failure: DraftRepositoryFailure | null) {
    this.#renameFailure = failure
  }

  failAction(kind: "download" | "restore" | "trash") {
    this.#failedActions.add(kind)
  }

  holdNextList() {
    this.#holdNextList = true
  }
}

const commandsFor = (
  controller: RecentDocumentsController
): RecentDocumentsCommands => ({
  setCollection: (collection) => controller.setCollection(collection),
  setQueryInput: (query) => controller.setQueryInput(query),
  applyQueryInput: () => controller.applyQueryInput(),
  clearQuery: () => controller.clearQuery(),
  restoreRouteState: (collection, query) =>
    controller.restoreRouteState(collection, query),
  setView: (view) => controller.setView(view),
  refresh: () => controller.refresh(),
  retry: () => controller.retry(),
  loadMore: () => controller.loadMore(),
  beginRename: (documentId) => controller.beginRename(documentId),
  updateRename: (documentId, input) =>
    controller.updateRename(documentId, input),
  cancelAction: (documentId) => controller.cancelAction(documentId),
  submitRename: (documentId) => controller.submitRename(documentId),
  duplicate: (documentId) => controller.duplicate(documentId),
  moveToTrash: (documentId) => controller.moveToTrash(documentId),
  restore: (documentId) => controller.restore(documentId),
  restoreUndo: () => controller.restoreUndo(),
  dismissUndo: () => controller.dismissUndo(),
  download: (documentId) => controller.download(documentId),
  clearAnnouncement: (id) => controller.clearAnnouncement(id),
  clearFocusIntent: (id) => controller.clearFocusIntent(id),
})

function MountedRecentDocuments({
  commands,
  controller,
  modelOverride,
  onOpen = () => true,
}: {
  commands?: RecentDocumentsCommands
  controller: RecentDocumentsController
  modelOverride?: RecentDocumentsModel
  onOpen?: (documentId: string) => boolean | Promise<boolean>
}) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  )
  useLayoutEffect(() => {
    controller.activate()
    return () => controller.deactivate()
  }, [controller])
  const projectedModel = projectRecentDocumentsModel(
    {
      status: "ready",
      migration: { status: "empty" },
      warning: null,
      library: state,
    },
    { locale: "en-US", timeZone: "UTC", now: NOW }
  )
  return (
    <RecentDocumentsView
      actionsEnabled
      commands={commands ?? commandsFor(controller)}
      model={modelOverride ?? projectedModel}
      onCreateBlank={() => undefined}
      onOpen={onOpen}
      onRetryPersistence={() => undefined}
    />
  )
}

function createController(repository: DeterministicDocumentRepository) {
  const dependencies: RecentDocumentsDependencies = {
    list: repository.list,
    rename: repository.rename,
    duplicate: repository.duplicate,
    softDelete: repository.softDelete,
    restore: repository.restore,
    getForDownload: repository.getForDownload,
    subscribe: () => () => undefined,
    scheduleQuery: (callback) => {
      queueMicrotask(callback)
      return () => undefined
    },
    readViewPreference: () => "grid",
    writeViewPreference: () => undefined,
    now: () => NOW,
  }
  return new RecentDocumentsController(dependencies)
}

function buttonWithLabel(label: string) {
  return document.body.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`
  )
}

function buttonWithText(text: string) {
  return [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent.trim() === text
  )
}

function menuItem(text: string) {
  return [
    ...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((item) => item.textContent.trim() === text)
}

async function openActions(name: string) {
  const trigger = buttonWithLabel(`Actions for ${name}`)
  if (!trigger) throw new Error(`Missing actions trigger for ${name}.`)
  trigger.focus()
  await act(async () => {
    trigger.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        cancelable: true,
      })
    )
    await Promise.resolve()
  })
  await vi.waitFor(() =>
    expect(menuItem("Rename") ?? menuItem("Restore")).toBeTruthy()
  )
  return trigger
}

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

describe("RecentDocuments mounted controller integration", () => {
  let host: HTMLDivElement
  let root: Root
  let controller: RecentDocumentsController | null
  let scrollTo: ReturnType<typeof vi.fn>

  beforeAll(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  })

  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1024,
      writable: true,
    })
    const pointerEventConstructor: unknown = Reflect.get(
      globalThis,
      "PointerEvent"
    )
    Object.assign(globalThis, {
      PointerEvent:
        typeof pointerEventConstructor === "function"
          ? pointerEventConstructor
          : class PointerEvent extends MouseEvent {
              readonly pointerType = "mouse"
            },
      ResizeObserver: class {
        readonly #callback: ResizeObserverCallback

        constructor(callback: ResizeObserverCallback) {
          this.#callback = callback
        }

        observe(target: Element) {
          const virtualRow = target.hasAttribute("data-index")
          const height = virtualRow ? 90 : 600
          this.#callback(
            [
              {
                target,
                borderBoxSize: [
                  {
                    blockSize: height,
                    inlineSize: 900,
                  },
                ],
                contentBoxSize: [
                  {
                    blockSize: height,
                    inlineSize: 900,
                  },
                ],
                devicePixelContentBoxSize: [
                  {
                    blockSize: height,
                    inlineSize: 900,
                  },
                ],
                contentRect: {
                  width: 900,
                  height,
                  top: 0,
                  left: 0,
                  right: 900,
                  bottom: height,
                  x: 0,
                  y: 0,
                  toJSON: () => ({}),
                },
              },
            ],
            this
          )
        }

        unobserve() {}
        disconnect() {}
      },
    })
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600)
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(900)
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(90)
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(900)
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(
      6_000
    )
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(900)
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(90)
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(900)
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 900,
      height: 600,
      top: 0,
      left: 0,
      right: 900,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    scrollTo = vi.fn(function (this: HTMLElement, options: ScrollToOptions) {
      this.scrollTop = options.top ?? 0
      this.dispatchEvent(new Event("scroll"))
    })
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollTo,
    })
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      queueMicrotask(() => callback(performance.now()))
      return 1
    })
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    controller = null
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    controller?.dispose()
    host.remove()
    vi.restoreAllMocks()
  })

  async function mount(items: readonly DocumentDraftSummary[]) {
    const repository = new DeterministicDocumentRepository(items)
    controller = createController(repository)
    await act(async () => {
      root.render(<MountedRecentDocuments controller={controller!} />)
      await Promise.resolve()
    })
    await vi.waitFor(() => {
      expect(
        document.body.querySelector('[aria-label="Recent documents"]')
      ).toBeTruthy()
    })
    return { controller, repository }
  }

  it("keeps rename failure in the dialog and restores focus to the menu opener on cancel", async () => {
    const { repository } = await mount([
      summary(0, { name: "Northstar proposal" }),
    ])
    const trigger = await openActions("Northstar proposal")
    await act(async () => menuItem("Rename")?.click())
    const input = await vi.waitFor(() => {
      const element = document.body.querySelector<HTMLInputElement>(
        'input[name="document-name"]'
      )
      expect(element).toBeTruthy()
      return element!
    })
    expect(document.activeElement).toBe(input)

    repository.setRenameFailure({
      kind: "quota_exceeded",
      message: "Storage is full.",
    })
    await act(async () => setInputValue(input, "Revised proposal"))
    await act(async () => {
      input
        .closest("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true })
        )
      await Promise.resolve()
    })
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Storage is full.")
      expect(input.closest('[role="dialog"]')).toBeTruthy()
      expect(
        input.closest('[role="dialog"]')?.contains(document.activeElement)
      ).toBe(true)
    })

    await act(async () => buttonWithText("Cancel")?.click())
    await vi.waitFor(() => {
      expect(document.body.querySelector('[role="dialog"]')).toBeNull()
      expect(document.activeElement).toBe(trigger)
    })
  })

  it("moves focus to the next or previous document after committed Trash and restores into Recent", async () => {
    const { controller: mountedController } = await mount([
      summary(0),
      summary(1),
      summary(2),
    ])

    await openActions("Proposal 1")
    await act(async () => menuItem("Move to Trash")?.click())
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(buttonWithLabel("Open Proposal 2"))
    })

    await openActions("Proposal 2")
    await act(async () => menuItem("Move to Trash")?.click())
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(buttonWithLabel("Open Proposal 0"))
    })

    await act(async () => mountedController.setCollection("trash"))
    await vi.waitFor(() =>
      expect(buttonWithLabel("Actions for Proposal 1")).toBeTruthy()
    )
    await openActions("Proposal 1")
    await act(async () => menuItem("Restore")?.click())
    await vi.waitFor(() => {
      expect(buttonWithText("Recent")?.getAttribute("data-state")).toBe(
        "active"
      )
      expect(document.activeElement).toBe(buttonWithLabel("Open Proposal 1"))
    })
  })

  it.each([
    {
      action: "Download JSON",
      collection: "recent" as const,
      failure: "Download failed.",
      kind: "download" as const,
    },
    {
      action: "Move to Trash",
      collection: "recent" as const,
      failure: "Move to Trash failed.",
      kind: "trash" as const,
    },
    {
      action: "Restore",
      collection: "trash" as const,
      failure: "Restore failed.",
      kind: "restore" as const,
    },
  ])(
    "returns focus to the exact action trigger when $kind fails",
    async ({ action, collection, failure, kind }) => {
      const deletedAt =
        collection === "trash" ? "2026-08-29T11:00:00.000Z" : null
      const { controller: mountedController, repository } = await mount([
        summary(0, { deletedAt, name: "Failure proposal" }),
        ...(collection === "trash"
          ? [summary(1, { name: "Active proposal" })]
          : []),
      ])
      repository.failAction(kind)
      if (collection === "trash") {
        await act(async () => mountedController.setCollection("trash"))
        await vi.waitFor(() =>
          expect(buttonWithLabel("Actions for Failure proposal")).toBeTruthy()
        )
      }

      const trigger = await openActions("Failure proposal")
      await act(async () => menuItem(action)?.click())
      await vi.waitFor(() => {
        expect(document.body.textContent).toContain(failure)
        expect(document.activeElement).toBe(trigger)
      })
    }
  )

  it("restores failed Open focus to the stable heading after persistence preempts the collection", async () => {
    const { controller: mountedController } = await mount([
      summary(0, { name: "Preempted proposal" }),
    ])
    let settleOpen: ((opened: boolean) => void) | null = null
    const onOpen = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          settleOpen = resolve
        })
    )
    await act(async () => {
      root.render(
        <MountedRecentDocuments
          controller={mountedController}
          onOpen={onOpen}
        />
      )
    })
    const open = await vi.waitFor(() => {
      const button = buttonWithLabel("Open Preempted proposal")
      expect(button).toBeTruthy()
      return button!
    })
    open.focus()
    await act(async () => open.click())

    await act(async () => {
      root.render(
        <MountedRecentDocuments
          controller={mountedController}
          modelOverride={{ status: "opening", owner: "persistence" }}
          onOpen={onOpen}
        />
      )
    })
    expect(open.isConnected).toBe(false)
    await act(async () => settleOpen?.(false))
    await vi.waitFor(() => {
      const heading = document.getElementById("recent-documents-heading")
      expect(heading?.tabIndex).toBe(-1)
      expect(document.activeElement).toBe(heading)
    })
  })

  it("restores failed action focus to the stable heading after persistence preempts the collection", async () => {
    const { controller: mountedController } = await mount([
      summary(0, { name: "Preempted proposal" }),
    ])
    let settleDownload: ((downloaded: null) => void) | null = null
    const deferredDownload = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          settleDownload = resolve
        })
    )
    const commands: RecentDocumentsCommands = {
      ...commandsFor(mountedController),
      download: deferredDownload,
    }
    await act(async () => {
      root.render(
        <MountedRecentDocuments
          commands={commands}
          controller={mountedController}
        />
      )
    })
    const trigger = await openActions("Preempted proposal")
    await act(async () => menuItem("Download JSON")?.click())

    await act(async () => {
      root.render(
        <MountedRecentDocuments
          commands={commands}
          controller={mountedController}
          modelOverride={{ status: "opening", owner: "persistence" }}
        />
      )
    })
    expect(trigger.isConnected).toBe(false)
    await act(async () => settleDownload?.(null))
    await vi.waitFor(() => {
      const heading = document.getElementById("recent-documents-heading")
      expect(heading?.tabIndex).toBe(-1)
      expect(document.activeElement).toBe(heading)
    })
  })

  it("keeps Load more focus on the settled final-page status", async () => {
    const rows = Array.from({ length: 25 }, (_, index) => summary(index))
    await mount(rows)
    const loadMore = await vi.waitFor(() => {
      const button = buttonWithText("Load more")
      expect(button).toBeTruthy()
      return button!
    })
    loadMore.focus()
    await act(async () => loadMore.click())
    await vi.waitFor(() => {
      expect(document.activeElement?.textContent).toBe("All documents loaded")
      expect(buttonWithText("Load more")).toBeUndefined()
    })
  })

  it("preserves grid list-item semantics and document order after virtualization", async () => {
    const rows = Array.from({ length: 60 }, (_, index) => summary(index))
    const { controller: mountedController } = await mount(rows)
    await act(async () => mountedController.loadMore())
    await act(async () => mountedController.loadMore())
    const list = await vi.waitFor(() => {
      const element = document.body.querySelector<HTMLElement>(
        '[data-virtualized="true"] [role="list"][aria-label="Recent documents"]'
      )
      expect(element).toBeTruthy()
      return element!
    })
    const visibleItems = [
      ...list.querySelectorAll<HTMLElement>('[role="listitem"]'),
    ]
    expect(visibleItems.length).toBeGreaterThan(1)
    expect(
      list
        .querySelector('[role="presentation"]')
        ?.querySelectorAll('[role="listitem"]')
    ).toHaveLength(3)
    expect(
      visibleItems.every(
        (item) =>
          item.querySelectorAll("article[data-document-id]").length === 1
      )
    ).toBe(true)
    const visibleIds = visibleItems.map(
      (item) =>
        item.querySelector<HTMLElement>("article[data-document-id]")?.dataset
          .documentId
    )
    const slot = mountedController.getSnapshot().recent
    if (slot.status !== "ready") throw new Error("Expected Recent page")
    const visibleIdSet = new Set(visibleIds)
    expect(visibleIds).toEqual(
      slot.page.items
        .map((item) => item.documentId)
        .filter((documentId) => visibleIdSet.has(documentId))
    )

    await act(async () => {
      window.innerWidth = 1280
      window.dispatchEvent(new Event("resize"))
    })
    await vi.waitFor(() =>
      expect(
        list
          .querySelector('[role="presentation"]')
          ?.querySelectorAll('[role="listitem"]')
      ).toHaveLength(4)
    )
  })

  it("scrolls and focuses a controller target that starts outside the virtualized DOM", async () => {
    const rows = Array.from({ length: 60 }, (_, index) => summary(index))
    const { controller: mountedController, repository } = await mount(rows)
    await act(async () => mountedController.setView("list"))
    await act(async () => mountedController.loadMore())
    await act(async () => mountedController.loadMore())
    await vi.waitFor(() => {
      expect(
        document.body.querySelector('[data-virtualized="true"]')
      ).toBeTruthy()
    })
    expect(buttonWithLabel("Open Proposal 41")).toBeNull()

    scrollTo.mockClear()
    repository.holdNextList()
    await act(async () => {
      await mountedController.moveToTrash("document-40")
    })
    const virtualScroller = document.body.querySelector<HTMLElement>(
      '[data-virtualized="true"]'
    )
    await act(async () => {
      await vi.waitFor(() => {
        expect(scrollTo).toHaveBeenCalled()
      })
    })
    const scrollOffsets = scrollTo.mock.calls.map(
      ([options]) => (options as ScrollToOptions).top
    )
    expect(scrollOffsets.some((offset) => (offset ?? 0) > 0)).toBe(true)
    expect(virtualScroller).toBeTruthy()
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(buttonWithLabel("Open Proposal 41"))
    })
  })
})
