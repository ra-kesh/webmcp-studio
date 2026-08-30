import type {
  Document,
  LibraryTemplateDetail,
  TemplateApplicationImpact,
} from "@webmcp/document"
import { libraryTemplateDetailSchema } from "@webmcp/document"

export type TemplateActionIntent = {
  itemKind: "template"
  id: string
  version: number
}

export type TemplateActionSnapshot = {
  document: Document
  documentGeneration: number
  sourceGeneration: number
  reviewGeneration: number
  hasQuotationSource: boolean
}

export type TemplateMutation = {
  document: Document
  sourceContext: unknown
  impact: TemplateApplicationImpact
  label: string
}

export type TemplateActionPorts = {
  getDetail: (
    kind: "template",
    id: string,
    version: number,
    signal: AbortSignal
  ) => Promise<LibraryTemplateDetail | null>
  getCurrent: () => TemplateActionSnapshot
  prepareCreate: (
    identity: { id: string; version: number },
    current: TemplateActionSnapshot
  ) => TemplateMutation
  prepareApply: (
    identity: { id: string; version: number },
    current: TemplateActionSnapshot
  ) => TemplateMutation
}

export type ResolvedTemplateAction = {
  action: "create" | "apply"
  intent: TemplateActionIntent
  detail: LibraryTemplateDetail
  snapshot: TemplateActionSnapshot
  mutation: TemplateMutation
  impact: TemplateApplicationImpact
  sequence: number
}

const sameSnapshot = (a: TemplateActionSnapshot, b: TemplateActionSnapshot) =>
  a.document.id === b.document.id &&
  a.document.revision === b.document.revision &&
  a.documentGeneration === b.documentGeneration &&
  a.sourceGeneration === b.sourceGeneration &&
  a.reviewGeneration === b.reviewGeneration

type TemplateActionFingerprint = Readonly<{
  documentId: string
  documentRevision: number
  documentGeneration: number
  sourceGeneration: number
  reviewGeneration: number
  hasQuotationSource: boolean
}>

const fingerprintSnapshot = (
  snapshot: TemplateActionSnapshot
): TemplateActionFingerprint =>
  Object.freeze({
    documentId: snapshot.document.id,
    documentRevision: snapshot.document.revision,
    documentGeneration: snapshot.documentGeneration,
    sourceGeneration: snapshot.sourceGeneration,
    reviewGeneration: snapshot.reviewGeneration,
    hasQuotationSource: snapshot.hasQuotationSource,
  })

const matchesFingerprint = (
  fingerprint: TemplateActionFingerprint,
  snapshot: TemplateActionSnapshot
) =>
  fingerprint.documentId === snapshot.document.id &&
  fingerprint.documentRevision === snapshot.document.revision &&
  fingerprint.documentGeneration === snapshot.documentGeneration &&
  fingerprint.sourceGeneration === snapshot.sourceGeneration &&
  fingerprint.reviewGeneration === snapshot.reviewGeneration &&
  fingerprint.hasQuotationSource === snapshot.hasQuotationSource

const fail = (message: string): never => {
  throw new Error(message)
}

const parseDetail = (value: unknown): LibraryTemplateDetail => {
  const parsed = libraryTemplateDetailSchema.safeParse(value)
  return parsed.success ? parsed.data : fail("The template detail is invalid")
}

function validateDetail(
  detail: LibraryTemplateDetail,
  intent: TemplateActionIntent,
  action: "create" | "apply",
  current: TemplateActionSnapshot
) {
  if (detail.summary.itemKind !== intent.itemKind)
    fail("Template detail kind does not match the requested identity")
  if (
    detail.summary.id !== intent.id ||
    detail.summary.version !== intent.version
  )
    fail("Template detail identity does not match the requested identity")
  if (
    detail.materialization.templateId !== intent.id ||
    detail.materialization.templateVersion !== intent.version
  )
    fail(
      "Template materialization identity does not match the requested identity"
    )
  if (detail.summary.catalogStatus !== "active")
    fail("This template version is retired")
  if (!detail.summary.permissions.canUse)
    fail("You do not have permission to use this template")
  if (detail.summary.compatibility.availability === "unavailable")
    fail(detail.summary.compatibility.reason ?? "This template is unavailable")
  if (
    detail.summary.compatibility.availability === "requires_source" &&
    !current.hasQuotationSource
  )
    fail("This template needs a linked quotation source")
  if (!detail.summary.compatibility.supportedActions.includes(action))
    fail(`This template does not support ${action}`)
}

export function createLibraryTemplateActions(ports: TemplateActionPorts) {
  let sequence = 0
  let active: AbortController | null = null
  const authority = new WeakMap<
    ResolvedTemplateAction,
    Readonly<{
      action: "create" | "apply"
      intent: TemplateActionIntent
      fingerprint: TemplateActionFingerprint
      sequence: number
    }>
  >()

  const resolve = async (
    intent: TemplateActionIntent,
    action: "create" | "apply"
  ): Promise<ResolvedTemplateAction> => {
    if (
      intent.itemKind !== "template" ||
      !intent.id ||
      !Number.isInteger(intent.version) ||
      intent.version < 1
    )
      fail("Invalid template action identity")
    const canonicalIntent = Object.freeze({ ...intent })
    active?.abort()
    const controller = new AbortController()
    active = controller
    const request = ++sequence
    const initial = ports.getCurrent()
    const loaded = await ports.getDetail(
      "template",
      canonicalIntent.id,
      canonicalIntent.version,
      controller.signal
    )
    if (controller.signal.aborted || request !== sequence)
      fail("Template action was superseded")
    if (!loaded) fail("The requested template version was not found")
    const detail = parseDetail(loaded)
    validateDetail(detail, canonicalIntent, action, initial)
    const current = ports.getCurrent()
    if (!sameSnapshot(initial, current))
      fail("The active document changed while this template was being prepared")
    const mutation =
      action === "create"
        ? ports.prepareCreate(
            {
              id: detail.materialization.templateId,
              version: detail.materialization.templateVersion,
            },
            current
          )
        : ports.prepareApply(
            {
              id: detail.materialization.templateId,
              version: detail.materialization.templateVersion,
            },
            current
          )
    const resolved = Object.freeze({
      action,
      intent: canonicalIntent,
      detail,
      snapshot: current,
      mutation,
      impact: mutation.impact,
      sequence: request,
    })
    authority.set(resolved, {
      action,
      intent: canonicalIntent,
      fingerprint: fingerprintSnapshot(current),
      sequence: request,
    })
    return resolved
  }

  const confirm = async (
    resolved: ResolvedTemplateAction,
    action: "create" | "apply"
  ) => {
    const pending = authority.get(resolved)
    if (!pending)
      throw new Error("Resolved template action is no longer authoritative")
    if (pending.action !== action || resolved.action !== action)
      fail("Resolved template action does not match this confirmation")
    if (
      pending.sequence !== sequence ||
      resolved.sequence !== pending.sequence ||
      resolved.intent.itemKind !== pending.intent.itemKind ||
      resolved.intent.id !== pending.intent.id ||
      resolved.intent.version !== pending.intent.version
    )
      fail("Template action was superseded")
    authority.delete(resolved)
    active?.abort()
    const controller = new AbortController()
    active = controller
    const request = ++sequence
    const fresh = await ports.getDetail(
      "template",
      pending.intent.id,
      pending.intent.version,
      controller.signal
    )
    if (controller.signal.aborted || request !== sequence)
      fail("Template action was superseded")
    if (!fresh) fail("The requested template version was not found")
    const detail = parseDetail(fresh)
    const current = ports.getCurrent()
    if (!matchesFingerprint(pending.fingerprint, current))
      fail("The active document changed. Choose the template again")
    validateDetail(detail, pending.intent, action, current)
    return action === "create"
      ? ports.prepareCreate(
          {
            id: detail.materialization.templateId,
            version: detail.materialization.templateVersion,
          },
          current
        )
      : ports.prepareApply(
          {
            id: detail.materialization.templateId,
            version: detail.materialization.templateVersion,
          },
          current
        )
  }

  return {
    resolveCreate: (intent: TemplateActionIntent) => resolve(intent, "create"),
    resolveApply: (intent: TemplateActionIntent) => resolve(intent, "apply"),
    confirmCreate: (resolved: ResolvedTemplateAction) =>
      confirm(resolved, "create"),
    confirmApply: (resolved: ResolvedTemplateAction) =>
      confirm(resolved, "apply"),
    cancel: () => {
      sequence++
      active?.abort()
      active = null
    },
  }
}
