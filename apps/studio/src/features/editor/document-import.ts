import {
  LOCAL_MEDIA_ADMISSION_ALIAS_LIMIT,
  DocumentMigrationError,
  DocumentValidationError,
  applyLocalMediaAdmissionPlan,
  decodeDocument,
  extractAssetReferences,
  localAssetPromotionResolveResponseSchema,
  managedAssetSource,
  mediaRequestIdSchema,
  planLocalMediaAdmission,
  validateDocument,
  validateRenderPolicy,
} from "@webmcp/document"
import type {
  Document,
  DocumentMigration,
  LocalMediaAdmissionFact,
  LocalMediaAdmissionPlan,
  MediaAssetLookup,
  ValidationIssue,
} from "@webmcp/document"
import {
  inspectRequestedLocalAssets,
  localAssetIdFromSource,
} from "./local-asset-store"
import type { LocalAssetAdmissionState } from "./local-asset-store"
import {
  getManagedMedia,
  managedMediaIdFromSource,
} from "./managed-media-repository"
import { resolveLocalAssetPromotions } from "./local-asset-promotion-client"
import type { LocalAssetPromotionResolveResult } from "./local-asset-promotion-client"
import { hashLocalAssetBlobSha256 } from "./local-asset-promotion-owner"
import { DRAFT_MAX_ENCODED_BYTES } from "./draft-admission"

/**
 * Start/editor JSON imports are deliberately capped at 32 MiB. The bound is
 * checked from File.size before text() allocates a second in-memory copy.
 * Render-policy limits remain authoritative after decoding; this is an
 * additional browser-memory admission boundary, not a document-schema limit.
 */
export const DOCUMENT_IMPORT_MAX_JSON_BYTES = DRAFT_MAX_ENCODED_BYTES

export type DocumentImportFile = Pick<File, "size" | "slice"> &
  Partial<Pick<File, "text">>

export class DocumentImportReadError extends Error {
  readonly kind: Extract<
    DocumentImportFailureKind,
    "empty_file" | "oversized_file" | "file_read_failed"
  >

  constructor(kind: DocumentImportReadError["kind"], message: string) {
    super(message)
    this.name = "DocumentImportReadError"
    this.kind = kind
  }
}

export function waitForDocumentImportOperation<T>(
  operation: Promise<T>,
  signal?: AbortSignal
) {
  if (!signal) return operation
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const cleanUp = () => signal.removeEventListener("abort", abort)
    const abort = () => {
      cleanUp()
      reject(signal.reason)
    }
    signal.addEventListener("abort", abort, { once: true })
    void operation.then(
      (value) => {
        cleanUp()
        if (!signal.aborted) resolve(value)
      },
      (error: unknown) => {
        cleanUp()
        if (!signal.aborted) reject(error)
      }
    )
  })
}

export async function readBoundedDocumentImportText(
  file: DocumentImportFile,
  signal?: AbortSignal,
  maxBytes = DOCUMENT_IMPORT_MAX_JSON_BYTES
) {
  signal?.throwIfAborted()
  if (file.size === 0) {
    throw new DocumentImportReadError(
      "empty_file",
      "The selected document file is empty."
    )
  }
  if (file.size > maxBytes) {
    throw new DocumentImportReadError(
      "oversized_file",
      `JSON files must be ${maxBytes.toLocaleString("en-US")} bytes or smaller.`
    )
  }
  const useBrowserReader =
    typeof FileReader !== "undefined" && file instanceof Blob
  const source = useBrowserReader ? file.slice(0, maxBytes) : null
  const raw = !useBrowserReader
    ? await waitForDocumentImportOperation(
        file.text?.() ??
          Promise.reject(
            new DocumentImportReadError(
              "file_read_failed",
              "The selected document file could not be read."
            )
          ),
        signal
      )
    : await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        let settled = false
        const cleanUp = () => {
          signal?.removeEventListener("abort", abort)
          reader.removeEventListener("abort", onAbort)
          reader.removeEventListener("error", onError)
          reader.removeEventListener("load", onLoad)
        }
        const settle = (callback: () => void) => {
          if (settled) return
          settled = true
          cleanUp()
          callback()
        }
        const abort = () => {
          if (reader.readyState === FileReader.LOADING) reader.abort()
          settle(() => reject(signal?.reason))
        }
        const onAbort = () =>
          settle(() =>
            reject(
              signal?.reason ??
                new DOMException(
                  "The document read was cancelled.",
                  "AbortError"
                )
            )
          )
        const onError = () =>
          settle(() =>
            reject(
              new DocumentImportReadError(
                "file_read_failed",
                "The selected document file could not be read."
              )
            )
          )
        const onLoad = () =>
          settle(() => {
            if (typeof reader.result !== "string") {
              reject(
                new DocumentImportReadError(
                  "file_read_failed",
                  "The selected document file could not be read."
                )
              )
              return
            }
            resolve(reader.result)
          })

        signal?.addEventListener("abort", abort, { once: true })
        reader.addEventListener("abort", onAbort, { once: true })
        reader.addEventListener("error", onError, { once: true })
        reader.addEventListener("load", onLoad, { once: true })
        try {
          reader.readAsText(source!)
        } catch {
          onError()
        }
      })
  signal?.throwIfAborted()
  if (!raw.trim()) {
    throw new DocumentImportReadError(
      "empty_file",
      "The selected document file is empty."
    )
  }
  return raw
}

export type DocumentImportFailureKind =
  | "empty_file"
  | "oversized_file"
  | "file_read_failed"
  | "malformed_json"
  | "schema_invalid"
  | "migration_failed"
  | "aggregate_invalid"
  | "render_policy_failed"
  | "resource_policy_failed"

export type DocumentImportFailure = Readonly<{
  kind: DocumentImportFailureKind
  message: string
  issue?: ValidationIssue
}>

export type DocumentImportResult =
  | Readonly<{
      ok: true
      document: Document
      migrations: readonly DocumentMigration[]
      mediaPlan: DocumentImportMediaPlan
      candidateDocument: Document | null
      recoveryManifest: DocumentImportRecoveryManifest
    }>
  | Readonly<{
      ok: false
      failure: DocumentImportFailure
    }>

export type DocumentImportManagedAsset = Pick<
  MediaAssetLookup,
  "id" | "status" | "selectable"
>

export type DocumentImportRecoveryState =
  | "on_device"
  | "studio_copy"
  | "studio_backup"
  | "file_missing"
  | "identity_conflict"
  | "device_status_unknown"
  | "backup_status_unknown"

export type DocumentImportRecoveryItem = Readonly<{
  localAssetId: string
  state: DocumentImportRecoveryState
  localStatus: LocalMediaAdmissionFact["local"]["status"]
  mappingStatus: LocalMediaAdmissionFact["mapping"]["status"]
  managedAssetId: string | null
  transformed: boolean
  requiresChoice: boolean
  expectedReferenceKeys: readonly string[]
  nodeIds: readonly string[]
  fieldIds: readonly string[]
  pageIds: readonly string[]
  outputIds: readonly string[]
}>

export type DocumentImportRecoveryManifest = Readonly<{
  requiresReview: boolean
  aliasCount: number
  transformedCount: number
  unresolvedCount: number
  archivedBackupCount: number
  items: readonly DocumentImportRecoveryItem[]
}>

export type DocumentImportMediaPlan =
  | Readonly<{
      status: "not_required"
      plan: null
      mappingRequestIds: readonly string[]
    }>
  | Readonly<{
      status: "planned"
      plan: LocalMediaAdmissionPlan
      mappingRequestIds: readonly string[]
    }>
  | Readonly<{
      status: "alias_limit_exceeded"
      code: "local_media_alias_limit_exceeded"
      aliasCount: number
      plan: null
      mappingRequestIds: readonly string[]
    }>

/**
 * Read-only resource boundaries are injected so validation and media planning
 * remain deterministic in tests. Installing a candidate and writing a draft
 * deliberately live outside this parser.
 */
export type DocumentImportResourceAdmission = Readonly<{
  inspectLocalAssets: (
    assetIds: readonly string[],
    signal?: AbortSignal
  ) => Promise<readonly LocalAssetAdmissionState[]>
  resolveLocalPromotions: (
    assetIds: readonly string[],
    signal?: AbortSignal
  ) => Promise<LocalAssetPromotionResolveResult>
  hashLocalAsset: (blob: Blob, signal?: AbortSignal) => Promise<string>
  resolveManagedAsset: (
    assetId: string,
    signal?: AbortSignal
  ) => Promise<DocumentImportManagedAsset | null>
}>

const defaultResourceAdmission: DocumentImportResourceAdmission = {
  inspectLocalAssets: (assetIds, signal) =>
    inspectRequestedLocalAssets(assetIds, { signal }),
  resolveLocalPromotions: (assetIds, signal) =>
    resolveLocalAssetPromotions(assetIds, { signal }),
  hashLocalAsset: hashLocalAssetBlobSha256,
  resolveManagedAsset: getManagedMedia,
}

const failure = (
  kind: DocumentImportFailureKind,
  message: string,
  issue?: ValidationIssue
): DocumentImportResult => ({
  ok: false,
  failure: { kind, message, ...(issue ? { issue } : {}) },
})

const firstBlockingIssue = (issues: readonly ValidationIssue[]) =>
  issues.find((issue) => issue.severity === "error")

const isEditableResourceIssue = (issue: ValidationIssue) =>
  issue.code === "unmanaged_asset" || issue.code === "unsupported_font"

type DocumentAssetReference = Readonly<{
  kind: "managed"
  assetId: string
  nodeId?: string
}>

const assetReferenceFromSource = (
  source: string,
  nodeId?: string
): DocumentAssetReference | null => {
  const managedAssetId = managedMediaIdFromSource(source)
  if (managedAssetId) {
    return {
      kind: "managed",
      assetId: managedAssetId,
      ...(nodeId ? { nodeId } : {}),
    }
  }
  return null
}

const isRepositoryImageIssue = (document: Document, issue: ValidationIssue) => {
  if (issue.code !== "unmanaged_asset" || !issue.nodeId) return false
  const node = document.nodes.find((candidate) => candidate.id === issue.nodeId)
  return (
    node?.type === "image" &&
    (localAssetIdFromSource(node.src) !== null ||
      assetReferenceFromSource(node.src) !== null)
  )
}

const referencedDocumentAssets = (document: Document) => {
  const references: DocumentAssetReference[] = []
  for (const node of document.nodes) {
    if (node.type !== "image") continue
    const reference = assetReferenceFromSource(node.src, node.id)
    if (reference) references.push(reference)
  }
  for (const field of document.fields) {
    if (field.type !== "asset") continue
    for (const value of [field.defaultValue, document.fieldValues[field.id]]) {
      if (typeof value !== "string") continue
      const reference = assetReferenceFromSource(value)
      if (reference) references.push(reference)
    }
  }

  const firstReferenceByIdentity = new Map<string, DocumentAssetReference>()
  for (const reference of references) {
    const identity = `${reference.kind}:${reference.assetId}`
    if (!firstReferenceByIdentity.has(identity)) {
      firstReferenceByIdentity.set(identity, reference)
    }
  }
  return [...firstReferenceByIdentity.values()]
}

const resourceIssue = (
  reference: DocumentAssetReference,
  message: string
): ValidationIssue => ({
  id: `document-import:resource:${reference.kind}:${reference.assetId}`,
  severity: "error",
  code: "missing_asset",
  message,
  ...(reference.nodeId ? { nodeId: reference.nodeId } : {}),
})

const admitManagedDocumentResources = async (
  document: Document,
  admission: DocumentImportResourceAdmission,
  signal?: AbortSignal
): Promise<ValidationIssue | null> => {
  for (const reference of referencedDocumentAssets(document)) {
    signal?.throwIfAborted()
    let asset: DocumentImportManagedAsset | null
    try {
      asset = signal
        ? await admission.resolveManagedAsset(reference.assetId, signal)
        : await admission.resolveManagedAsset(reference.assetId)
    } catch {
      signal?.throwIfAborted()
      return resourceIssue(
        reference,
        `The workspace image ${reference.assetId} could not be verified.`
      )
    }
    const managedStatus: unknown = asset?.status
    if (
      !asset ||
      asset.id !== reference.assetId ||
      (managedStatus !== "ready" && managedStatus !== "archived") ||
      (managedStatus === "ready" && !asset.selectable) ||
      (managedStatus === "archived" && asset.selectable)
    ) {
      return resourceIssue(
        reference,
        `The workspace image ${reference.assetId} is missing.`
      )
    }
  }
  return null
}

const compareText = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0

const localAliasOrder = (document: Document) =>
  [
    ...new Set(
      extractAssetReferences(document)
        .filter((reference) => reference.identity === "local")
        .map((reference) => localAssetIdFromSource(reference.source))
        .filter((assetId): assetId is string => assetId !== null)
    ),
  ].sort(compareText)

const chunked = <T>(values: readonly T[], size: number) => {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

async function mapWithConcurrency<T, TResult>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<TResult>
) {
  const results = new Array<TResult>(values.length)
  let cursor = 0
  let failureReason: unknown = null
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (failureReason === null) {
        const index = cursor
        cursor += 1
        if (index >= values.length) return
        try {
          results[index] = await operation(values[index], index)
        } catch (error) {
          failureReason = error
        }
      }
    }
  )
  await Promise.all(workers)
  if (failureReason !== null) throw failureReason
  return results
}

type ResolvedImportMappings = Readonly<{
  results: LocalAssetPromotionResolveResult["results"]
  requestIds: readonly string[]
}>

async function resolveImportMappings(
  assetIds: readonly string[],
  admission: DocumentImportResourceAdmission,
  signal?: AbortSignal
): Promise<ResolvedImportMappings> {
  const chunks = chunked(assetIds, 100)
  const resolved = await mapWithConcurrency(
    chunks,
    2,
    async (chunk): Promise<LocalAssetPromotionResolveResult> => {
      signal?.throwIfAborted()
      const response = signal
        ? await admission.resolveLocalPromotions(chunk, signal)
        : await admission.resolveLocalPromotions(chunk)
      signal?.throwIfAborted()
      const parsedRequestId = mediaRequestIdSchema.safeParse(response.requestId)
      const parsedResults = localAssetPromotionResolveResponseSchema.safeParse({
        results: response.results,
      })
      if (
        !parsedRequestId.success ||
        !parsedResults.success ||
        parsedResults.data.results.length !== chunk.length ||
        parsedResults.data.results.some(
          (result, index) =>
            result.localAssetId !== chunk[index] ||
            (result.promotion !== null &&
              result.promotion.localAssetId !== chunk[index])
        )
      ) {
        throw new Error("Invalid local media mapping response")
      }
      return {
        requestId: parsedRequestId.data,
        results: parsedResults.data.results,
      }
    }
  )
  return {
    results: resolved.flatMap((result) => result.results),
    requestIds: resolved.map((result) => result.requestId),
  }
}

const unavailableLocalStates = (count: number): LocalAssetAdmissionState[] =>
  Array.from({ length: count }, () => ({
    status: "unavailable" as const,
    code: "local_media_local_repository_unavailable",
    message: "Studio could not inspect saved images on this device.",
  }))

const localStateIsExact = (
  state: LocalAssetAdmissionState | undefined,
  assetId: string
) => {
  if (!state) return false
  if (state.status === "ready") {
    return (
      state.record.id === assetId &&
      state.record.integrity === "ready" &&
      state.record.blob instanceof Blob &&
      state.record.blob.size > 0 &&
      state.record.size === state.record.blob.size &&
      state.record.mediaType === state.record.blob.type
    )
  }
  if (state.status === "missing_bytes") {
    return state.summary.id === assetId && state.issue.assetId === assetId
  }
  if (state.status === "quarantined") {
    return state.issue.assetId === assetId
  }
  const terminalStatus: unknown = state.status
  return terminalStatus === "absent" || terminalStatus === "unavailable"
}

const factLocalState = (
  state: LocalAssetAdmissionState
): LocalMediaAdmissionFact["local"] => ({ status: state.status })

const recoveryStateFor = (
  outcome:
    "safe_migration" | LocalMediaAdmissionPlan["unresolved"][number]["outcome"],
  localStatus: LocalMediaAdmissionFact["local"]["status"],
  mappingStatus: LocalMediaAdmissionFact["mapping"]["status"]
): DocumentImportRecoveryState => {
  if (outcome === "safe_migration") {
    return mappingStatus === "archived" ? "studio_backup" : "studio_copy"
  }
  if (outcome === "identity_conflict") return "identity_conflict"
  if (outcome === "local_unavailable") return "device_status_unknown"
  if (outcome === "mapping_unavailable") return "backup_status_unknown"
  if (localStatus === "ready") return "on_device"
  return "file_missing"
}

const recoveryManifestFor = (
  document: Document,
  plan: LocalMediaAdmissionPlan
): DocumentImportRecoveryManifest => {
  const referencesByKey = new Map(
    extractAssetReferences(document).map((reference) => [
      reference.key,
      reference,
    ])
  )
  const entries = [
    ...plan.safeMigrations.map((migration) => ({
      ...migration,
      transformed: true,
      requiresChoice: false,
      mappingStatus: migration.managedStatus,
      managedAssetId: migration.managedAssetId,
    })),
    ...plan.unresolved.map((unresolved) => ({
      ...unresolved,
      transformed: false,
      requiresChoice:
        unresolved.outcome !== "local_only" &&
        unresolved.outcome !== "missing_unmapped",
      managedAssetId: unresolved.managedCandidate?.managedAssetId ?? null,
    })),
  ].sort((left, right) => compareText(left.localAssetId, right.localAssetId))

  const items = entries.map((entry): DocumentImportRecoveryItem => {
    const references = entry.expectedReferenceKeys
      .map((key) => referencesByKey.get(key))
      .filter((reference) => reference !== undefined)
    return {
      localAssetId: entry.localAssetId,
      state: recoveryStateFor(
        entry.outcome,
        entry.localStatus,
        entry.mappingStatus
      ),
      localStatus: entry.localStatus,
      mappingStatus: entry.mappingStatus,
      managedAssetId: entry.managedAssetId,
      transformed: entry.transformed,
      requiresChoice: entry.requiresChoice,
      expectedReferenceKeys: entry.expectedReferenceKeys,
      nodeIds: [
        ...new Set(
          references.flatMap((reference) =>
            reference.nodeId ? [reference.nodeId] : reference.projectedNodeIds
          )
        ),
      ].sort(compareText),
      fieldIds: [
        ...new Set(
          references.flatMap((reference) =>
            reference.fieldId ? [reference.fieldId] : []
          )
        ),
      ].sort(compareText),
      pageIds: [
        ...new Set(references.flatMap((reference) => reference.pageIds)),
      ].sort(compareText),
      outputIds: [
        ...new Set(references.flatMap((reference) => reference.outputIds)),
      ].sort(compareText),
    }
  })
  return {
    requiresReview: items.length > 0,
    aliasCount: items.length,
    transformedCount: items.filter((item) => item.transformed).length,
    unresolvedCount: items.filter((item) => !item.transformed).length,
    archivedBackupCount: items.filter((item) => item.state === "studio_backup")
      .length,
    items,
  }
}

const emptyRecoveryManifest = (): DocumentImportRecoveryManifest => ({
  requiresReview: false,
  aliasCount: 0,
  transformedCount: 0,
  unresolvedCount: 0,
  archivedBackupCount: 0,
  items: [],
})

type PlannedImportMedia = Readonly<{
  mediaPlan: DocumentImportMediaPlan
  candidateDocument: Document | null
  recoveryManifest: DocumentImportRecoveryManifest
}>

async function planDocumentImportMedia(
  document: Document,
  admission: DocumentImportResourceAdmission,
  signal?: AbortSignal
): Promise<PlannedImportMedia> {
  const assetIds = localAliasOrder(document)
  if (!assetIds.length) {
    return {
      mediaPlan: { status: "not_required", plan: null, mappingRequestIds: [] },
      candidateDocument: null,
      recoveryManifest: emptyRecoveryManifest(),
    }
  }
  if (assetIds.length > LOCAL_MEDIA_ADMISSION_ALIAS_LIMIT) {
    return {
      mediaPlan: {
        status: "alias_limit_exceeded",
        code: "local_media_alias_limit_exceeded",
        aliasCount: assetIds.length,
        plan: null,
        mappingRequestIds: [],
      },
      candidateDocument: null,
      recoveryManifest: {
        ...emptyRecoveryManifest(),
        requiresReview: true,
        aliasCount: assetIds.length,
        unresolvedCount: assetIds.length,
      },
    }
  }

  signal?.throwIfAborted()
  let localStates: readonly LocalAssetAdmissionState[]
  try {
    localStates = signal
      ? await admission.inspectLocalAssets(assetIds, signal)
      : await admission.inspectLocalAssets(assetIds)
    signal?.throwIfAborted()
    if (
      localStates.length !== assetIds.length ||
      localStates.some(
        (state, index) => !localStateIsExact(state, assetIds[index])
      )
    ) {
      localStates = unavailableLocalStates(assetIds.length)
    }
  } catch {
    signal?.throwIfAborted()
    localStates = unavailableLocalStates(assetIds.length)
  }

  let mappings: ResolvedImportMappings | null = null
  try {
    mappings = await resolveImportMappings(assetIds, admission, signal)
  } catch {
    signal?.throwIfAborted()
  }

  const facts = await mapWithConcurrency(
    assetIds,
    2,
    async (assetId, index) => {
      signal?.throwIfAborted()
      const localState = localStates[index]
      const promotion = mappings?.results[index]?.promotion ?? null
      const mapping = mappings
        ? promotion
          ? {
              status: promotion.asset.status,
              managedAssetId: promotion.asset.id,
              managedSource: managedAssetSource(promotion.asset.id),
              contentSha256: promotion.contentSha256,
            }
          : { status: "unmapped" as const }
        : { status: "unavailable" as const }
      if (
        localState.status !== "ready" ||
        (mapping.status !== "ready" && mapping.status !== "archived")
      ) {
        return {
          localAssetId: assetId,
          local: factLocalState(localState),
          mapping,
        } satisfies LocalMediaAdmissionFact
      }
      try {
        const localContentSha256 = signal
          ? await admission.hashLocalAsset(localState.record.blob, signal)
          : await admission.hashLocalAsset(localState.record.blob)
        signal?.throwIfAborted()
        if (!/^[a-f0-9]{64}$/.test(localContentSha256)) {
          throw new Error("Invalid local content hash")
        }
        return {
          localAssetId: assetId,
          local: factLocalState(localState),
          mapping,
          localContentSha256,
        } satisfies LocalMediaAdmissionFact
      } catch {
        signal?.throwIfAborted()
        return {
          localAssetId: assetId,
          local: { status: "unavailable" as const },
          mapping,
        } satisfies LocalMediaAdmissionFact
      }
    }
  )

  const planned = planLocalMediaAdmission(document, facts)
  if (!planned.ok) {
    throw new Error(`Document media planning failed: ${planned.reason}`)
  }
  const applied = applyLocalMediaAdmissionPlan(document, planned.plan, {
    operationId: "document-import-plan",
    at: new Date().toISOString(),
  })
  if (!applied.ok) {
    throw new Error(`Document media candidate failed: ${applied.reason}`)
  }
  return {
    mediaPlan: {
      status: "planned",
      plan: planned.plan,
      mappingRequestIds: mappings?.requestIds ?? [],
    },
    candidateDocument: applied.status === "applied" ? applied.document : null,
    recoveryManifest: recoveryManifestFor(document, planned.plan),
  }
}

/**
 * Parses and validates a Studio document without installing a session or
 * writing a draft. Managed identities must be verifiable. Local identities are
 * instead projected into an explicit recovery plan: exact mappings may form an
 * isolated candidate, while missing, conflicting, or unknown resources remain
 * unchanged for later user review. Workspace bytes are still verified at the
 * authenticated renderer boundary. Remote sources and unmanaged fonts fail
 * here instead of producing a document that cannot render deterministically.
 */
export async function parseDocumentImportFile(
  file: DocumentImportFile,
  resourceAdmission: DocumentImportResourceAdmission = defaultResourceAdmission,
  options: Readonly<{ signal?: AbortSignal }> = {}
): Promise<DocumentImportResult> {
  let raw: string
  try {
    raw = await readBoundedDocumentImportText(file, options.signal)
  } catch (error) {
    options.signal?.throwIfAborted()
    if (error instanceof DocumentImportReadError) {
      return failure(error.kind, error.message)
    }
    return failure(
      "file_read_failed",
      "The selected document file could not be read."
    )
  }

  options.signal?.throwIfAborted()
  let input: unknown
  try {
    input = JSON.parse(raw) as unknown
  } catch {
    return failure("malformed_json", "The selected file is not valid JSON.")
  }

  let decoded: ReturnType<typeof decodeDocument>
  try {
    options.signal?.throwIfAborted()
    decoded = decodeDocument(input)
  } catch (error) {
    if (error instanceof DocumentMigrationError) {
      return failure("migration_failed", error.message)
    }
    if (error instanceof DocumentValidationError) {
      const issue = firstBlockingIssue(error.issues) ?? error.issues[0]
      return failure("aggregate_invalid", issue.message, issue)
    }
    return failure(
      "schema_invalid",
      "The JSON does not match a supported Studio document schema."
    )
  }

  const aggregateIssue = firstBlockingIssue(validateDocument(decoded.document))
  if (aggregateIssue) {
    return failure("aggregate_invalid", aggregateIssue.message, aggregateIssue)
  }

  const policyIssues = validateRenderPolicy(decoded.document).filter(
    (issue) =>
      issue.severity === "error" &&
      !isRepositoryImageIssue(decoded.document, issue)
  )
  const renderIssue = policyIssues.find(
    (issue) => !isEditableResourceIssue(issue)
  )
  if (renderIssue) {
    return failure("render_policy_failed", renderIssue.message, renderIssue)
  }
  const editableResourceIssue = policyIssues.find(isEditableResourceIssue)
  if (editableResourceIssue) {
    return failure(
      "resource_policy_failed",
      editableResourceIssue.message,
      editableResourceIssue
    )
  }

  const unavailableResource = await admitManagedDocumentResources(
    decoded.document,
    resourceAdmission,
    options.signal
  )
  if (unavailableResource) {
    return failure(
      "resource_policy_failed",
      unavailableResource.message,
      unavailableResource
    )
  }

  let media: PlannedImportMedia
  try {
    media = await planDocumentImportMedia(
      decoded.document,
      resourceAdmission,
      options.signal
    )
  } catch (error) {
    options.signal?.throwIfAborted()
    return failure(
      "resource_policy_failed",
      error instanceof Error
        ? error.message
        : "Studio could not plan the imported document images.",
      {
        id: "document-import:media-plan",
        severity: "error",
        code: "invalid_asset",
        message: "Studio could not safely plan the imported document images.",
      }
    )
  }

  return {
    ok: true,
    document: decoded.document,
    migrations: decoded.migrations,
    ...media,
  }
}
