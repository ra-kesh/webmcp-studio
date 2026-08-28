import type { Document } from "@webmcp/document"
import type { DocumentDraftSummary } from "./document-draft-repository"
import type {
  CurrentDraftBootstrapResult,
  CurrentDraftEnvelope,
} from "./current-draft-repository"

export type StudioStartIntent =
  | { kind: "continue" }
  | { kind: "template"; templateId: string; version: number }
  | { kind: "blank" }
  | { kind: "import" }
  | { kind: "sample" }

export type CurrentDraftSummary = Readonly<{
  documentId: string
  name: string
  updatedAt: string
  pageCount: number
  outputCount: number
  firstPage: Readonly<{
    name: string
    width: number
    height: number
  }>
  exportFormats: readonly ("png" | "pdf")[]
  sourceKind: "quotation" | "template" | null
}>

export type StudioStartModel =
  | Readonly<{
      status: "opening"
    }>
  | Readonly<{
      status: "recovery_required"
      recovery: Extract<
        CurrentDraftBootstrapResult,
        { status: "recovery_required" }
      >["recovery"]
    }>
  | Readonly<{
      status: "ready"
      durable: boolean
      storageWarning: string | null
      currentDraft: CurrentDraftSummary | null
      recoverableEnvelope: CurrentDraftEnvelope | null
    }>
  | Readonly<{
      status: "blocked" | "unavailable"
      durable: false
      storageWarning: string
      currentDraft: CurrentDraftSummary | null
      recoverableEnvelope: CurrentDraftEnvelope | null
    }>

function firstOrderedPage(document: Document) {
  const firstOutput = document.outputs[0]
  const firstPageId = firstOutput.pageIds[0]
  return (
    document.pages.find((page) => page.id === firstPageId) ?? document.pages[0]
  )
}

export function deriveCurrentDraftSummary(
  envelope: CurrentDraftEnvelope
): CurrentDraftSummary {
  const firstPage = firstOrderedPage(envelope.document)
  const exportFormats = [
    ...new Set(
      envelope.document.outputs.flatMap((output) => output.exportFormats)
    ),
  ]
  return {
    documentId: envelope.document.id,
    name: envelope.document.name,
    updatedAt: envelope.document.updatedAt,
    pageCount: envelope.document.pages.length,
    outputCount: envelope.document.outputs.length,
    firstPage: {
      name: firstPage.name,
      width: firstPage.width,
      height: firstPage.height,
    },
    exportFormats,
    sourceKind: envelope.sourceContext?.quotationSource
      ? "quotation"
      : envelope.sourceContext?.designTemplate
        ? "template"
        : null,
  }
}

export function deriveRepositoryDraftSummary(
  summary: DocumentDraftSummary
): CurrentDraftSummary {
  return {
    documentId: summary.documentId,
    name: summary.name,
    updatedAt: summary.activityAt,
    pageCount: summary.pageCount,
    outputCount: summary.outputCount,
    firstPage: {
      name: summary.firstPageName,
      width: summary.firstPageWidth,
      height: summary.firstPageHeight,
    },
    exportFormats: summary.exportFormats,
    sourceKind: summary.sourceKind,
  }
}

export function projectStudioStartModel(
  bootstrap: CurrentDraftBootstrapResult
): StudioStartModel {
  if (bootstrap.status === "recovery_required") {
    return { status: "recovery_required", recovery: bootstrap.recovery }
  }
  if (bootstrap.status === "current") {
    return {
      status: "ready",
      durable: true,
      storageWarning: bootstrap.warnings.length
        ? bootstrap.warnings.map((warning) => warning.message).join(" ")
        : null,
      currentDraft: deriveCurrentDraftSummary(bootstrap.envelope),
      recoverableEnvelope: bootstrap.envelope,
    }
  }
  if (bootstrap.status === "storage_unavailable") {
    return {
      status: "ready",
      durable: false,
      storageWarning: bootstrap.failure.message,
      currentDraft: bootstrap.recoverableDraft
        ? deriveCurrentDraftSummary(bootstrap.recoverableDraft)
        : null,
      recoverableEnvelope: bootstrap.recoverableDraft ?? null,
    }
  }
  return {
    status: "ready",
    durable: true,
    storageWarning: null,
    currentDraft: null,
    recoverableEnvelope: null,
  }
}

export function startIntentReplacesCurrentDraft(
  currentDraft: CurrentDraftSummary | null,
  intent: StudioStartIntent
) {
  return currentDraft !== null && intent.kind !== "continue"
}
