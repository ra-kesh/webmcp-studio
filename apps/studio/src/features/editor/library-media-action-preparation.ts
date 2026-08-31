import {
  curatedAssetIdentityFromSource,
  libraryMediaDetailSchema,
  localAssetSource,
  managedAssetSource,
} from "@webmcp/document"
import type {
  LibraryMediaDetail,
  LibraryProvenance,
  MediaAssetLookup,
} from "@webmcp/document"
import type {
  DeviceLocalMediaSelectionIdentity,
  ExactDeviceLocalMediaSelection,
} from "../../content/library/device-local-media-discovery-adapter"
import type {
  CuratedMediaIdentity,
  VerifiedCuratedMediaContent,
} from "../../content/library/media/curated-media-content"
import type { VerifiedManagedBrowserImageResource } from "./managed-image-resource"
import type { ReusableImageAsset } from "./media-selection-model"

export type LibraryMediaActionTarget =
  | Readonly<{ type: "insert"; pageId: string }>
  | Readonly<{ type: "replace"; pageId: string; nodeId: string }>
  | Readonly<{ type: "assign_field"; fieldId: string }>

export type LibraryMediaActionPreparationRequest = Readonly<{
  correlationId: string
  detail: LibraryMediaDetail
  target: LibraryMediaActionTarget
}>

export type LibraryMediaActionPreparationPorts = Readonly<{
  getExactDetail: (
    assetId: string,
    version: number,
    signal: AbortSignal
  ) => Promise<LibraryMediaDetail>
  resolveCurated: (
    identity: CuratedMediaIdentity,
    signal: AbortSignal
  ) => Promise<VerifiedCuratedMediaContent>
  getManagedRecord: (
    assetId: string,
    signal: AbortSignal
  ) => Promise<MediaAssetLookup | null>
  verifyManagedResource: (
    record: MediaAssetLookup,
    signal: AbortSignal
  ) => Promise<VerifiedManagedBrowserImageResource>
  recheckLocal: (
    identity: DeviceLocalMediaSelectionIdentity,
    signal: AbortSignal
  ) => Promise<ExactDeviceLocalMediaSelection>
}>

type PreparedCommon = Readonly<{
  correlationId: string
  target: LibraryMediaActionTarget
  requestedDetail: LibraryMediaDetail
  exactDetail: LibraryMediaDetail
  asset: ReusableImageAsset
  mimeType: LibraryMediaDetail["summary"]["mimeType"]
  bytes: number
  provenance: LibraryProvenance
}>

export type PreparedCuratedLibraryMedia = PreparedCommon &
  Readonly<{
    source: "curated"
    catalogVersion: number
    contentHash: string
    rendererPreviewSource: string
  }>

export type PreparedManagedLibraryMedia = PreparedCommon &
  Readonly<{
    source: "managed"
    catalogVersion: number
    contentHash: string
  }>

export type PreparedLocalLibraryMedia = PreparedCommon &
  Readonly<{
    source: "local"
    revision: number
    previewBlob: Blob
  }>

export type PreparedLibraryMediaAction =
  | PreparedCuratedLibraryMedia
  | PreparedManagedLibraryMedia
  | PreparedLocalLibraryMedia

export type LibraryMediaActionPreparationErrorCode =
  | "preparation_request_invalid"
  | "preparation_action_unavailable"
  | "preparation_exact_detail_mismatch"
  | "preparation_curated_content_mismatch"
  | "preparation_managed_record_unavailable"
  | "preparation_managed_record_mismatch"
  | "preparation_managed_resource_mismatch"
  | "preparation_local_record_mismatch"

export class LibraryMediaActionPreparationError extends Error {
  constructor(
    readonly code: LibraryMediaActionPreparationErrorCode,
    message: string
  ) {
    super(message)
    this.name = "LibraryMediaActionPreparationError"
  }
}

const preparationError = (
  code: LibraryMediaActionPreparationErrorCode,
  message: string
) => new LibraryMediaActionPreparationError(code, message)

const immutable = <TValue>(value: TValue): TValue => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) immutable(child)
  }
  return value
}

const correlationPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

const parseTarget = (
  target: LibraryMediaActionTarget
): LibraryMediaActionTarget => {
  const validId = (value: unknown) =>
    typeof value === "string" && value.trim().length > 0
  if (target.type === "insert" && validId(target.pageId)) {
    return Object.freeze({ type: target.type, pageId: target.pageId })
  }
  if (
    target.type === "replace" &&
    validId(target.pageId) &&
    validId(target.nodeId)
  ) {
    return Object.freeze({
      type: target.type,
      pageId: target.pageId,
      nodeId: target.nodeId,
    })
  }
  if (target.type === "assign_field" && validId(target.fieldId)) {
    return Object.freeze({ type: target.type, fieldId: target.fieldId })
  }
  throw preparationError(
    "preparation_request_invalid",
    "Exact media preparation requires a valid action target."
  )
}

const sameProvenance = (left: LibraryProvenance, right: LibraryProvenance) =>
  left.sourceName === right.sourceName &&
  left.sourceUrl === right.sourceUrl &&
  left.license.id === right.license.id &&
  left.license.name === right.license.name &&
  left.license.url === right.license.url &&
  left.attribution.required === right.attribution.required &&
  left.attribution.text === right.attribution.text &&
  left.contentSha256 === right.contentSha256

const sameContentMetadata = (
  left: LibraryMediaDetail,
  right: LibraryMediaDetail
) =>
  left.summary.id === right.summary.id &&
  left.summary.version === right.summary.version &&
  left.summary.mediaSource === right.summary.mediaSource &&
  left.summary.mimeType === right.summary.mimeType &&
  left.summary.bytes === right.summary.bytes &&
  left.summary.dimensions.width === right.summary.dimensions.width &&
  left.summary.dimensions.height === right.summary.dimensions.height &&
  sameProvenance(left.summary.provenance, right.summary.provenance)

const assertExactDetail = (
  requested: LibraryMediaDetail,
  exactInput: LibraryMediaDetail
) => {
  const parsed = libraryMediaDetailSchema.safeParse(structuredClone(exactInput))
  if (!parsed.success || !sameContentMetadata(requested, parsed.data)) {
    throw preparationError(
      "preparation_exact_detail_mismatch",
      "The exact media catalog detail no longer matches the selected identity."
    )
  }
  return immutable(parsed.data)
}

const assertUsable = (
  detail: LibraryMediaDetail,
  target: LibraryMediaActionTarget
) => {
  const summary = detail.summary
  if (
    !summary.selectable ||
    !summary.permissions.canUse ||
    summary.catalogStatus !== "active" ||
    summary.compatibility.availability !== "available" ||
    !summary.compatibility.supportedActions.includes(target.type)
  ) {
    throw preparationError(
      "preparation_action_unavailable",
      "The selected media is not available for this action."
    )
  }
}

const assetFor = (
  detail: LibraryMediaDetail,
  src: string
): ReusableImageAsset => ({
  assetId: detail.summary.id,
  name: detail.summary.name,
  description: detail.summary.description,
  src,
  width: detail.summary.dimensions.width,
  height: detail.summary.dimensions.height,
})

const commonFor = (
  request: LibraryMediaActionPreparationRequest,
  target: LibraryMediaActionTarget,
  requestedDetail: LibraryMediaDetail,
  exactDetail: LibraryMediaDetail,
  asset: ReusableImageAsset
): PreparedCommon => ({
  correlationId: request.correlationId,
  target,
  requestedDetail,
  exactDetail,
  asset: Object.freeze(asset),
  mimeType: exactDetail.summary.mimeType,
  bytes: exactDetail.summary.bytes,
  provenance: exactDetail.summary.provenance,
})

const prepareCurated = async (
  request: LibraryMediaActionPreparationRequest,
  target: LibraryMediaActionTarget,
  requested: LibraryMediaDetail,
  ports: LibraryMediaActionPreparationPorts,
  signal: AbortSignal
): Promise<PreparedCuratedLibraryMedia> => {
  const identity = requested.selectionIdentity
  if (identity.source !== "curated") {
    throw preparationError(
      "preparation_request_invalid",
      "Curated preparation requires a curated selection identity."
    )
  }
  const exact = assertExactDetail(
    requested,
    await ports.getExactDetail(identity.assetId, identity.version, signal)
  )
  signal.throwIfAborted()
  assertUsable(exact, target)
  const requestedHash = exact.summary.provenance.contentSha256
  if (!requestedHash) {
    throw preparationError(
      "preparation_curated_content_mismatch",
      "Curated media requires an immutable content hash."
    )
  }
  const content = await ports.resolveCurated(
    {
      assetId: identity.assetId,
      version: identity.version,
      contentSha256: requestedHash,
    },
    signal
  )
  signal.throwIfAborted()
  const canonicalIdentity = curatedAssetIdentityFromSource(
    content.canonicalSource
  )
  if (
    content.identity.assetId !== identity.assetId ||
    content.identity.version !== identity.version ||
    content.identity.contentSha256 !== requestedHash ||
    content.item.id !== identity.assetId ||
    content.item.version !== identity.version ||
    content.item.contentSha256 !== requestedHash ||
    content.item.mimeType !== exact.summary.mimeType ||
    content.item.bytes !== exact.summary.bytes ||
    content.item.width !== exact.summary.dimensions.width ||
    content.item.height !== exact.summary.dimensions.height ||
    content.bytes.byteLength !== exact.summary.bytes ||
    content.canonicalSource !== content.item.resourcePath ||
    canonicalIdentity?.assetId !== identity.assetId ||
    canonicalIdentity.version !== identity.version ||
    canonicalIdentity.contentSha256 !== requestedHash ||
    !sameProvenance(content.item.provenance, exact.summary.provenance)
  ) {
    throw preparationError(
      "preparation_curated_content_mismatch",
      "Resolved curated content did not match its exact catalog identity."
    )
  }
  return Object.freeze({
    ...commonFor(
      request,
      target,
      requested,
      exact,
      assetFor(exact, content.canonicalSource)
    ),
    source: "curated",
    catalogVersion: identity.version,
    contentHash: requestedHash,
    rendererPreviewSource: content.src,
  })
}

const prepareManaged = async (
  request: LibraryMediaActionPreparationRequest,
  target: LibraryMediaActionTarget,
  requested: LibraryMediaDetail,
  ports: LibraryMediaActionPreparationPorts,
  signal: AbortSignal
): Promise<PreparedManagedLibraryMedia> => {
  const identity = requested.selectionIdentity
  if (identity.source !== "managed") {
    throw preparationError(
      "preparation_request_invalid",
      "Managed preparation requires a managed selection identity."
    )
  }
  const version = requested.summary.version
  const exact = assertExactDetail(
    requested,
    await ports.getExactDetail(identity.assetId, version, signal)
  )
  signal.throwIfAborted()
  assertUsable(exact, target)
  if (
    exact.summary.mediaSource !== "managed" ||
    exact.summary.owner.kind !== "workspace"
  ) {
    throw preparationError(
      "preparation_exact_detail_mismatch",
      "Managed media must resolve through the active workspace catalog."
    )
  }
  const record = await ports.getManagedRecord(identity.assetId, signal)
  signal.throwIfAborted()
  if (!record || record.status !== "ready" || !record.selectable) {
    throw preparationError(
      "preparation_managed_record_unavailable",
      "The selected workspace media is no longer ready."
    )
  }
  if (
    record.id !== identity.assetId ||
    record.mediaType !== exact.summary.mimeType ||
    record.bytes !== exact.summary.bytes ||
    record.width !== exact.summary.dimensions.width ||
    record.height !== exact.summary.dimensions.height
  ) {
    throw preparationError(
      "preparation_managed_record_mismatch",
      "The workspace media repository no longer matches the exact catalog detail."
    )
  }
  const resource = await ports.verifyManagedResource(record, signal)
  signal.throwIfAborted()
  const canonicalSource = managedAssetSource(identity.assetId)
  if (
    resource.assetId !== identity.assetId ||
    resource.src !== canonicalSource ||
    resource.width !== record.width ||
    resource.height !== record.height ||
    !/^[a-f0-9]{64}$/.test(resource.contentHash)
  ) {
    throw preparationError(
      "preparation_managed_resource_mismatch",
      "The verified workspace image resource did not match its repository record."
    )
  }
  return Object.freeze({
    ...commonFor(
      request,
      target,
      requested,
      exact,
      assetFor(exact, canonicalSource)
    ),
    source: "managed",
    catalogVersion: version,
    contentHash: resource.contentHash,
  })
}

const prepareLocal = async (
  request: LibraryMediaActionPreparationRequest,
  target: LibraryMediaActionTarget,
  requested: LibraryMediaDetail,
  ports: LibraryMediaActionPreparationPorts,
  signal: AbortSignal
): Promise<PreparedLocalLibraryMedia> => {
  const identity = requested.selectionIdentity
  if (identity.source !== "local") {
    throw preparationError(
      "preparation_request_invalid",
      "Device-local preparation requires a local selection identity."
    )
  }
  const selection = await ports.recheckLocal(identity, signal)
  signal.throwIfAborted()
  const exact = assertExactDetail(requested, selection.detail)
  assertUsable(exact, target)
  const record = selection.record
  if (
    record.id !== identity.assetId ||
    record.revision !== identity.revision ||
    record.integrity !== "ready" ||
    record.archivedAt !== null ||
    record.mediaType !== exact.summary.mimeType ||
    record.size !== exact.summary.bytes ||
    record.width !== exact.summary.dimensions.width ||
    record.height !== exact.summary.dimensions.height ||
    record.blob.type !== exact.summary.mimeType ||
    record.blob.size !== exact.summary.bytes
  ) {
    throw preparationError(
      "preparation_local_record_mismatch",
      "The exact device-local record no longer matches the selected revision."
    )
  }
  return Object.freeze({
    ...commonFor(
      request,
      target,
      requested,
      exact,
      assetFor(exact, localAssetSource(identity.assetId))
    ),
    source: "local",
    revision: identity.revision,
    previewBlob: record.blob,
  })
}

export async function prepareExactLibraryMediaAction(
  request: LibraryMediaActionPreparationRequest,
  ports: LibraryMediaActionPreparationPorts,
  signal: AbortSignal
): Promise<PreparedLibraryMediaAction> {
  signal.throwIfAborted()
  if (!correlationPattern.test(request.correlationId)) {
    throw preparationError(
      "preparation_request_invalid",
      "Exact media preparation requires a valid correlation identity."
    )
  }
  const target = parseTarget(request.target)
  const requestedResult = libraryMediaDetailSchema.safeParse(
    structuredClone(request.detail)
  )
  if (!requestedResult.success) {
    throw preparationError(
      "preparation_request_invalid",
      "Exact media preparation requires a valid selected media detail."
    )
  }
  const requested = immutable(requestedResult.data)
  assertUsable(requested, target)
  switch (requested.selectionIdentity.source) {
    case "curated":
      return prepareCurated(request, target, requested, ports, signal)
    case "managed":
      return prepareManaged(request, target, requested, ports, signal)
    case "local":
      return prepareLocal(request, target, requested, ports, signal)
  }
}
