import type { ReactNode } from "react"
import type { Root } from "react-dom/client"
import type { LibraryTemplateSummary } from "@webmcp/document"
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
import {
  LibraryDiscoveryProvider,
  type LibraryDiscoveryControllerPort,
} from "./library-discovery-provider"

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
  const firstDetail = first
    ? getStudioLibraryCatalogDetail("template", first.id, first.version)
    : null
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
  if (!source) throw new Error("The browser tests require a template fixture.")
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

export function DiscoveryTestRoot({
  controller,
  children,
}: {
  controller: ReturnType<typeof staticController>
  children: ReactNode
}) {
  return (
    <LibraryDiscoveryProvider createController={() => controller}>
      {children}
    </LibraryDiscoveryProvider>
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
