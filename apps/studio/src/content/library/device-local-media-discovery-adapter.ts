import {
  localAssetIdSchema,
  projectLocalMediaDetail,
  projectLocalMediaSummary,
} from "@webmcp/document"
import type {
  LibraryMediaDetail,
  LibraryMediaSummary,
  LocalLibraryMediaMetadata,
} from "@webmcp/document"
import {
  getLocalAssetMetadataSummary,
  inspectRequestedLocalAssets,
  listLocalAssetMetadataInventory,
} from "../../features/editor/local-asset-store"
import type {
  LocalAssetAdmissionState,
  LocalAssetIntegrityIssue,
  LocalAssetMetadataInventory,
  LocalAssetRecord,
  LocalAssetSummary,
} from "../../features/editor/local-asset-store"

const DEVICE_LOCAL_MEDIA_METADATA: LocalLibraryMediaMetadata = {
  description: "Customer-provided image stored only on this device",
  categoryId: "workspace-upload",
  useCaseIds: [],
  formatFamily: "raster",
  tags: ["device-local", "upload"],
  permissions: {
    canView: true,
    canUse: true,
    canFavorite: false,
    canAddToCollection: false,
  },
  provenance: {
    sourceName: "Device-local upload",
    sourceUrl: null,
    license: {
      id: "customer-provided",
      name: "Customer-provided; rights not verified",
      url: null,
    },
    attribution: { required: false, text: null },
    contentSha256: null,
  },
}

export const DEVICE_LOCAL_MEDIA_DISCOVERY_LIMIT = 1_000

export type DeviceLocalMediaSelectionIdentity = Extract<
  LibraryMediaDetail["selectionIdentity"],
  { source: "local" }
>

export type ExactDeviceLocalMediaSelection = Readonly<{
  detail: LibraryMediaDetail
  record: LocalAssetRecord
}>

export type DeviceLocalMediaDiscoveryStatus = Readonly<{
  schemaVersion: 1
  databaseVersion: number
  migrationState: LocalAssetMetadataInventory["migrationState"]
  legacyRecordCount: number
  legacyMetadataRecordCount: number
  metadataRecordCount: number
  examinedMetadataCount: number
  unindexedMetadataCount: number
  projectedItemCount: number
  archivedRecordCount: number
  unavailableRecordCount: number
  truncated: boolean
  issues: readonly LocalAssetIntegrityIssue[]
}>

export type DeviceLocalMediaDiscoveryResult = Readonly<{
  items: readonly LibraryMediaSummary[]
  status: DeviceLocalMediaDiscoveryStatus
}>

export type DeviceLocalMediaDiscoveryDependencies = Readonly<{
  listMetadataInventory: typeof listLocalAssetMetadataInventory
  getMetadataSummary: typeof getLocalAssetMetadataSummary
  inspectRequested: typeof inspectRequestedLocalAssets
}>

export type DeviceLocalMediaDiscoveryAdapter = Readonly<{
  list: (signal?: AbortSignal) => Promise<DeviceLocalMediaDiscoveryResult>
  getDetail: (
    assetId: string,
    revision: number,
    signal?: AbortSignal
  ) => Promise<LibraryMediaDetail>
  recheckSelection: (
    identity: DeviceLocalMediaSelectionIdentity,
    signal?: AbortSignal
  ) => Promise<ExactDeviceLocalMediaSelection>
}>

export type DeviceLocalMediaDiscoveryErrorCode =
  | "local_media_absent"
  | "local_media_archived"
  | "local_media_identity_invalid"
  | "local_media_integrity_unavailable"
  | "local_media_missing_bytes"
  | "local_media_quarantined"
  | "local_media_repository_changed"
  | "local_media_repository_unavailable"
  | "local_media_revision_mismatch"

export class DeviceLocalMediaDiscoveryError extends Error {
  constructor(
    readonly code: DeviceLocalMediaDiscoveryErrorCode,
    message: string
  ) {
    super(message)
    this.name = "DeviceLocalMediaDiscoveryError"
  }
}

const projectable = (
  asset: LocalAssetMetadataInventory["assets"][number]
): asset is LocalAssetMetadataInventory["assets"][number] & {
  width: number
  height: number
  integrity: "ready"
} =>
  asset.integrity === "ready" &&
  asset.archivedAt === null &&
  Number.isSafeInteger(asset.width) &&
  (asset.width ?? 0) > 0 &&
  Number.isSafeInteger(asset.height) &&
  (asset.height ?? 0) > 0

/**
 * Projects current, schema-valid metadata without adding a portable device
 * claim to the server catalog. Exact selection still rechecks bytes, integrity,
 * archive state and revision through inspectRequestedLocalAssets.
 */
export function projectDeviceLocalMediaInventory(
  inventory: LocalAssetMetadataInventory
): DeviceLocalMediaDiscoveryResult {
  const scannedAssets = inventory.assets.slice(
    0,
    DEVICE_LOCAL_MEDIA_DISCOVERY_LIMIT
  )
  const archivedRecordCount = scannedAssets.filter(
    (asset) => asset.archivedAt !== null
  ).length
  const unavailableRecordCount = scannedAssets.filter(
    (asset) => asset.archivedAt === null && !projectable(asset)
  ).length
  const items = scannedAssets
    .filter(projectable)
    .map((asset) =>
      projectLocalMediaSummary(asset, DEVICE_LOCAL_MEDIA_METADATA)
    )
  return Object.freeze({
    items,
    status: Object.freeze({
      schemaVersion: 1,
      databaseVersion: inventory.databaseVersion,
      migrationState: inventory.migrationState,
      legacyRecordCount: inventory.legacyRecordCount,
      legacyMetadataRecordCount: inventory.legacyMetadataRecordCount,
      metadataRecordCount: inventory.metadataRecordCount,
      examinedMetadataCount: inventory.examinedMetadataCount,
      unindexedMetadataCount: inventory.unindexedMetadataCount,
      projectedItemCount: items.length,
      archivedRecordCount,
      unavailableRecordCount,
      truncated: inventory.truncated,
      issues: Object.freeze([...inventory.issues]),
    }),
  })
}

const errorForAdmissionState = (
  assetId: string,
  state: Exclude<LocalAssetAdmissionState, { status: "ready" }>
) => {
  switch (state.status) {
    case "absent":
      return new DeviceLocalMediaDiscoveryError(
        "local_media_absent",
        `Local media ${assetId} is not available in this browser profile`
      )
    case "missing_bytes":
      return new DeviceLocalMediaDiscoveryError(
        "local_media_missing_bytes",
        `Local media ${assetId} has no verified bytes on this device`
      )
    case "quarantined":
      return new DeviceLocalMediaDiscoveryError(
        "local_media_quarantined",
        `Local media ${assetId} is quarantined on this device`
      )
    case "unavailable":
      return new DeviceLocalMediaDiscoveryError(
        state.code === "local_media_local_repository_changed"
          ? "local_media_repository_changed"
          : "local_media_repository_unavailable",
        state.message
      )
  }
}

const defaultDependencies: DeviceLocalMediaDiscoveryDependencies = {
  listMetadataInventory: listLocalAssetMetadataInventory,
  getMetadataSummary: getLocalAssetMetadataSummary,
  inspectRequested: inspectRequestedLocalAssets,
}

const parseSelectionIdentity = (
  assetIdInput: string,
  revisionInput: number
) => {
  const assetId = localAssetIdSchema.safeParse(assetIdInput)
  if (
    !assetId.success ||
    !Number.isSafeInteger(revisionInput) ||
    revisionInput < 1
  ) {
    throw new DeviceLocalMediaDiscoveryError(
      "local_media_identity_invalid",
      "Device-local media selection requires an exact local asset ID and positive revision"
    )
  }
  return { assetId: assetId.data, revision: revisionInput }
}

const detailForMetadata = (
  expected: { assetId: string; revision: number },
  summary: LocalAssetSummary | null
) => {
  if (!summary) {
    throw new DeviceLocalMediaDiscoveryError(
      "local_media_absent",
      `Local media ${expected.assetId} is not available in this browser profile`
    )
  }
  if (summary.id !== expected.assetId) {
    throw new DeviceLocalMediaDiscoveryError(
      "local_media_integrity_unavailable",
      `Local media ${expected.assetId} did not resolve to its exact metadata record`
    )
  }
  if (summary.archivedAt !== null) {
    throw new DeviceLocalMediaDiscoveryError(
      "local_media_archived",
      `Local media ${expected.assetId} is archived`
    )
  }
  if (summary.revision !== expected.revision) {
    throw new DeviceLocalMediaDiscoveryError(
      "local_media_revision_mismatch",
      `Local media ${expected.assetId} changed from revision ${expected.revision} to ${summary.revision}`
    )
  }
  if (summary.integrity !== "ready") {
    throw new DeviceLocalMediaDiscoveryError(
      "local_media_missing_bytes",
      `Local media ${expected.assetId} has no verified bytes on this device`
    )
  }
  if (!projectable(summary)) {
    throw new DeviceLocalMediaDiscoveryError(
      "local_media_integrity_unavailable",
      `Local media ${expected.assetId} has incomplete image metadata`
    )
  }
  return projectLocalMediaDetail(summary, DEVICE_LOCAL_MEDIA_METADATA)
}

export function createDeviceLocalMediaDiscoveryAdapter(
  dependencies: DeviceLocalMediaDiscoveryDependencies = defaultDependencies
): DeviceLocalMediaDiscoveryAdapter {
  const recheckSelection = async (
    identity: DeviceLocalMediaSelectionIdentity,
    signal?: AbortSignal
  ): Promise<ExactDeviceLocalMediaSelection> => {
    signal?.throwIfAborted()
    const expected = parseSelectionIdentity(identity.assetId, identity.revision)
    const states = await dependencies.inspectRequested(
      [expected.assetId],
      signal ? { signal } : undefined
    )
    signal?.throwIfAborted()
    const state = states.length === 1 ? states[0] : undefined
    if (!state) {
      throw new DeviceLocalMediaDiscoveryError(
        "local_media_integrity_unavailable",
        `Local media ${expected.assetId} could not be verified exactly`
      )
    }
    if (state.status !== "ready") {
      throw errorForAdmissionState(expected.assetId, state)
    }
    if (
      state.record.id !== expected.assetId ||
      state.record.integrity !== "ready"
    ) {
      throw new DeviceLocalMediaDiscoveryError(
        "local_media_integrity_unavailable",
        `Local media ${expected.assetId} did not resolve to its exact ready device record`
      )
    }
    if (state.record.archivedAt !== null) {
      throw new DeviceLocalMediaDiscoveryError(
        "local_media_archived",
        `Local media ${expected.assetId} is archived`
      )
    }
    if (state.record.revision !== expected.revision) {
      throw new DeviceLocalMediaDiscoveryError(
        "local_media_revision_mismatch",
        `Local media ${expected.assetId} changed from revision ${expected.revision} to ${state.record.revision}`
      )
    }
    const detail = projectLocalMediaDetail(
      state.record,
      DEVICE_LOCAL_MEDIA_METADATA
    )
    return Object.freeze({ detail, record: state.record })
  }

  return Object.freeze({
    async list(signal?: AbortSignal) {
      signal?.throwIfAborted()
      const inventory = await dependencies.listMetadataInventory({
        includeArchived: true,
        limit: DEVICE_LOCAL_MEDIA_DISCOVERY_LIMIT,
        ...(signal ? { signal } : {}),
      })
      signal?.throwIfAborted()
      return projectDeviceLocalMediaInventory(inventory)
    },
    async getDetail(assetId, revision, signal) {
      signal?.throwIfAborted()
      const expected = parseSelectionIdentity(assetId, revision)
      const summary = await dependencies.getMetadataSummary(
        expected.assetId,
        signal
      )
      signal?.throwIfAborted()
      return detailForMetadata(expected, summary)
    },
    recheckSelection,
  })
}

export const deviceLocalMediaDiscoveryAdapter =
  createDeviceLocalMediaDiscoveryAdapter()
