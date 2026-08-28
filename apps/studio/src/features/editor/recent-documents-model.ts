import type {
  CollectionSlot,
  DocumentActionState,
  DocumentsCollection,
  DocumentsView,
  RecentDocumentsState,
} from "./recent-documents-controller"
import type {
  DocumentDraftSummary,
  DraftListRecoveryItem,
  DraftOrigin,
  DraftRepositoryFailure,
} from "./document-draft-repository"
import type { RecentDocumentsProviderState } from "./recent-documents-provider"

export const RECENT_DOCUMENTS_VIRTUALIZATION_THRESHOLD = 48

type ReadyProviderState = Extract<
  RecentDocumentsProviderState,
  { status: "ready" }
>

export type RecentDocumentsFormatOptions = Readonly<{
  locale: string
  now: number
  timeZone?: string
  createDateTimeFormat?: (
    locale: string,
    options: Intl.DateTimeFormatOptions
  ) => Intl.DateTimeFormat
  createNumberFormat?: (
    locale: string,
    options: Intl.NumberFormatOptions
  ) => Intl.NumberFormat
}>

type RecentDocumentsFormatterContext = Readonly<{
  dates: Intl.DateTimeFormat
  numbers: Intl.NumberFormat
}>

export type RecentDocumentActivityModel =
  | Readonly<{
      status: "valid"
      dateTime: string
      label: string
    }>
  | Readonly<{
      status: "invalid"
      dateTime: null
      label: "Activity date unavailable"
    }>

export type RecentDocumentActionKind =
  "rename" | "duplicate" | "trash" | "restore" | "download"

export type RecentDocumentActionModel =
  | Readonly<{ status: "idle" }>
  | Readonly<{
      status: "rename_editing"
      input: string
      error: string | null
      expectedRecordVersion: number
    }>
  | Readonly<{
      status: "submitting"
      kind: "rename"
      input: string
      expectedRecordVersion: number
    }>
  | Readonly<{
      status: "submitting"
      kind: Exclude<RecentDocumentActionKind, "rename">
    }>
  | Readonly<{
      status: "failed"
      kind: RecentDocumentActionKind
      error: string
    }>

export type RecentDocumentRenameActionModel = Readonly<{
  documentId: string
  documentName: string
  owner: "recent"
  phase: "editing" | "submitting"
  input: string
  expectedRecordVersion: number
  error: string | null
  visible: boolean
}>

export type RecentDocumentCapability = Readonly<{
  visible: boolean
  enabled: boolean
}>

export type RecentDocumentCapabilities = Readonly<{
  open: RecentDocumentCapability
  rename: RecentDocumentCapability
  duplicate: RecentDocumentCapability
  download: RecentDocumentCapability
  moveToTrash: RecentDocumentCapability
  restore: RecentDocumentCapability
}>

export type RecentDocumentRowModel = Readonly<{
  documentId: string
  name: string
  recordVersion: number
  origin: DraftOrigin
  originLabel: string
  sourceKind: DocumentDraftSummary["sourceKind"]
  sourceLabel: string
  pageCount: number
  pageCountLabel: string
  outputCount: number
  outputCountLabel: string
  firstPageName: string
  dimensionsLabel: string
  exportFormatsLabel: string
  activity: RecentDocumentActivityModel
  deletedAt: string | null
  action: RecentDocumentActionModel
  capabilities: RecentDocumentCapabilities
  focusRequested: boolean
}>

export type RecentDocumentRecoveryModel = Readonly<{
  key: string
  documentId: string | null
  quarantineId: string | null
  status: DraftListRecoveryItem["status"]
  title: string
  message: string
}>

export type RecentDocumentActionFailureModel = Readonly<{
  documentId: string
  documentName: string
  owner: DocumentsCollection
  kind: RecentDocumentActionKind
  message: string
  visible: boolean
}>

export type RecentDocumentsCollectionBase = Readonly<{
  persistence: Readonly<{
    migrationStatus: ReadyProviderState["migration"]["status"]
    warning: string | null
  }>
  collection: DocumentsCollection
  collectionLabel: "Recent" | "Trash"
  view: DocumentsView
  query: Readonly<{
    input: string
    applied: string
    pending: boolean
    active: boolean
    canClear: boolean
  }>
  rows: readonly RecentDocumentRowModel[]
  recoveryItems: readonly RecentDocumentRecoveryModel[]
  renameActions: readonly RecentDocumentRenameActionModel[]
  actionFailures: readonly RecentDocumentActionFailureModel[]
  undo: null | Readonly<{
    documentId: string
    name: string
    action: "restore"
  }>
  announcement: RecentDocumentsState["announcement"]
  focusIntent: RecentDocumentsState["focusIntent"]
  virtualization: Readonly<{
    enabled: boolean
    itemCount: number
    threshold: typeof RECENT_DOCUMENTS_VIRTUALIZATION_THRESHOLD
  }>
  page: null | Readonly<{
    revision: number
    confirmedAt: number
    lastConfirmedLabel: string
    stale: boolean
    hasMore: boolean
    pagination: Readonly<{
      status: "available" | "complete"
      label: "Load more documents" | "All documents loaded"
      focusRequested: boolean
    }>
  }>
}>

type CollectionOpeningModel = RecentDocumentsCollectionBase &
  Readonly<{
    status: "opening"
    owner: "collection"
  }>

type ConfirmedCollectionModel = RecentDocumentsCollectionBase &
  Readonly<{ page: NonNullable<RecentDocumentsCollectionBase["page"]> }>

export type RecentDocumentsModel =
  | Readonly<{ status: "opening"; owner: "persistence" }>
  | Readonly<{
      status: "recovery_required"
      sourceStorageKey: string
      capturedAt: string
      failure: Readonly<{ kind: string; message: string }>
      hasDownloadableOriginal: true
    }>
  | Readonly<{
      status: "blocked" | "unavailable"
      failure: Readonly<{ kind: string; message: string }>
      hasRecoverableDocument: boolean
      canRetry: true
    }>
  | CollectionOpeningModel
  | (ConfirmedCollectionModel &
      Readonly<{
        status: "empty_recent"
        canCreate: true
      }>)
  | (ConfirmedCollectionModel &
      Readonly<{
        status: "empty_trash"
      }>)
  | (ConfirmedCollectionModel &
      Readonly<{
        status: "recovery_only"
      }>)
  | (ConfirmedCollectionModel &
      Readonly<{
        status: "no_results"
        canClearQuery: true
      }>)
  | (ConfirmedCollectionModel &
      Readonly<{
        status: "ready"
        canLoadMore: boolean
      }>)
  | (ConfirmedCollectionModel &
      Readonly<{
        status: "refreshing"
      }>)
  | (ConfirmedCollectionModel &
      Readonly<{
        status: "loading_more"
      }>)
  | (ConfirmedCollectionModel &
      Readonly<{
        status: "load_more_failed"
        failure: DraftRepositoryFailure
        canRetryLoadMore: true
      }>)
  | (ConfirmedCollectionModel &
      Readonly<{
        status: "retained_error"
        failure: DraftRepositoryFailure
        canRetry: true
      }>)
  | (RecentDocumentsCollectionBase &
      Readonly<{
        status: "terminal_error"
        page: null
        failure: DraftRepositoryFailure
        canRetry: true
      }>)

const countLabel = (count: number, singular: string, plural: string) =>
  `${count} ${count === 1 ? singular : plural}`

const sourceLabel = (summary: DocumentDraftSummary) => {
  if (summary.sourceKind === "quotation") return "Quotation-backed"
  if (summary.sourceKind === "template") return "Template-backed"
  return "Standalone"
}

export function recentDocumentOriginLabel(origin: DraftOrigin): string {
  switch (origin.kind) {
    case "blank":
      return "Started blank"
    case "template":
      return `Template ${origin.templateId}, version ${origin.templateVersion}`
    case "quotation":
      return "Created from a quotation"
    case "import":
      return "Imported document"
    case "duplicate":
      return "Duplicated document"
    case "current-draft-migration":
      return "Migrated browser draft"
  }
}

function dateFormatter(options: RecentDocumentsFormatOptions) {
  const formatterOptions: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  }
  return options.createDateTimeFormat
    ? options.createDateTimeFormat(options.locale, formatterOptions)
    : new Intl.DateTimeFormat(options.locale, formatterOptions)
}

function numberFormatter(options: RecentDocumentsFormatOptions) {
  const formatterOptions: Intl.NumberFormatOptions = {
    maximumFractionDigits: 0,
  }
  return options.createNumberFormat
    ? options.createNumberFormat(options.locale, formatterOptions)
    : new Intl.NumberFormat(options.locale, formatterOptions)
}

function formatterContext(
  options: RecentDocumentsFormatOptions
): RecentDocumentsFormatterContext {
  return {
    dates: dateFormatter(options),
    numbers: numberFormatter(options),
  }
}

function formatRecentDocumentActivity(
  value: string,
  dates: Intl.DateTimeFormat
): RecentDocumentActivityModel {
  const match =
    /^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value
    )
  if (!match) {
    return {
      status: "invalid",
      dateTime: null,
      label: "Activity date unavailable",
    }
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const zone = match[8]
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ]
  const offsetValid =
    zone === "Z" ||
    (Number(zone.slice(1, 3)) <= 23 && Number(zone.slice(4, 6)) <= 59)
  const calendarValid =
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= (daysInMonth[month - 1] ?? 0) &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetValid
  const timestamp = calendarValid ? Date.parse(value) : Number.NaN
  if (!Number.isFinite(timestamp)) {
    return {
      status: "invalid",
      dateTime: null,
      label: "Activity date unavailable",
    }
  }
  const date = new Date(timestamp)
  const dateTime = date.toISOString()
  return {
    status: "valid",
    dateTime,
    label: year <= 0 ? dateTime : dates.format(date),
  }
}

export function recentDocumentActivity(
  value: string,
  options: RecentDocumentsFormatOptions
): RecentDocumentActivityModel {
  return formatRecentDocumentActivity(value, dateFormatter(options))
}

function formatLastConfirmedLabel(
  confirmedAt: number,
  options: RecentDocumentsFormatOptions,
  dates: Intl.DateTimeFormat
) {
  if (!Number.isFinite(confirmedAt)) return "Last confirmed time unavailable"
  const elapsed = Math.max(0, options.now - confirmedAt)
  const seconds = Math.floor(elapsed / 1000)
  if (seconds < 60) return "Last confirmed just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `Last confirmed ${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `Last confirmed ${hours} ${hours === 1 ? "hour" : "hours"} ago`
  }
  return `Last confirmed ${dates.format(new Date(confirmedAt))}`
}

export function recentDocumentsLastConfirmedLabel(
  confirmedAt: number,
  options: RecentDocumentsFormatOptions
) {
  return formatLastConfirmedLabel(confirmedAt, options, dateFormatter(options))
}

function actionModel(
  action: DocumentActionState | undefined
): RecentDocumentActionModel {
  if (!action) return { status: "idle" }
  if (action.kind === "rename") {
    if (action.phase === "editing") {
      return {
        status: "rename_editing",
        input: action.input,
        error: action.error,
        expectedRecordVersion: action.expectedRecordVersion,
      }
    }
    return {
      status: "submitting",
      kind: "rename",
      input: action.input,
      expectedRecordVersion: action.expectedRecordVersion,
    }
  }
  if (action.phase === "failed") {
    return { status: "failed", kind: action.kind, error: action.error }
  }
  return { status: "submitting", kind: action.kind }
}

function capabilities(
  collection: DocumentsCollection,
  action: RecentDocumentActionModel
): RecentDocumentCapabilities {
  const locked =
    action.status === "rename_editing" || action.status === "submitting"
  const capability = (visible: boolean): RecentDocumentCapability => ({
    visible,
    enabled: visible && !locked,
  })
  const recent = collection === "recent"
  return {
    open: capability(recent),
    rename: capability(recent),
    duplicate: capability(recent),
    download: capability(recent),
    moveToTrash: capability(recent),
    restore: capability(!recent),
  }
}

function rowModel(
  summary: DocumentDraftSummary,
  collection: DocumentsCollection,
  state: RecentDocumentsState,
  formatters: RecentDocumentsFormatterContext
): RecentDocumentRowModel {
  const ownedAction = state.actions.get(summary.documentId)
  const projectedAction = actionModel(
    ownedAction?.owner === collection ? ownedAction : undefined
  )
  return {
    documentId: summary.documentId,
    name: summary.name,
    recordVersion: summary.recordVersion,
    origin: summary.origin,
    originLabel: recentDocumentOriginLabel(summary.origin),
    sourceKind: summary.sourceKind,
    sourceLabel: sourceLabel(summary),
    pageCount: summary.pageCount,
    pageCountLabel: countLabel(summary.pageCount, "page", "pages"),
    outputCount: summary.outputCount,
    outputCountLabel: countLabel(summary.outputCount, "output", "outputs"),
    firstPageName: summary.firstPageName,
    dimensionsLabel: `${formatters.numbers.format(summary.firstPageWidth)} × ${formatters.numbers.format(summary.firstPageHeight)} px`,
    exportFormatsLabel: summary.exportFormats.length
      ? summary.exportFormats.map((format) => format.toUpperCase()).join(", ")
      : "No export formats",
    activity: formatRecentDocumentActivity(
      summary.activityAt,
      formatters.dates
    ),
    deletedAt: summary.deletedAt,
    action: projectedAction,
    capabilities: capabilities(collection, projectedAction),
    focusRequested:
      state.focusIntent?.target === "document" &&
      state.focusIntent.documentId === summary.documentId,
  }
}

function recoveryKey(item: DraftListRecoveryItem) {
  if (item.status === "quarantined") {
    return JSON.stringify(["quarantined", item.quarantineId])
  }
  return JSON.stringify([
    "retained",
    item.documentId,
    item.failure.kind,
    item.failure.message,
  ])
}

function recoveryModel(
  item: DraftListRecoveryItem
): RecentDocumentRecoveryModel {
  return {
    key: recoveryKey(item),
    documentId: item.documentId,
    quarantineId: item.quarantineId,
    status: item.status,
    title:
      item.status === "quarantined"
        ? "Document moved to recovery"
        : "Unreadable document retained",
    message: item.failure.message,
  }
}

function actionFailureModels(
  state: RecentDocumentsState,
  visibleIds: ReadonlySet<string>
) {
  const failures: RecentDocumentActionFailureModel[] = []
  for (const [documentId, action] of state.actions) {
    const message =
      action.kind === "rename" && action.phase === "editing"
        ? action.error
        : action.phase === "failed"
          ? action.error
          : null
    if (!message) continue
    failures.push({
      documentId,
      documentName: action.documentName,
      owner: action.owner,
      kind: action.kind,
      message,
      visible: action.owner === state.collection && visibleIds.has(documentId),
    })
  }
  return failures
}

function renameActionModels(
  state: RecentDocumentsState,
  visibleIds: ReadonlySet<string>
) {
  const renames: RecentDocumentRenameActionModel[] = []
  for (const [documentId, action] of state.actions) {
    if (action.kind !== "rename") continue
    renames.push({
      documentId,
      documentName: action.documentName,
      owner: action.owner,
      phase: action.phase,
      input: action.input,
      expectedRecordVersion: action.expectedRecordVersion,
      error: action.error,
      visible: action.owner === state.collection && visibleIds.has(documentId),
    })
  }
  return renames
}

function confirmedPage(slot: CollectionSlot) {
  if (slot.status === "ready") return slot.page
  if (slot.status === "loading" || slot.status === "failed") {
    return slot.retained
  }
  return null
}

function collectionBase(
  state: RecentDocumentsState,
  persistence: RecentDocumentsCollectionBase["persistence"],
  options: RecentDocumentsFormatOptions,
  formatters: RecentDocumentsFormatterContext
): RecentDocumentsCollectionBase {
  const slot = state[state.collection]
  const confirmed = confirmedPage(slot)
  const rows = (confirmed?.items ?? []).map((summary) =>
    rowModel(summary, state.collection, state, formatters)
  )
  const visibleIds = new Set(rows.map((row) => row.documentId))
  const stale = slot.status === "ready" ? slot.stale : confirmed !== null
  return {
    persistence,
    collection: state.collection,
    collectionLabel: state.collection === "recent" ? "Recent" : "Trash",
    view: state.view,
    query: {
      input: state.queryInput,
      applied: state.appliedQuery,
      pending: state.queryInput.trim() !== state.appliedQuery,
      active: state.appliedQuery.length > 0,
      canClear: state.queryInput.length > 0 || state.appliedQuery.length > 0,
    },
    rows,
    recoveryItems: state.recoveryItems.map(recoveryModel),
    renameActions: renameActionModels(state, visibleIds),
    actionFailures: actionFailureModels(state, visibleIds),
    undo: state.undo
      ? {
          documentId: state.undo.documentId,
          name: state.undo.name,
          action: "restore",
        }
      : null,
    announcement: state.announcement,
    focusIntent: state.focusIntent,
    virtualization: {
      enabled: rows.length > RECENT_DOCUMENTS_VIRTUALIZATION_THRESHOLD,
      itemCount: rows.length,
      threshold: RECENT_DOCUMENTS_VIRTUALIZATION_THRESHOLD,
    },
    page: confirmed
      ? {
          revision: confirmed.revision,
          confirmedAt: confirmed.confirmedAt,
          lastConfirmedLabel: formatLastConfirmedLabel(
            confirmed.confirmedAt,
            options,
            formatters.dates
          ),
          stale,
          hasMore: confirmed.nextCursor !== null,
          pagination: {
            status: confirmed.nextCursor === null ? "complete" : "available",
            label:
              confirmed.nextCursor === null
                ? "All documents loaded"
                : "Load more documents",
            focusRequested: state.focusIntent?.target === "pagination-status",
          },
        }
      : null,
  }
}

function requireConfirmedBase(
  base: RecentDocumentsCollectionBase
): ConfirmedCollectionModel {
  if (!base.page) {
    throw new Error("A confirmed document collection requires a page.")
  }
  return { ...base, page: base.page }
}

function projectCollection(
  provider: ReadyProviderState,
  options: RecentDocumentsFormatOptions
): RecentDocumentsModel {
  const state = provider.library
  const slot = state[state.collection]
  const formatters = formatterContext(options)
  const base = collectionBase(
    state,
    {
      migrationStatus: provider.migration.status,
      warning: provider.warning,
    },
    options,
    formatters
  )
  if (slot.status === "idle" || (slot.status === "loading" && !slot.retained)) {
    return { ...base, status: "opening", owner: "collection" }
  }
  if (slot.status === "failed" && !slot.retained) {
    return {
      ...base,
      status: "terminal_error",
      page: null,
      failure: slot.failure,
      canRetry: true,
    }
  }

  const confirmedBase = requireConfirmedBase(base)
  if (slot.status === "loading") {
    return { ...confirmedBase, status: "refreshing" }
  }
  if (slot.status === "failed") {
    return {
      ...confirmedBase,
      status: "retained_error",
      failure: slot.failure,
      canRetry: true,
    }
  }
  if (slot.pagination === "loading_more") {
    return { ...confirmedBase, status: "loading_more" }
  }
  if (slot.paginationFailure) {
    return {
      ...confirmedBase,
      status: "load_more_failed",
      failure: slot.paginationFailure,
      canRetryLoadMore: true,
    }
  }
  if (confirmedBase.rows.length === 0) {
    if (state.appliedQuery) {
      return {
        ...confirmedBase,
        status: "no_results",
        canClearQuery: true,
      }
    }
    if (confirmedBase.recoveryItems.length > 0) {
      return { ...confirmedBase, status: "recovery_only" }
    }
    return state.collection === "recent"
      ? { ...confirmedBase, status: "empty_recent", canCreate: true }
      : { ...confirmedBase, status: "empty_trash" }
  }
  return {
    ...confirmedBase,
    status: "ready",
    canLoadMore: confirmedBase.page.hasMore,
  }
}

export function projectRecentDocumentsModel(
  provider: RecentDocumentsProviderState,
  options: RecentDocumentsFormatOptions
): RecentDocumentsModel {
  switch (provider.status) {
    case "opening":
      return { status: "opening", owner: "persistence" }
    case "recovery_required":
      return {
        status: "recovery_required",
        sourceStorageKey: provider.recovery.sourceStorageKey,
        capturedAt: provider.recovery.capturedAt,
        failure: provider.recovery.failure,
        hasDownloadableOriginal: true,
      }
    case "blocked":
    case "unavailable":
      return {
        status: provider.status,
        failure: provider.failure,
        hasRecoverableDocument: provider.recoverableEnvelope !== null,
        canRetry: true,
      }
    case "ready":
      return projectCollection(provider, options)
  }
}
