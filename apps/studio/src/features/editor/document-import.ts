import {
  DocumentMigrationError,
  DocumentValidationError,
  decodeDocument,
  validateDocument,
  validateRenderPolicy,
} from "@webmcp/document"
import type {
  Document,
  DocumentMigration,
  MediaAssetLookup,
  ValidationIssue,
} from "@webmcp/document"
import {
  getLocalAssetRecord,
  localAssetIdFromSource,
} from "./local-asset-store"
import type { LocalAssetRecord } from "./local-asset-store"
import {
  getManagedMedia,
  managedMediaIdFromSource,
} from "./managed-media-repository"
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
    }>
  | Readonly<{
      ok: false
      failure: DocumentImportFailure
    }>

export type DocumentImportLocalAsset = Pick<
  LocalAssetRecord,
  "id" | "blob" | "mediaType" | "size" | "integrity"
>

export type DocumentImportManagedAsset = Pick<
  MediaAssetLookup,
  "id" | "status" | "selectable"
>

/**
 * Repository reads are injected so parsing and resource admission remain
 * deterministic in tests. Production defaults resolve the exact local
 * IndexedDB record and authenticated workspace-media lookup.
 */
export type DocumentImportResourceAdmission = Readonly<{
  resolveLocalAsset: (
    assetId: string,
    signal?: AbortSignal
  ) => Promise<DocumentImportLocalAsset | null>
  resolveManagedAsset: (
    assetId: string,
    signal?: AbortSignal
  ) => Promise<DocumentImportManagedAsset | null>
}>

const defaultResourceAdmission: DocumentImportResourceAdmission = {
  resolveLocalAsset: getLocalAssetRecord,
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
  kind: "local" | "managed"
  assetId: string
  nodeId?: string
}>

const assetReferenceFromSource = (
  source: string,
  nodeId?: string
): DocumentAssetReference | null => {
  const localAssetId = localAssetIdFromSource(source)
  if (localAssetId && /^[A-Za-z0-9._:-]+$/.test(localAssetId)) {
    return {
      kind: "local",
      assetId: localAssetId,
      ...(nodeId ? { nodeId } : {}),
    }
  }
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
  return node?.type === "image" && assetReferenceFromSource(node.src) !== null
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

const localAssetIsReadable = (
  asset: DocumentImportLocalAsset | null,
  expectedAssetId: string
) =>
  asset !== null &&
  asset.id === expectedAssetId &&
  asset.integrity === "ready" &&
  asset.blob instanceof Blob &&
  asset.blob.size > 0 &&
  asset.size === asset.blob.size &&
  asset.mediaType === asset.blob.type

const admitDocumentResources = async (
  document: Document,
  admission: DocumentImportResourceAdmission,
  signal?: AbortSignal
): Promise<ValidationIssue | null> => {
  for (const reference of referencedDocumentAssets(document)) {
    signal?.throwIfAborted()
    if (reference.kind === "local") {
      let asset: DocumentImportLocalAsset | null
      try {
        asset = signal
          ? await admission.resolveLocalAsset(reference.assetId, signal)
          : await admission.resolveLocalAsset(reference.assetId)
      } catch {
        signal?.throwIfAborted()
        return resourceIssue(
          reference,
          `The local image ${reference.assetId} could not be read from this browser.`
        )
      }
      if (!localAssetIsReadable(asset, reference.assetId)) {
        return resourceIssue(
          reference,
          `The local image ${reference.assetId} is missing or unreadable in this browser.`
        )
      }
      continue
    }

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
    if (!asset || asset.id !== reference.assetId) {
      return resourceIssue(
        reference,
        `The workspace image ${reference.assetId} is missing.`
      )
    }
  }
  return null
}

/**
 * Parses and admits a Studio document without installing a session or writing
 * storage. Exact local and workspace image identities are admitted against
 * their repositories before install. Workspace bytes are still verified at
 * the authenticated renderer boundary. Remote image sources and unmanaged
 * fonts fail here instead of producing a document that cannot be rendered
 * deterministically.
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

  const unavailableResource = await admitDocumentResources(
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

  return {
    ok: true,
    document: decoded.document,
    migrations: decoded.migrations,
  }
}
