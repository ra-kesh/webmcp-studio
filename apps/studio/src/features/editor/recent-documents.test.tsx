// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { RecentDocumentsCommands } from "./recent-documents-provider"
import type {
  RecentDocumentRowModel,
  RecentDocumentsModel,
} from "./recent-documents-model"
import { RecentDocumentsView } from "./recent-documents"

const createCommands = () =>
  ({
    setCollection: vi.fn(),
    setQueryInput: vi.fn(),
    applyQueryInput: vi.fn(),
    clearQuery: vi.fn(),
    restoreRouteState: vi.fn(),
    setView: vi.fn(),
    refresh: vi.fn(),
    retry: vi.fn(),
    loadMore: vi.fn(),
    beginRename: vi.fn(() => true),
    updateRename: vi.fn(),
    cancelAction: vi.fn(),
    submitRename: vi.fn(async () => true),
    duplicate: vi.fn(async () => null),
    moveToTrash: vi.fn(async () => null),
    restore: vi.fn(async () => null),
    restoreUndo: vi.fn(async () => null),
    dismissUndo: vi.fn(),
    download: vi.fn(async () => null),
    clearAnnouncement: vi.fn(),
    clearFocusIntent: vi.fn(),
  }) as unknown as RecentDocumentsCommands

const createRow = (
  index = 0,
  overrides: Partial<RecentDocumentRowModel> = {}
): RecentDocumentRowModel => {
  const documentId = overrides.documentId ?? `document-${index}`
  const recordVersion = overrides.recordVersion ?? index + 1
  return {
    documentId,
    name: index === 0 ? "Northstar proposal" : `Document ${index}`,
    recordVersion,
    previewIdentity: {
      documentId,
      recordVersion,
      contentSnapshotId: `content-${documentId}`,
      documentRevision: index,
      pageId: `page-${documentId}`,
      pageWidth: 1240,
      pageHeight: 1754,
    },
    origin: { kind: "blank" },
    originLabel: "Started blank",
    sourceKind: null,
    sourceLabel: "Standalone",
    pageCount: 3,
    pageCountLabel: "3 pages",
    outputCount: 2,
    outputCountLabel: "2 outputs",
    firstPageName: "Cover",
    dimensionsLabel: "1,240 × 1,754 px",
    exportFormatsLabel: "PNG, PDF",
    activity: {
      status: "valid",
      dateTime: "2026-08-29T00:00:00.000Z",
      label: "Aug 29, 2026, 5:30 AM",
    },
    deletedAt: null,
    action: { status: "idle" },
    capabilities: {
      open: { visible: true, enabled: true },
      rename: { visible: true, enabled: true },
      duplicate: { visible: true, enabled: true },
      download: { visible: true, enabled: true },
      moveToTrash: { visible: true, enabled: true },
      restore: { visible: false, enabled: false },
    },
    focusRequested: false,
    ...overrides,
  }
}

const createReadyModel = (
  overrides: Partial<Extract<RecentDocumentsModel, { status: "ready" }>> = {}
): Extract<RecentDocumentsModel, { status: "ready" }> => ({
  status: "ready",
  persistence: { migrationStatus: "empty", warning: null },
  collection: "recent",
  collectionLabel: "Recent",
  view: "grid",
  query: {
    input: "",
    applied: "",
    pending: false,
    active: false,
    canClear: false,
  },
  rows: [createRow()],
  recoveryItems: [],
  renameActions: [],
  actionFailures: [],
  undo: null,
  announcement: null,
  focusIntent: null,
  virtualization: { enabled: false, itemCount: 1, threshold: 48 },
  page: {
    revision: 1,
    confirmedAt: 1,
    lastConfirmedLabel: "Last confirmed just now",
    stale: false,
    hasMore: false,
    pagination: {
      status: "complete",
      label: "All documents loaded",
      focusRequested: false,
    },
  },
  canLoadMore: false,
  ...overrides,
})

const baseProps = () => ({
  actionsEnabled: true,
  commands: createCommands(),
  model: createReadyModel() as RecentDocumentsModel,
  onCreateBlank: vi.fn(),
  onOpen: vi.fn(async () => true),
  onRetryPersistence: vi.fn(),
})

function buttonWithLabel(label: string) {
  return (
    [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => {
        const candidate = button.getAttribute("aria-label")
        return (
          candidate === label ||
          candidate?.startsWith(`${label} `) ||
          button.getAttribute("data-document-open-label") === label
        )
      }
    ) ?? null
  )
}

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve
  })
  return { promise, resolve }
}

describe("RecentDocumentsView", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.assign(globalThis, {
      IS_REACT_ACT_ENVIRONMENT: true,
      ResizeObserver: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    })
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.restoreAllMocks()
  })

  it("renders truthful summary metadata without reading or fabricating a preview", () => {
    const html = renderToStaticMarkup(<RecentDocumentsView {...baseProps()} />)

    expect(html).toContain("Northstar proposal")
    expect(html).toContain("Started blank")
    expect(html).toContain("3 pages")
    expect(html).toContain("2 outputs")
    expect(html).toContain("1,240 × 1,754 px")
    expect(html).toContain("PNG, PDF")
    expect(html).not.toContain("<img")
    expect(html).not.toContain('role="img"')
  })

  it("keeps the exact-ID Open target and actions menu as siblings", async () => {
    const props = baseProps()
    await act(async () => root.render(<RecentDocumentsView {...props} />))

    const open = buttonWithLabel("Open Northstar proposal")
    const menu = buttonWithLabel("Actions for Northstar proposal")
    expect(open).not.toBeNull()
    expect(menu).not.toBeNull()
    expect(open?.parentElement).toBe(menu?.parentElement)

    await act(async () => open?.click())
    expect(props.onOpen).toHaveBeenCalledWith("document-0")
  })

  it("opens a document from its visual preview well", async () => {
    const props = baseProps()
    await act(async () => root.render(<RecentDocumentsView {...props} />))

    await act(async () =>
      buttonWithLabel("Open preview for Northstar proposal")?.click()
    )
    expect(props.onOpen).toHaveBeenCalledWith("document-0")
  })

  it("owns one pending exact-ID open and blocks competing library actions", async () => {
    const pending = deferred<boolean>()
    const props = {
      ...baseProps(),
      model: createReadyModel({
        rows: [createRow(0), createRow(1)],
        virtualization: { enabled: false, itemCount: 2, threshold: 48 },
      }),
      onOpen: vi.fn(() => pending.promise),
    }
    await act(async () => root.render(<RecentDocumentsView {...props} />))

    await act(async () => {
      buttonWithLabel("Open Northstar proposal")?.click()
      await Promise.resolve()
    })

    expect(props.onOpen).toHaveBeenCalledTimes(1)
    expect(
      buttonWithLabel("Open Northstar proposal")?.getAttribute("aria-busy")
    ).toBe("true")
    expect(buttonWithLabel("Open Document 1")?.disabled).toBe(true)
    expect(buttonWithLabel("Actions for Document 1")?.disabled).toBe(true)

    await act(async () => buttonWithLabel("Open Document 1")?.click())
    expect(props.onOpen).toHaveBeenCalledTimes(1)

    await act(async () => pending.resolve(false))
    expect(buttonWithLabel("Open Document 1")?.disabled).toBe(false)
    expect(document.activeElement).toBe(
      buttonWithLabel("Open Northstar proposal")
    )
  })

  it("falls back to the collection heading when a failed Open source detaches", async () => {
    const pending = deferred<boolean>()
    const props = {
      ...baseProps(),
      onOpen: vi.fn(() => pending.promise),
    }
    await act(async () => root.render(<RecentDocumentsView {...props} />))
    await act(async () => {
      buttonWithLabel("Open Northstar proposal")?.click()
      await Promise.resolve()
    })

    const replacementModel = createReadyModel({
      rows: [createRow(1)],
      virtualization: { enabled: false, itemCount: 1, threshold: 48 },
    })
    await act(async () =>
      root.render(<RecentDocumentsView {...props} model={replacementModel} />)
    )
    await act(async () => pending.resolve(false))

    expect(document.activeElement?.id).toBe("recent-documents-heading")
  })

  it("focuses repository search for Cmd/Ctrl+F and dispatches server-backed query input", async () => {
    const props = baseProps()
    await act(async () => root.render(<RecentDocumentsView {...props} />))
    const search = document.body.querySelector<HTMLInputElement>(
      'input[name="document-search"]'
    )
    if (!search) throw new Error("Expected document search")

    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: "f",
    })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(search)

    await act(async () => setInputValue(search, "wedding"))
    expect(props.commands.setQueryInput).toHaveBeenCalledWith("wedding")
  })

  it("dispatches collection and view changes through the retained controller", async () => {
    const props = baseProps()
    await act(async () => root.render(<RecentDocumentsView {...props} />))

    await act(async () => buttonWithLabel("List view")?.click())
    expect(props.commands.setView).toHaveBeenCalledWith("list")

    const tabButtons = [...host.querySelectorAll<HTMLButtonElement>("button")]
    const recent = tabButtons.find((button) => button.textContent === "Recent")
    expect(recent).not.toBeUndefined()
    await act(async () => {
      recent?.focus()
      recent?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "ArrowRight",
        })
      )
    })
    expect(props.commands.setCollection).toHaveBeenCalledWith("trash")
  })

  it("renders distinct empty, no-result, retained-error, and unavailable states", () => {
    const props = baseProps()
    const emptyRecent = {
      ...createReadyModel(),
      status: "empty_recent" as const,
      rows: [],
      virtualization: { enabled: false, itemCount: 0, threshold: 48 as const },
      canCreate: true as const,
    }
    const noResults = {
      ...createReadyModel(),
      status: "no_results" as const,
      rows: [],
      query: {
        input: "missing",
        applied: "missing",
        pending: false,
        active: true,
        canClear: true,
      },
      virtualization: { enabled: false, itemCount: 0, threshold: 48 as const },
      canClearQuery: true as const,
    }
    const retained = {
      ...createReadyModel(),
      status: "retained_error" as const,
      failure: {
        kind: "storage_unavailable" as const,
        message: "IndexedDB failed.",
      },
      canRetry: true as const,
    }
    const unavailable: RecentDocumentsModel = {
      status: "unavailable",
      failure: { kind: "storage_unavailable", message: "Storage is full." },
      hasRecoverableDocument: false,
      canRetry: true,
    }

    expect(
      renderToStaticMarkup(
        <RecentDocumentsView {...props} model={emptyRecent} />
      )
    ).toContain("Create your first document")
    expect(
      renderToStaticMarkup(<RecentDocumentsView {...props} model={noResults} />)
    ).toContain("No matching documents")
    expect(
      renderToStaticMarkup(<RecentDocumentsView {...props} model={retained} />)
    ).toContain("Last confirmed just now")
    expect(
      renderToStaticMarkup(
        <RecentDocumentsView {...props} model={unavailable} />
      )
    ).toContain("Document library unavailable")
  })

  it("moves initial Start focus to the collection heading when no row exists", async () => {
    const props = baseProps()
    const emptyRecent = {
      ...createReadyModel(),
      status: "empty_recent" as const,
      rows: [],
      virtualization: { enabled: false, itemCount: 0, threshold: 48 as const },
      canCreate: true as const,
    }
    await act(async () =>
      root.render(
        <RecentDocumentsView
          {...props}
          initialFocusRequested
          model={emptyRecent}
        />
      )
    )

    expect(document.activeElement?.id).toBe("recent-documents-heading")
  })

  it("keeps rename input and error visible until the controller commits", async () => {
    const props = baseProps()
    const model = createReadyModel({
      renameActions: [
        {
          documentId: "document-0",
          documentName: "Northstar proposal",
          owner: "recent",
          phase: "editing",
          input: "Northstar proposal",
          expectedRecordVersion: 1,
          error: "This document changed elsewhere.",
          visible: true,
        },
      ],
      rows: [
        createRow(0, {
          action: {
            status: "rename_editing",
            input: "Northstar proposal",
            error: "This document changed elsewhere.",
            expectedRecordVersion: 1,
          },
        }),
      ],
    })
    await act(async () =>
      root.render(<RecentDocumentsView {...props} model={model} />)
    )

    const input = document.body.querySelector<HTMLInputElement>(
      'input[name="document-name"]'
    )
    expect(input?.value).toBe("Northstar proposal")
    expect(document.body.textContent).toContain(
      "This document changed elsewhere."
    )

    await act(async () => {
      input
        ?.closest("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true })
        )
    })
    expect(props.commands.submitRename).toHaveBeenCalledWith("document-0")
  })

  it("returns focus to the originating actions control when rename is cancelled", async () => {
    const props = baseProps()
    const ready = createReadyModel()
    await act(async () =>
      root.render(<RecentDocumentsView {...props} model={ready} />)
    )
    const actionTrigger = buttonWithLabel("Actions for Northstar proposal")
    actionTrigger?.focus()

    const editing = createReadyModel({
      renameActions: [
        {
          documentId: "document-0",
          documentName: "Northstar proposal",
          owner: "recent",
          phase: "editing",
          input: "Northstar proposal",
          expectedRecordVersion: 1,
          error: null,
          visible: true,
        },
      ],
      rows: [
        createRow(0, {
          action: {
            status: "rename_editing",
            input: "Northstar proposal",
            error: null,
            expectedRecordVersion: 1,
          },
        }),
      ],
    })
    await act(async () =>
      root.render(<RecentDocumentsView {...props} model={editing} />)
    )
    const cancel = [
      ...document.body.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "Cancel")
    let returnFocus: FrameRequestCallback | null = null
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      returnFocus = callback
      return 1
    })

    await act(async () => cancel?.click())
    expect(props.commands.cancelAction).toHaveBeenCalledWith("document-0")
    await act(async () =>
      root.render(<RecentDocumentsView {...props} model={ready} />)
    )
    await act(async () => returnFocus?.(performance.now()))
    expect(document.activeElement).toBe(
      buttonWithLabel("Actions for Northstar proposal")
    )
  })

  it("surfaces failures for documents outside the visible page", () => {
    const props = baseProps()
    const markup = renderToStaticMarkup(
      <RecentDocumentsView
        {...props}
        model={createReadyModel({
          actionFailures: [
            {
              documentId: "off-page-document",
              documentName: "Off-page proposal",
              owner: "recent",
              kind: "download",
              message: "The stored document could not be read.",
              visible: false,
            },
          ],
        })}
      />
    )

    expect(markup).toContain("Some document actions need attention")
    expect(markup).toContain("Off-page proposal")
    expect(markup).toContain("The stored document could not be read.")
  })

  it("gates creation, mutation, and undo while a shell transition owns the session", async () => {
    const props = baseProps()
    const ready = createReadyModel({
      undo: {
        documentId: "document-9",
        name: "Moved proposal",
        action: "restore",
      },
    })
    await act(async () =>
      root.render(
        <RecentDocumentsView {...props} actionsEnabled={false} model={ready} />
      )
    )

    expect(buttonWithLabel("Open Northstar proposal")?.disabled).toBe(true)
    expect(buttonWithLabel("Actions for Northstar proposal")?.disabled).toBe(
      true
    )
    const restore = [
      ...document.body.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "Restore")
    expect(restore?.disabled).toBe(true)

    const emptyRecent = {
      ...ready,
      status: "empty_recent" as const,
      rows: [],
      virtualization: { enabled: false, itemCount: 0, threshold: 48 as const },
      canCreate: true as const,
    }
    await act(async () =>
      root.render(
        <RecentDocumentsView
          {...props}
          actionsEnabled={false}
          model={emptyRecent}
        />
      )
    )
    const create = [
      ...document.body.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "Create blank document")
    expect(create?.disabled).toBe(true)
  })

  it("retains explicit Load more recovery and persistent Trash undo", async () => {
    const props = baseProps()
    const model = {
      ...createReadyModel(),
      status: "load_more_failed" as const,
      failure: {
        kind: "request_failed" as const,
        message: "Next page failed.",
      },
      canRetryLoadMore: true as const,
      page: { ...createReadyModel().page, hasMore: true },
      undo: {
        documentId: "document-9",
        name: "Moved proposal",
        action: "restore" as const,
      },
    }
    await act(async () =>
      root.render(<RecentDocumentsView {...props} model={model} />)
    )

    expect(document.body.textContent).toContain("Next page failed.")
    expect(document.body.textContent).toContain(
      "Moved proposal moved to Trash."
    )
    const retry = [
      ...document.body.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent.includes("Retry loading more"))
    await act(async () => retry?.click())
    expect(props.commands.loadMore).toHaveBeenCalledTimes(1)

    const restore = [
      ...document.body.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "Restore")
    await act(async () => restore?.click())
    expect(props.commands.restoreUndo).toHaveBeenCalledTimes(1)
  })

  it("uses the virtualized semantic collection beyond 48 rows", async () => {
    const props = baseProps()
    const rows = Array.from({ length: 49 }, (_, index) => createRow(index))
    const model = createReadyModel({
      rows,
      virtualization: { enabled: true, itemCount: rows.length, threshold: 48 },
    })
    await act(async () =>
      root.render(<RecentDocumentsView {...props} model={model} />)
    )

    expect(
      document.body.querySelector('[data-virtualized="true"]')
    ).not.toBeNull()
    expect(
      document.body.querySelector(
        '[role="list"][aria-label="Recent documents"]'
      )
    ).not.toBeNull()
  })

  it("focuses the requested exact document and clears only that focus intent", async () => {
    const props = baseProps()
    const model = createReadyModel({
      focusIntent: {
        id: 7,
        target: "document",
        documentId: "document-1",
      },
      rows: [createRow(0), createRow(1)],
      virtualization: { enabled: false, itemCount: 2, threshold: 48 },
    })
    await act(async () =>
      root.render(<RecentDocumentsView {...props} model={model} />)
    )

    expect(document.activeElement).toBe(buttonWithLabel("Open Document 1"))
    expect(props.commands.clearFocusIntent).toHaveBeenCalledWith(7)
  })

  it("moves final-page pagination focus to the settled status", async () => {
    const props = baseProps()
    const model = createReadyModel({
      focusIntent: { id: 8, target: "pagination-status" },
      page: {
        ...createReadyModel().page,
        pagination: {
          status: "complete",
          label: "All documents loaded",
          focusRequested: true,
        },
      },
    })
    await act(async () =>
      root.render(<RecentDocumentsView {...props} model={model} />)
    )

    expect(document.activeElement?.textContent).toBe("All documents loaded")
    expect(props.commands.clearFocusIntent).toHaveBeenCalledWith(8)
  })

  it("announces a completed Trash action once while keeping Undo interactive", async () => {
    const props = baseProps()
    const model = createReadyModel({
      announcement: { id: 9, message: "Moved proposal was moved to Trash." },
      undo: {
        documentId: "document-9",
        name: "Moved proposal",
        action: "restore",
      },
    })
    await act(async () =>
      root.render(<RecentDocumentsView {...props} model={model} />)
    )

    expect(document.body.querySelectorAll('[role="status"]')).toHaveLength(1)
    expect(document.body.querySelector('[role="status"]')?.textContent).toBe(
      "Moved proposal was moved to Trash."
    )
  })
})
