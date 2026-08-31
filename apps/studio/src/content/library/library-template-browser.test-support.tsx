import type { ReactNode } from "react"
import type { Root } from "react-dom/client"
import type {
  LibraryPreferenceSnapshot,
  LibraryTemplateSummary,
} from "@webmcp/document"
import { vi } from "vitest"
import type {
  LibraryDiscoveryConfirmedPage,
  LibraryDiscoveryState,
} from "./discovery-controller"
import {
  getStudioLibraryCatalogDetail,
  studioLibraryCatalogIndex,
} from "./catalog"
import { studioLibraryDiscoveryAdapter } from "./library-discovery-adapter"
import { LibraryDiscoveryProvider } from "./library-discovery-provider"
import type { LibraryDiscoveryControllerPort } from "./library-discovery-provider"
import type { LibraryPreferenceStateOwner } from "./library-preference-controller"
import { LibraryPreferenceProvider } from "./library-preference-provider"
import type { LibraryPreferenceControllerPort } from "./library-preference-provider"

export const catalogTemplates = studioLibraryCatalogIndex
  .list({
    generation: "browser-test-catalog",
    itemKinds: ["template"],
    limit: 50,
  })
  .items.filter(
    (item): item is LibraryTemplateSummary => item.itemKind === "template"
  )

const filters = {
  itemKinds: ["template"] as const,
  categoryIds: [] as readonly string[],
  useCaseIds: [] as readonly string[],
  formatFamilies: [] as readonly string[],
  orientations: [] as readonly (
    "portrait" | "landscape" | "square" | "mixed"
  )[],
  ownerKinds: [] as readonly ("studio" | "workspace")[],
  collectionId: null,
}

export const confirmedPage = (
  items: readonly LibraryTemplateSummary[],
  overrides: Partial<LibraryDiscoveryConfirmedPage> = {}
): LibraryDiscoveryConfirmedPage => ({
  workspaceRevision: 1,
  catalogRevision: "browser-test-catalog",
  generation: "browser-test-generation",
  queryIdentity: "libq_0123456789abcdef",
  queryKey: "browser-test-query",
  items,
  nextCursor: null,
  total: items.length,
  ...overrides,
})

export const discoveryState = (
  overrides: Partial<LibraryDiscoveryState> = {}
): LibraryDiscoveryState => {
  const first = catalogTemplates[0]
  const firstDetail = getStudioLibraryCatalogDetail(
    "template",
    first.id,
    first.version
  )
  return {
    active: true,
    disposed: false,
    taxonomy: studioLibraryDiscoveryAdapter.getTaxonomy(),
    rawSearch: "",
    appliedQuery: {
      ...filters,
      search: "",
      order: "curated",
      entryPoint: "featured",
      favoritesOnly: false,
      recentOnly: false,
    },
    filters,
    order: "curated",
    entryPoint: "featured",
    queryScheduled: false,
    updatingResults: false,
    replacementStatus: "idle",
    replacementFailure: null,
    appendStatus: "idle",
    appendFailure: null,
    confirmedPage: confirmedPage(catalogTemplates),
    retainedPage: null,
    detail: firstDetail
      ? { status: "ready", detail: firstDetail }
      : { status: "idle" },
    announcement: null,
    focusIntent: null,
    ...overrides,
  }
}

export const cloneTemplates = (count: number) => {
  const source = catalogTemplates[0]
  return Array.from({ length: count }, (_, index): LibraryTemplateSummary => {
    const id = `browser-template-${String(index + 1).padStart(3, "0")}`
    return {
      ...structuredClone(source),
      id,
      name: `Template ${index + 1}`,
      curatedRank: index,
      preview: {
        ...structuredClone(source.preview),
        itemId: id,
        resourcePath: `/library/previews/${id}.png`,
      },
    }
  })
}

export const staticController = (state: LibraryDiscoveryState) => {
  let currentState = state
  const listeners = new Set<() => void>()
  const asyncVoid = vi.fn<() => Promise<void>>(async () => undefined)
  const asyncDetail = vi.fn<LibraryDiscoveryControllerPort["selectItem"]>(
    async () => null
  )
  const controller = {
    getSnapshot: () => currentState,
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    activate: vi.fn<() => void>(),
    deactivate: vi.fn<() => void>(),
    dispose: vi.fn<() => void>(),
    setRawSearch: vi.fn<(value: string) => void>(),
    applySearch: vi.fn<() => void>(),
    clearSearch: vi.fn<() => void>(),
    setFilters: vi.fn<LibraryDiscoveryControllerPort["setFilters"]>(),
    setOrder: vi.fn<LibraryDiscoveryControllerPort["setOrder"]>(),
    setEntryPoint: vi.fn<LibraryDiscoveryControllerPort["setEntryPoint"]>(),
    refresh: asyncVoid,
    retryReplacement: vi.fn<() => Promise<void>>(async () => undefined),
    loadMore: vi.fn<() => Promise<void>>(async () => undefined),
    selectItem: asyncDetail,
    retryDetail: vi.fn<LibraryDiscoveryControllerPort["retryDetail"]>(
      async () => null
    ),
    clearSelection: vi.fn<() => void>(),
    clearAnnouncement: vi.fn<(id: number) => void>(),
    clearFocusIntent: vi.fn<(id: number) => void>(),
  } satisfies LibraryDiscoveryControllerPort
  return Object.assign(controller, {
    updateState: (nextState: LibraryDiscoveryState) => {
      currentState = nextState
      for (const listener of listeners) listener()
    },
  })
}

export const preferenceSnapshot = (
  overrides: Partial<LibraryPreferenceSnapshot> = {}
): LibraryPreferenceSnapshot => ({
  workspaceRevision: 1,
  preferences: [],
  collections: [],
  ...overrides,
})

export const preferenceState = (
  overrides: Partial<LibraryPreferenceStateOwner> = {}
): LibraryPreferenceStateOwner => ({
  active: true,
  disposed: false,
  snapshotStatus: "ready",
  snapshot: preferenceSnapshot(),
  snapshotFailure: null,
  pending: new Map(),
  failures: new Map(),
  collectionDetails: new Map(),
  discoveryInvalidationRevision: 1,
  ...overrides,
})

export const staticPreferenceController = (
  state: LibraryPreferenceStateOwner = preferenceState()
) => {
  let currentState = state
  const listeners = new Set<() => void>()
  const controller = {
    getSnapshot: () => currentState,
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    subscribeDiscoveryInvalidation: vi.fn(() => () => undefined),
    activate: vi.fn<() => void>(),
    deactivate: vi.fn<() => void>(),
    dispose: vi.fn<() => void>(),
    refresh: vi.fn(async () => undefined),
    refreshAfterCurrent: vi.fn(async () => undefined),
    loadCollection: vi.fn(async () => null),
    retryCollectionDetail: vi.fn(async () => null),
    setFavorite: vi.fn(async () => true),
    recordUsed: vi.fn(async () => true),
    createCollection: vi.fn(async () => true),
    renameCollection: vi.fn(async () => true),
    deleteCollection: vi.fn(async () => true),
    addCollectionMember: vi.fn(async () => true),
    removeCollectionMember: vi.fn(async () => true),
    reorderCollectionMembers: vi.fn(async () => true),
    retry: vi.fn(async () => true),
    dismissFailure: vi.fn<(key: string) => void>(),
  } satisfies LibraryPreferenceControllerPort
  return Object.assign(controller, {
    updateState: (nextState: LibraryPreferenceStateOwner) => {
      currentState = nextState
      for (const listener of listeners) listener()
    },
  })
}

export function DiscoveryTestRoot({
  controller,
  preferenceController = staticPreferenceController(),
  children,
}: {
  controller: ReturnType<typeof staticController>
  preferenceController?: LibraryPreferenceControllerPort
  children: ReactNode
}) {
  return (
    <LibraryPreferenceProvider
      createController={() => preferenceController}
      scheduleFinalization={(callback) => callback()}
    >
      <LibraryDiscoveryProvider createController={() => controller}>
        {children}
      </LibraryDiscoveryProvider>
    </LibraryPreferenceProvider>
  )
}

export async function unmountTestRoot(
  root: Root,
  host: HTMLElement,
  act: (callback: () => void | Promise<void>) => Promise<void>
) {
  await act(async () => root.unmount())
  host.remove()
}
