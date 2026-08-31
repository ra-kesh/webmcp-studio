import type { ReactNode } from "react"
import {
  libraryCatalogPageSchema,
  projectCuratedMediaDetail,
  projectCuratedMediaSummary,
  projectLocalMediaDetail,
  projectLocalMediaSummary,
  projectPublicMediaDetail,
  projectPublicMediaSummary,
} from "@webmcp/document"
import type {
  CuratedLibraryMediaSource,
  LibraryCatalogQueryInput,
  LibraryMediaDetail,
  LibraryMediaSummary,
  LibraryPreferenceSnapshot,
  LocalLibraryMediaMetadata,
  LocalLibraryMediaSource,
  PublicMediaAsset,
  WorkspaceLibraryMediaMetadata,
} from "@webmcp/document"
import { vi } from "vitest"
import type {
  DeviceLocalMediaDiscoveryAdapter,
  DeviceLocalMediaDiscoveryResult,
} from "./device-local-media-discovery-adapter"
import { LibraryDiscoveryController } from "./discovery-controller"
import type { LibraryDiscoveryDependencies } from "./discovery-controller"
import { libraryMediaUiIdentity } from "./library-media-discovery"
import { LibraryMediaDiscoveryProvider } from "./library-media-discovery-provider"
import { LibraryPreferenceProvider } from "./library-preference-provider"
import {
  preferenceSnapshot,
  preferenceState,
  staticPreferenceController,
} from "./library-template-browser.test-support"

const now = "2026-08-31T08:00:00.000Z"
const contentSha256 = "a".repeat(64)

const provenance = {
  sourceName: "Studio media test fixture",
  sourceUrl: "https://example.com/source",
  license: {
    id: "fixture-license",
    name: "Fixture license",
    url: "https://example.com/license",
  },
  attribution: { required: false, text: null },
  contentSha256,
} as const

const localMetadata: LocalLibraryMediaMetadata = {
  description: "A device-local media fixture",
  categoryId: "workspace-upload",
  useCaseIds: ["proposal"],
  formatFamily: "raster",
  tags: ["fixture", "local"],
  permissions: {
    canView: true,
    canUse: true,
    canFavorite: false,
    canAddToCollection: false,
  },
  provenance: {
    ...provenance,
    sourceName: "Device-local fixture",
    sourceUrl: null,
    license: {
      id: "customer-provided",
      name: "Customer-provided",
      url: null,
    },
    contentSha256: null,
  },
}

const workspaceMetadata: WorkspaceLibraryMediaMetadata = {
  ...localMetadata,
  catalogVersion: 1,
  permissions: {
    canView: true,
    canUse: true,
    canFavorite: true,
    canAddToCollection: true,
  },
  provenance,
}

export const curatedMediaFixture = (
  id = "asset-browserfixture01",
  name = "Olive botanical"
) => {
  const source: CuratedLibraryMediaSource = {
    id,
    version: 1,
    contentSha256,
    name,
    description: "A curated botanical photograph",
    tags: ["proposal", "botanical"],
    width: 1200,
    height: 800,
    mimeType: "image/png",
    bytes: 4096,
    categoryId: "photography",
    useCaseIds: ["proposal"],
    formatFamily: "raster",
    createdAt: now,
    updatedAt: now,
    provenance,
  }
  return {
    summary: projectCuratedMediaSummary(source),
    detail: projectCuratedMediaDetail(source, {}),
  }
}

export const managedMediaFixture = (
  id = "asset-browserfixture01",
  name = "Workspace botanical"
) => {
  const source: PublicMediaAsset = {
    id,
    name,
    mediaType: "image/png",
    bytes: 4096,
    width: 1200,
    height: 800,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: now,
    status: "ready",
  }
  return {
    summary: projectPublicMediaSummary(source, workspaceMetadata),
    detail: projectPublicMediaDetail(source, workspaceMetadata),
  }
}

export const localMediaFixture = (
  id = "asset-browserfixture01",
  name = "Local botanical"
) => {
  const source: LocalLibraryMediaSource = {
    id,
    name,
    mediaType: "image/png",
    size: 4096,
    width: 1200,
    height: 800,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: now,
    archivedAt: null,
    revision: 1,
    integrity: "ready",
  }
  return {
    source,
    summary: projectLocalMediaSummary(source, localMetadata),
    detail: projectLocalMediaDetail(source, localMetadata),
  }
}

const localResult = (
  items: readonly LibraryMediaSummary[]
): DeviceLocalMediaDiscoveryResult => ({
  items,
  status: {
    schemaVersion: 1,
    databaseVersion: 6,
    migrationState: "current",
    legacyRecordCount: 0,
    legacyMetadataRecordCount: 0,
    metadataRecordCount: items.length,
    examinedMetadataCount: items.length,
    unindexedMetadataCount: 0,
    projectedItemCount: items.length,
    archivedRecordCount: 0,
    unavailableRecordCount: 0,
    truncated: false,
    issues: [],
  },
})

export type MediaBrowserHarness = ReturnType<typeof createMediaBrowserHarness>

export function createMediaBrowserHarness({
  server = [curatedMediaFixture()],
  local = [localMediaFixture()],
  preference = preferenceSnapshot(),
  nextCursor = null,
  total,
  listFailure = null,
  detailFailure = null,
  localFailure = null,
}: {
  server?: readonly Readonly<{
    summary: LibraryMediaSummary
    detail: LibraryMediaDetail
  }>[]
  local?: readonly ReturnType<typeof localMediaFixture>[]
  preference?: LibraryPreferenceSnapshot
  nextCursor?: string | null
  total?: number
  listFailure?: Error | null
  detailFailure?: Error | null
  localFailure?: Error | null
} = {}) {
  const requests: LibraryCatalogQueryInput[] = []
  const detailRequests: Array<{
    itemKind: "template" | "media"
    id: string
    version: number
    mediaSource?: LibraryMediaSummary["mediaSource"]
  }> = []
  const detailByIdentity = new Map(
    server.map(({ detail }) => [libraryMediaUiIdentity(detail.summary), detail])
  )
  const dependencies: LibraryDiscoveryDependencies = {
    list: vi.fn(async (query, signal) => {
      signal.throwIfAborted()
      requests.push(structuredClone(query))
      if (listFailure) throw listFailure
      return {
        workspaceRevision: preference.workspaceRevision,
        page: libraryCatalogPageSchema.parse({
          schemaVersion: 1,
          catalogRevision: "media-browser-test-v1",
          generation: query.generation,
          queryIdentity: `libq_${"b".repeat(16)}`,
          items: server.map(({ summary }) => summary),
          nextCursor,
          total: total ?? server.length,
        }),
      }
    }),
    getDetail: vi.fn(async (identity, signal) => {
      signal.throwIfAborted()
      detailRequests.push(identity)
      if (detailFailure) throw detailFailure
      const detail =
        identity.itemKind === "media"
          ? detailByIdentity.get(
              `media:${identity.mediaSource}:${identity.id}@${identity.version}`
            )
          : undefined
      if (!detail) throw new Error("Exact server media detail is unavailable")
      return detail
    }),
    getTaxonomy: () => ({
      schemaVersion: 1,
      categories: [
        { id: "photography", label: "Photography" },
        { id: "workspace-upload", label: "Workspace upload" },
      ],
      useCases: [{ id: "proposal", label: "Proposal" }],
      formatFamilies: [{ id: "raster", label: "Raster" }],
      orientations: [
        { id: "portrait", label: "Portrait" },
        { id: "landscape", label: "Landscape" },
        { id: "square", label: "Square" },
        { id: "mixed", label: "Mixed" },
      ],
      owners: [
        { id: "studio", label: "Studio" },
        { id: "workspace", label: "Your workspace" },
      ],
    }),
    scheduleQuery: (callback) => {
      let cancelled = false
      queueMicrotask(() => {
        if (!cancelled) callback()
      })
      return () => {
        cancelled = true
      }
    },
  }
  const controller = new LibraryDiscoveryController(dependencies)
  const localByIdentity = new Map(
    local.map((fixture) => [
      `${fixture.summary.id}@${fixture.summary.version}`,
      fixture.detail,
    ])
  )
  const localAdapter: DeviceLocalMediaDiscoveryAdapter = {
    list: vi.fn(async (signal) => {
      signal?.throwIfAborted()
      if (localFailure) throw localFailure
      return localResult(local.map(({ summary }) => summary))
    }),
    getDetail: vi.fn(async (id, revision, signal) => {
      signal?.throwIfAborted()
      const detail = localByIdentity.get(`${id}@${revision}`)
      if (!detail) throw new Error("Exact local media detail is unavailable")
      return detail
    }),
    recheckSelection: vi.fn(async () => {
      throw new Error("Preview byte reads are not part of browser unit tests")
    }),
  }
  const preferenceController = staticPreferenceController(
    preferenceState({ snapshot: preference })
  )

  return {
    controller,
    dependencies,
    detailRequests,
    localAdapter,
    preferenceController,
    requests,
  }
}

export function MediaBrowserTestRoot({
  harness,
  children,
}: {
  harness: MediaBrowserHarness
  children: ReactNode
}) {
  return (
    <LibraryPreferenceProvider
      createController={() => harness.preferenceController}
      createInvalidationChannel={() => null}
      scheduleFinalization={queueMicrotask}
      sessionId="media-browser-test"
    >
      <LibraryMediaDiscoveryProvider
        createController={() => harness.controller}
        localAdapter={harness.localAdapter}
        scheduleFinalization={queueMicrotask}
      >
        {children}
      </LibraryMediaDiscoveryProvider>
    </LibraryPreferenceProvider>
  )
}
