import { describe, expect, it, vi } from "vitest"
import type {
  CollectionSlot,
  ConfirmedPage,
  DocumentActionState,
  RecentDocumentsState,
} from "./recent-documents-controller"
import type {
  DocumentDraftSummary,
  DraftListRecoveryItem,
  DraftRepositoryFailure,
} from "./document-draft-repository"
import {
  projectRecentDocumentsModel,
  RECENT_DOCUMENTS_VIRTUALIZATION_THRESHOLD,
  recentDocumentActivity,
  recentDocumentOriginLabel,
  recentDocumentsLastConfirmedLabel,
} from "./recent-documents-model"
import type { RecentDocumentsProviderState } from "./recent-documents-provider"

const NOW = Date.parse("2026-08-29T12:00:00.000Z")
const formatOptions = { locale: "en-US", timeZone: "UTC", now: NOW } as const

const failure = (
  message = "The document list could not be read."
): DraftRepositoryFailure => ({ kind: "request_failed", message })

const summary = (
  documentId: string,
  overrides: Partial<DocumentDraftSummary> = {}
): DocumentDraftSummary => ({
  schemaVersion: 1,
  documentId,
  name: `Document ${documentId}`,
  recordVersion: 3,
  contentSnapshotId: `content-${documentId}`,
  draftSnapshotId: `draft-${documentId}`,
  documentRevision: 2,
  createdAt: "2026-08-20T10:00:00.000Z",
  savedAt: "2026-08-29T09:00:00.000Z",
  lastOpenedAt: "2026-08-29T10:00:00.000Z",
  activityAt: "2026-08-29T10:30:00.000Z",
  deletedAt: null,
  pageCount: 2,
  outputCount: 1,
  firstPageId: `page-${documentId}`,
  firstPageName: "Cover",
  firstPageWidth: 1240,
  firstPageHeight: 1754,
  encodedByteLength: 2048,
  exportFormats: ["png", "pdf"],
  sourceKind: null,
  origin: { kind: "blank" },
  lastPublished: null,
  ...overrides,
})

const confirmedPage = (
  items: readonly DocumentDraftSummary[],
  overrides: Partial<ConfirmedPage> = {}
): ConfirmedPage => ({
  items,
  nextCursor: null,
  recoveryItems: [],
  confirmedAt: NOW - 5 * 60 * 1000,
  revision: 7,
  ...overrides,
})

const readySlot = (
  items: readonly DocumentDraftSummary[],
  options: {
    page?: Partial<ConfirmedPage>
    stale?: boolean
    pagination?: "idle" | "loading_more"
    paginationFailure?: DraftRepositoryFailure | null
  } = {}
): CollectionSlot => ({
  status: "ready",
  page: confirmedPage(items, options.page),
  stale: options.stale ?? false,
  pagination: options.pagination ?? "idle",
  paginationFailure: options.paginationFailure ?? null,
})

const libraryState = (
  overrides: Partial<RecentDocumentsState> = {}
): RecentDocumentsState => ({
  active: true,
  disposed: false,
  collection: "recent",
  queryInput: "",
  appliedQuery: "",
  view: "grid",
  recent: readySlot([summary("alpha")]),
  trash: { status: "idle", stale: false },
  actions: new Map(),
  recoveryItems: [],
  undo: null,
  announcement: null,
  focusIntent: null,
  ...overrides,
})

const providerReady = (
  library: RecentDocumentsState,
  warning: string | null = null,
  migrationStatus: Extract<
    RecentDocumentsProviderState,
    { status: "ready" }
  >["migration"]["status"] = "empty"
): RecentDocumentsProviderState => ({
  status: "ready",
  migration: { status: migrationStatus } as Extract<
    RecentDocumentsProviderState,
    { status: "ready" }
  >["migration"],
  warning,
  library,
})

const project = (state: RecentDocumentsState) =>
  projectRecentDocumentsModel(providerReady(state), formatOptions)

describe("recent documents model", () => {
  it("gives persistence opening precedence over retained collection data", () => {
    expect(
      projectRecentDocumentsModel({ status: "opening" }, formatOptions)
    ).toEqual({ status: "opening", owner: "persistence" })
  })

  it("projects legacy recovery without copying raw draft bytes into the model", () => {
    const model = projectRecentDocumentsModel(
      {
        status: "recovery_required",
        recovery: {
          schemaVersion: 1,
          sourceStorageKey: "legacy-draft",
          capturedAt: "2026-08-29T08:00:00.000Z",
          failure: { kind: "malformed_json", message: "Invalid JSON." },
          raw: "private document bytes",
        },
      },
      formatOptions
    )
    expect(model).toEqual({
      status: "recovery_required",
      sourceStorageKey: "legacy-draft",
      capturedAt: "2026-08-29T08:00:00.000Z",
      failure: { kind: "malformed_json", message: "Invalid JSON." },
      hasDownloadableOriginal: true,
    })
    expect(model).not.toHaveProperty("raw")
  })

  it.each(["blocked", "unavailable"] as const)(
    "preempts the library when persistence is %s",
    (status) => {
      const model = projectRecentDocumentsModel(
        {
          status,
          failure: { kind: status, message: `${status} storage` },
          recoverableEnvelope: null,
        },
        formatOptions
      )
      expect(model).toEqual({
        status,
        failure: { kind: status, message: `${status} storage` },
        hasRecoverableDocument: false,
        canRetry: true,
      })
    }
  )

  it("distinguishes collection opening from persistence opening", () => {
    const model = project(
      libraryState({ recent: { status: "loading", retained: null } })
    )
    expect(model).toMatchObject({
      status: "opening",
      owner: "collection",
      collection: "recent",
      rows: [],
      page: null,
    })
  })

  it("distinguishes empty Recent and empty Trash capabilities", () => {
    const recent = project(libraryState({ recent: readySlot([]) }))
    const trash = project(
      libraryState({
        collection: "trash",
        recent: { status: "idle", stale: false },
        trash: readySlot([]),
      })
    )
    expect(recent).toMatchObject({ status: "empty_recent", canCreate: true })
    expect(trash).toMatchObject({
      status: "empty_trash",
      collection: "trash",
    })
    expect(trash).not.toHaveProperty("canCreate")
  })

  it("keeps sticky recovery distinct from a clean empty workspace", () => {
    const recovery: DraftListRecoveryItem = {
      documentId: "corrupt-a",
      quarantineId: "quarantine-a",
      status: "quarantined",
      failure: { kind: "corrupt_record", message: "Metadata was invalid." },
    }
    const model = project(
      libraryState({ recent: readySlot([]), recoveryItems: [recovery] })
    )
    expect(model).toMatchObject({
      status: "recovery_only",
      recoveryItems: [
        {
          documentId: "corrupt-a",
          quarantineId: "quarantine-a",
          status: "quarantined",
          title: "Document moved to recovery",
          message: "Metadata was invalid.",
        },
      ],
    })
    if (model.status !== "recovery_only") {
      throw new Error(`Expected recovery_only, received ${model.status}.`)
    }
    expect(model.recoveryItems[0].key).toContain("quarantine-a")
  })

  it("projects a confirmed query miss as no results with Clear available", () => {
    const model = project(
      libraryState({
        queryInput: "Invoice",
        appliedQuery: "Invoice",
        recent: readySlot([]),
      })
    )
    expect(model).toMatchObject({
      status: "no_results",
      canClearQuery: true,
      query: {
        input: "Invoice",
        applied: "Invoice",
        active: true,
        pending: false,
      },
    })
  })

  it("preserves complete long names and projects exact preview identity without preview state or bodies", () => {
    const longName = "Quarterly campaign proposal ".repeat(14).trim()
    const row = summary("template-doc", {
      name: longName,
      pageCount: 1,
      outputCount: 3,
      firstPageName: "Social cover",
      firstPageWidth: 1080,
      firstPageHeight: 1920,
      sourceKind: "template",
      origin: {
        kind: "template",
        templateId: "editorial-one-pager",
        templateVersion: 6,
      },
    })
    const model = project(libraryState({ recent: readySlot([row]) }))
    expect(model.status).toBe("ready")
    if (model.status !== "ready") {
      throw new Error(`Expected ready, received ${model.status}.`)
    }
    expect(model.rows[0]).toMatchObject({
      name: longName,
      previewIdentity: {
        documentId: "template-doc",
        recordVersion: 3,
        contentSnapshotId: "content-template-doc",
        documentRevision: 2,
        pageId: "page-template-doc",
        pageWidth: 1080,
        pageHeight: 1920,
      },
      originLabel: "Template editorial-one-pager, version 6",
      sourceLabel: "Template-backed",
      pageCountLabel: "1 page",
      outputCountLabel: "3 outputs",
      firstPageName: "Social cover",
      dimensionsLabel: "1,080 × 1,920 px",
      exportFormatsLabel: "PNG, PDF",
      activity: {
        status: "valid",
        dateTime: "2026-08-29T10:30:00.000Z",
        label: "Aug 29, 2026, 10:30 AM",
      },
    })
    expect(model.rows[0]).not.toHaveProperty("preview")
    expect(model.rows[0]).not.toHaveProperty("previewUrl")
    expect(model.rows[0]).not.toHaveProperty("previewState")
    expect(model.rows[0]).not.toHaveProperty("thumbnail")
    expect(model.rows[0]).not.toHaveProperty("body")
    expect(model.rows[0]).not.toHaveProperty("envelope")
  })

  it.each([
    "not-a-date",
    "August 29, 2026 10:30 UTC",
    "2026-02-30T00:00:00.000Z",
    "2025-02-29T00:00:00.000Z",
    "2026-08-29T24:00:00.000Z",
    "2026-08-29T10:30:00+24:00",
  ])("rejects invalid or non-ISO activity timestamp %s", (activityAt) => {
    expect(recentDocumentActivity(activityAt, formatOptions)).toEqual({
      status: "invalid",
      dateTime: null,
      label: "Activity date unavailable",
    })
    const model = project(
      libraryState({
        recent: readySlot([summary("invalid-date", { activityAt })]),
      })
    )
    expect(model.status).toBe("ready")
    if (model.status !== "ready") {
      throw new Error(`Expected ready, received ${model.status}.`)
    }
    expect(model.rows[0].activity.status).toBe("invalid")
  })

  it.each([
    [
      "2026-08-29T10:30:00.000Z",
      "2026-08-29T10:30:00.000Z",
      "Aug 29, 2026, 10:30 AM",
    ],
    [
      "2026-08-29T16:00:00+05:30",
      "2026-08-29T10:30:00.000Z",
      "Aug 29, 2026, 10:30 AM",
    ],
    [
      "2024-02-29T23:59:59.9-02:00",
      "2024-03-01T01:59:59.900Z",
      "Mar 1, 2024, 1:59 AM",
    ],
  ])(
    "normalizes valid ISO activity timestamp %s to its labeled instant",
    (activityAt, dateTime, label) => {
      expect(recentDocumentActivity(activityAt, formatOptions)).toEqual({
        status: "valid",
        dateTime,
        label,
      })
    }
  )

  it("labels every origin and keeps source and origin as separate facts", () => {
    expect(recentDocumentOriginLabel({ kind: "blank" })).toBe("Started blank")
    expect(recentDocumentOriginLabel({ kind: "quotation" })).toBe(
      "Created from a quotation"
    )
    expect(recentDocumentOriginLabel({ kind: "import" })).toBe(
      "Imported document"
    )
    expect(
      recentDocumentOriginLabel({
        kind: "duplicate",
        sourceDocumentId: "source-7",
      })
    ).toBe("Duplicated document")
    expect(recentDocumentOriginLabel({ kind: "current-draft-migration" })).toBe(
      "Migrated browser draft"
    )
  })

  it("projects a retained page and its age while refresh is pending", () => {
    const retained = confirmedPage([summary("retained")], {
      confirmedAt: NOW - 2 * 60 * 60 * 1000,
    })
    const model = project(
      libraryState({ recent: { status: "loading", retained } })
    )
    expect(model).toMatchObject({
      status: "refreshing",
      rows: [{ documentId: "retained" }],
      page: {
        confirmedAt: retained.confirmedAt,
        lastConfirmedLabel: "Last confirmed 2 hours ago",
        stale: true,
      },
    })
  })

  it("distinguishes loading more and its retained retry failure", () => {
    const loading = project(
      libraryState({
        recent: readySlot([summary("page-1")], {
          page: { nextCursor: "opaque" },
          pagination: "loading_more",
        }),
      })
    )
    const failed = project(
      libraryState({
        recent: readySlot([summary("page-1")], {
          page: { nextCursor: "opaque" },
          paginationFailure: failure("The next page failed."),
        }),
      })
    )
    expect(loading).toMatchObject({
      status: "loading_more",
      page: {
        hasMore: true,
        pagination: {
          status: "available",
          label: "Load more documents",
          focusRequested: false,
        },
      },
    })
    expect(failed).toMatchObject({
      status: "load_more_failed",
      canRetryLoadMore: true,
      failure: { message: "The next page failed." },
      rows: [{ documentId: "page-1" }],
    })
  })

  it("projects a focusable settled pagination status after the final page", () => {
    const model = project(
      libraryState({
        recent: readySlot([summary("last-page")]),
        focusIntent: { id: 18, target: "pagination-status" },
      })
    )
    expect(model.status).toBe("ready")
    if (model.status !== "ready") {
      throw new Error(`Expected ready, received ${model.status}.`)
    }
    expect(model.page).toMatchObject({
      hasMore: false,
      pagination: {
        status: "complete",
        label: "All documents loaded",
        focusRequested: true,
      },
    })
    expect(model.focusIntent).toEqual({
      id: 18,
      target: "pagination-status",
    })
  })

  it("distinguishes retained refresh failure from terminal failure", () => {
    const retained = project(
      libraryState({
        recent: {
          status: "failed",
          retained: confirmedPage([summary("safe")]),
          failure: failure("Refresh failed."),
        },
      })
    )
    const terminal = project(
      libraryState({
        recent: {
          status: "failed",
          retained: null,
          failure: failure("Initial load failed."),
        },
      })
    )
    expect(retained).toMatchObject({
      status: "retained_error",
      canRetry: true,
      rows: [{ documentId: "safe" }],
      failure: { message: "Refresh failed." },
      page: { stale: true },
    })
    expect(terminal).toMatchObject({
      status: "terminal_error",
      canRetry: true,
      rows: [],
      page: null,
      failure: { message: "Initial load failed." },
    })
  })

  it("keeps action-local errors and locks only an actively owned row", () => {
    const editing: DocumentActionState = {
      kind: "rename",
      phase: "editing",
      owner: "recent",
      documentName: "Editing proposal",
      expectedRecordVersion: 3,
      input: "Renamed draft",
      error: "That name is already in use.",
    }
    const failed: DocumentActionState = {
      kind: "duplicate",
      phase: "failed",
      owner: "recent",
      documentName: "Failed proposal",
      token: 9,
      error: "The copy could not be saved.",
    }
    const model = project(
      libraryState({
        recent: readySlot([summary("editing"), summary("failed")]),
        actions: new Map<string, DocumentActionState>([
          ["editing", editing],
          ["failed", failed],
        ]),
      })
    )
    expect(model.status).toBe("ready")
    if (model.status !== "ready") {
      throw new Error(`Expected ready, received ${model.status}.`)
    }
    expect(model.rows[0]).toMatchObject({
      action: {
        status: "rename_editing",
        input: "Renamed draft",
        error: "That name is already in use.",
      },
      capabilities: {
        open: { visible: true, enabled: false },
        rename: { visible: true, enabled: false },
        restore: { visible: false, enabled: false },
      },
    })
    expect(model.rows[1]).toMatchObject({
      action: {
        status: "failed",
        kind: "duplicate",
        error: "The copy could not be saved.",
      },
      capabilities: {
        open: { visible: true, enabled: true },
        duplicate: { visible: true, enabled: true },
      },
    })
    expect(model.actionFailures).toEqual([
      {
        documentId: "editing",
        documentName: "Editing proposal",
        owner: "recent",
        kind: "rename",
        message: "That name is already in use.",
        visible: true,
      },
      {
        documentId: "failed",
        documentName: "Failed proposal",
        owner: "recent",
        kind: "duplicate",
        message: "The copy could not be saved.",
        visible: true,
      },
    ])
  })

  it("projects rename dialogs independently from row visibility and keeps concurrent reservations", () => {
    const actions = new Map<string, DocumentActionState>([
      [
        "visible-editing",
        {
          kind: "rename",
          phase: "editing",
          owner: "recent",
          documentName: "Visible proposal",
          expectedRecordVersion: 2,
          input: "Visible edit",
          error: null,
        },
      ],
      [
        "hidden-failed",
        {
          kind: "rename",
          phase: "editing",
          owner: "recent",
          documentName: "Hidden proposal",
          expectedRecordVersion: 4,
          input: "Hidden failure",
          error: "This document changed elsewhere.",
        },
      ],
      [
        "visible-submitting",
        {
          kind: "rename",
          phase: "submitting",
          owner: "recent",
          documentName: "Submitting proposal",
          expectedRecordVersion: 6,
          input: "Visible submit",
          token: 10,
          error: null,
        },
      ],
      [
        "hidden-submitting",
        {
          kind: "rename",
          phase: "submitting",
          owner: "recent",
          documentName: "Hidden submitting proposal",
          expectedRecordVersion: 8,
          input: "Hidden submit",
          token: 11,
          error: null,
        },
      ],
      [
        "concurrent-copy",
        {
          kind: "duplicate",
          phase: "submitting",
          owner: "recent",
          documentName: "Concurrent proposal",
          token: 12,
          error: null,
        },
      ],
    ])
    const model = project(
      libraryState({
        recent: readySlot([
          summary("visible-editing"),
          summary("visible-submitting"),
          summary("concurrent-copy"),
        ]),
        actions,
      })
    )
    expect(model.status).toBe("ready")
    if (model.status !== "ready") {
      throw new Error(`Expected ready, received ${model.status}.`)
    }
    expect(model.renameActions).toEqual([
      {
        documentId: "visible-editing",
        documentName: "Visible proposal",
        owner: "recent",
        phase: "editing",
        input: "Visible edit",
        expectedRecordVersion: 2,
        error: null,
        visible: true,
      },
      {
        documentId: "hidden-failed",
        documentName: "Hidden proposal",
        owner: "recent",
        phase: "editing",
        input: "Hidden failure",
        expectedRecordVersion: 4,
        error: "This document changed elsewhere.",
        visible: false,
      },
      {
        documentId: "visible-submitting",
        documentName: "Submitting proposal",
        owner: "recent",
        phase: "submitting",
        input: "Visible submit",
        expectedRecordVersion: 6,
        error: null,
        visible: true,
      },
      {
        documentId: "hidden-submitting",
        documentName: "Hidden submitting proposal",
        owner: "recent",
        phase: "submitting",
        input: "Hidden submit",
        expectedRecordVersion: 8,
        error: null,
        visible: false,
      },
    ])
    expect(
      model.rows.find((row) => row.documentId === "visible-submitting")?.action
    ).toEqual({
      status: "submitting",
      kind: "rename",
      input: "Visible submit",
      expectedRecordVersion: 6,
    })
    expect(
      model.rows.find((row) => row.documentId === "concurrent-copy")?.action
    ).toEqual({ status: "submitting", kind: "duplicate" })
    expect(model.actionFailures).toContainEqual({
      documentId: "hidden-failed",
      documentName: "Hidden proposal",
      owner: "recent",
      kind: "rename",
      message: "This document changed elsewhere.",
      visible: false,
    })
  })

  it("keeps every non-rename submitting and failure kind representable", () => {
    const kinds = ["duplicate", "trash", "download", "restore"] as const
    const actions = new Map<string, DocumentActionState>()
    const recentRows: DocumentDraftSummary[] = []
    for (const [index, kind] of kinds.entries()) {
      const owner = kind === "restore" ? "trash" : "recent"
      const submittingId = `${kind}-submitting`
      const failedId = `${kind}-failed`
      actions.set(submittingId, {
        kind,
        phase: "submitting",
        owner,
        documentName: `Submitting ${kind}`,
        token: index * 2 + 1,
        error: null,
      })
      actions.set(failedId, {
        kind,
        phase: "failed",
        owner,
        documentName: `Failed ${kind}`,
        token: index * 2 + 2,
        error: `${kind} failed.`,
      })
      if (owner === "recent") {
        recentRows.push(summary(submittingId), summary(failedId))
      }
    }
    const model = project(
      libraryState({ recent: readySlot(recentRows), actions })
    )
    expect(model.status).toBe("ready")
    if (model.status !== "ready") {
      throw new Error(`Expected ready, received ${model.status}.`)
    }
    for (const kind of kinds.filter((candidate) => candidate !== "restore")) {
      expect(
        model.rows.find((row) => row.documentId === `${kind}-submitting`)
          ?.action
      ).toEqual({ status: "submitting", kind })
      expect(
        model.rows.find((row) => row.documentId === `${kind}-failed`)?.action
      ).toEqual({ status: "failed", kind, error: `${kind} failed.` })
    }
    expect(model.actionFailures).toEqual(
      kinds.map((kind) => ({
        documentId: `${kind}-failed`,
        documentName: `Failed ${kind}`,
        owner: kind === "restore" ? "trash" : "recent",
        kind,
        message: `${kind} failed.`,
        visible: kind !== "restore",
      }))
    )
  })

  it("exposes Restore as the only Trash row action and no purge capability", () => {
    const deleted = summary("deleted", {
      deletedAt: "2026-08-29T11:00:00.000Z",
    })
    const model = project(
      libraryState({
        collection: "trash",
        trash: readySlot([deleted]),
      })
    )
    expect(model.status).toBe("ready")
    if (model.status !== "ready") {
      throw new Error(`Expected ready, received ${model.status}.`)
    }
    expect(model.rows[0].capabilities).toEqual({
      open: { visible: false, enabled: false },
      rename: { visible: false, enabled: false },
      duplicate: { visible: false, enabled: false },
      download: { visible: false, enabled: false },
      moveToTrash: { visible: false, enabled: false },
      restore: { visible: true, enabled: true },
    })
    expect(model.rows[0].capabilities).not.toHaveProperty("purge")
  })

  it("passes captured focus, announcement, and persistent undo identities to the component", () => {
    const model = project(
      libraryState({
        recent: readySlot([summary("focus-me")]),
        announcement: { id: 12, message: "Document restored." },
        focusIntent: {
          id: 15,
          target: "document",
          documentId: "focus-me",
        },
        undo: {
          kind: "restore",
          documentId: "deleted-doc",
          name: "Deleted document",
          expectedRecordVersion: 4,
        },
      })
    )
    expect(model.status).toBe("ready")
    if (model.status !== "ready") {
      throw new Error(`Expected ready, received ${model.status}.`)
    }
    expect(model).toMatchObject({
      announcement: { id: 12, message: "Document restored." },
      focusIntent: {
        id: 15,
        target: "document",
        documentId: "focus-me",
      },
      undo: {
        documentId: "deleted-doc",
        name: "Deleted document",
        action: "restore",
      },
    })
    expect(model.rows[0].focusRequested).toBe(true)
  })

  it("switches to virtualization only after 48 metadata rows", () => {
    const rows = Array.from({ length: 49 }, (_, index) =>
      summary(`document-${String(index).padStart(2, "0")}`)
    )
    const atThreshold = project(
      libraryState({ recent: readySlot(rows.slice(0, 48)) })
    )
    const aboveThreshold = project(libraryState({ recent: readySlot(rows) }))
    expect(atThreshold.status).toBe("ready")
    expect(aboveThreshold.status).toBe("ready")
    if (atThreshold.status !== "ready") {
      throw new Error(`Expected ready, received ${atThreshold.status}.`)
    }
    if (aboveThreshold.status !== "ready") {
      throw new Error(`Expected ready, received ${aboveThreshold.status}.`)
    }
    expect(atThreshold.virtualization).toEqual({
      enabled: false,
      itemCount: 48,
      threshold: RECENT_DOCUMENTS_VIRTUALIZATION_THRESHOLD,
    })
    expect(aboveThreshold.virtualization).toEqual({
      enabled: true,
      itemCount: 49,
      threshold: RECENT_DOCUMENTS_VIRTUALIZATION_THRESHOLD,
    })
  })

  it("retains every migration status and warning through every collection state", () => {
    const recovery: DraftListRecoveryItem = {
      documentId: "corrupt-a",
      quarantineId: "quarantine-a",
      status: "quarantined",
      failure: { kind: "corrupt_record", message: "Metadata was invalid." },
    }
    const cases: ReadonlyArray<
      readonly [
        string,
        Extract<
          RecentDocumentsProviderState,
          { status: "ready" }
        >["migration"]["status"],
        RecentDocumentsState,
      ]
    > = [
      [
        "opening",
        "empty",
        libraryState({ recent: { status: "loading", retained: null } }),
      ],
      ["empty_recent", "migrated", libraryState({ recent: readySlot([]) })],
      [
        "empty_trash",
        "collision",
        libraryState({ collection: "trash", trash: readySlot([]) }),
      ],
      [
        "recovery_only",
        "empty",
        libraryState({ recent: readySlot([]), recoveryItems: [recovery] }),
      ],
      [
        "no_results",
        "migrated",
        libraryState({
          queryInput: "missing",
          appliedQuery: "missing",
          recent: readySlot([]),
        }),
      ],
      ["ready", "collision", libraryState()],
      [
        "refreshing",
        "empty",
        libraryState({
          recent: {
            status: "loading",
            retained: confirmedPage([summary("retained")]),
          },
        }),
      ],
      [
        "loading_more",
        "migrated",
        libraryState({
          recent: readySlot([summary("page")], {
            page: { nextCursor: "opaque" },
            pagination: "loading_more",
          }),
        }),
      ],
      [
        "load_more_failed",
        "collision",
        libraryState({
          recent: readySlot([summary("page")], {
            page: { nextCursor: "opaque" },
            paginationFailure: failure("Append failed."),
          }),
        }),
      ],
      [
        "retained_error",
        "empty",
        libraryState({
          recent: {
            status: "failed",
            retained: confirmedPage([summary("retained")]),
            failure: failure("Refresh failed."),
          },
        }),
      ],
      [
        "terminal_error",
        "migrated",
        libraryState({
          recent: {
            status: "failed",
            retained: null,
            failure: failure("Initial load failed."),
          },
        }),
      ],
    ]
    const warning = "The legacy cleanup journal could not be updated."
    for (const [expectedStatus, migrationStatus, state] of cases) {
      const model = projectRecentDocumentsModel(
        providerReady(state, warning, migrationStatus),
        formatOptions
      )
      expect(model.status, expectedStatus).toBe(expectedStatus)
      if (!("persistence" in model)) {
        throw new Error(`Expected ${expectedStatus} to retain persistence.`)
      }
      expect(model.persistence).toEqual({ migrationStatus, warning })
    }
  })

  it("formats confirmed age deterministically at boundary values", () => {
    expect(recentDocumentsLastConfirmedLabel(NOW - 59_000, formatOptions)).toBe(
      "Last confirmed just now"
    )
    expect(recentDocumentsLastConfirmedLabel(NOW - 60_000, formatOptions)).toBe(
      "Last confirmed 1 minute ago"
    )
    expect(
      recentDocumentsLastConfirmedLabel(
        NOW - 24 * 60 * 60 * 1000,
        formatOptions
      )
    ).toBe("Last confirmed Aug 28, 2026, 12:00 PM")
    expect(recentDocumentsLastConfirmedLabel(Number.NaN, formatOptions)).toBe(
      "Last confirmed time unavailable"
    )
  })

  it("formats metadata with another explicit locale", () => {
    const options = { locale: "en-GB", timeZone: "UTC", now: NOW } as const
    const model = projectRecentDocumentsModel(
      providerReady(
        libraryState({
          recent: readySlot([
            summary("locale", {
              firstPageWidth: 1240,
              firstPageHeight: 1754,
            }),
          ]),
        })
      ),
      options
    )
    expect(model.status).toBe("ready")
    if (model.status !== "ready") {
      throw new Error(`Expected ready, received ${model.status}.`)
    }
    expect(model.rows[0]).toMatchObject({
      dimensionsLabel: "1,240 × 1,754 px",
      activity: { label: "29 Aug 2026, 10:30" },
    })
  })

  it.each([
    [null, "Standalone"],
    ["template", "Template-backed"],
    ["quotation", "Quotation-backed"],
  ] as const)("projects %s source as %s", (sourceKind, sourceLabel) => {
    const model = project(
      libraryState({
        recent: readySlot([summary("source", { sourceKind })]),
      })
    )
    expect(model.status).toBe("ready")
    if (model.status !== "ready") {
      throw new Error(`Expected ready, received ${model.status}.`)
    }
    expect(model.rows[0].sourceLabel).toBe(sourceLabel)
  })

  it("retains rename dialog ownership when the reserved row is absent", () => {
    const hiddenRename: DocumentActionState = {
      kind: "rename",
      phase: "editing",
      owner: "recent",
      documentName: "Hidden proposal",
      expectedRecordVersion: 12,
      input: "Client proposal",
      error: "This document changed elsewhere.",
    }
    const model = project(
      libraryState({
        recent: readySlot([]),
        actions: new Map([["hidden-document", hiddenRename]]),
      })
    )
    expect(model).toMatchObject({
      status: "empty_recent",
      renameActions: [
        {
          documentId: "hidden-document",
          documentName: "Hidden proposal",
          owner: "recent",
          phase: "editing",
          input: "Client proposal",
          expectedRecordVersion: 12,
          error: "This document changed elsewhere.",
          visible: false,
        },
      ],
    })
  })

  it("keeps a confirmed query miss primary while sticky recovery remains visible", () => {
    const recovery: DraftListRecoveryItem = {
      documentId: "corrupt-a",
      quarantineId: "quarantine-a",
      status: "quarantined",
      failure: { kind: "corrupt_record", message: "Metadata was invalid." },
    }
    const model = project(
      libraryState({
        queryInput: "invoice",
        appliedQuery: "invoice",
        recent: readySlot([]),
        recoveryItems: [recovery],
      })
    )
    expect(model).toMatchObject({
      status: "no_results",
      canClearQuery: true,
      recoveryItems: [{ quarantineId: "quarantine-a" }],
    })
  })

  it("rejects an impossible calendar timestamp instead of normalizing its label", () => {
    expect(
      recentDocumentActivity("2026-02-30T00:00:00.000Z", formatOptions)
    ).toEqual({
      status: "invalid",
      dateTime: null,
      label: "Activity date unavailable",
    })
  })

  it("keeps one quarantine identity when a generic failure becomes exact", () => {
    const generic: DraftListRecoveryItem = {
      documentId: "document-a",
      quarantineId: "quarantine-a",
      status: "quarantined",
      failure: { kind: "corrupt_record", message: "Generic failure." },
    }
    const exact: DraftListRecoveryItem = {
      ...generic,
      failure: { kind: "validation_failed", message: "Exact failure." },
    }
    const genericModel = project(
      libraryState({ recent: readySlot([]), recoveryItems: [generic] })
    )
    const exactModel = project(
      libraryState({ recent: readySlot([]), recoveryItems: [exact] })
    )
    expect(genericModel.status).toBe("recovery_only")
    expect(exactModel.status).toBe("recovery_only")
    if (
      genericModel.status !== "recovery_only" ||
      exactModel.status !== "recovery_only"
    ) {
      throw new Error("Expected recovery-only models.")
    }
    expect(genericModel.recoveryItems[0].key).toBe(
      exactModel.recoveryItems[0].key
    )
  })

  it("accepts repository-valid fractional precision and normalizes to milliseconds", () => {
    expect(
      recentDocumentActivity("2026-08-29T10:30:00.1234Z", formatOptions)
    ).toEqual({
      status: "valid",
      dateTime: "2026-08-29T10:30:00.123Z",
      label: "Aug 29, 2026, 10:30 AM",
    })
  })

  it("accepts repository-valid year zero without relabeling it as year one", () => {
    expect(
      recentDocumentActivity("0000-01-01T00:00:00.000Z", formatOptions)
    ).toEqual({
      status: "valid",
      dateTime: "0000-01-01T00:00:00.000Z",
      label: "0000-01-01T00:00:00.000Z",
    })
  })

  it("constructs one date and one number formatter for a 100-row projection", () => {
    const createDateTimeFormat = vi.fn(
      (locale: string, options: Intl.DateTimeFormatOptions) =>
        new Intl.DateTimeFormat(locale, options)
    )
    const createNumberFormat = vi.fn(
      (locale: string, options: Intl.NumberFormatOptions) =>
        new Intl.NumberFormat(locale, options)
    )
    const rows = Array.from({ length: 100 }, (_, index) =>
      summary(`formatter-${index}`)
    )
    const model = projectRecentDocumentsModel(
      providerReady(libraryState({ recent: readySlot(rows) })),
      { ...formatOptions, createDateTimeFormat, createNumberFormat }
    )
    expect(model.status).toBe("ready")
    expect(createDateTimeFormat).toHaveBeenCalledTimes(1)
    expect(createNumberFormat).toHaveBeenCalledTimes(1)
  })
})
