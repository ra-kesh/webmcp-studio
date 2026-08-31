import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const generatedTree = readFileSync(
  new URL("../routeTree.gen.ts", import.meta.url),
  "utf8"
)
const layoutSource = readFileSync(
  new URL("./_studio/route.tsx", import.meta.url),
  "utf8"
)
const libraryRuntimeSource = readFileSync(
  new URL("../content/library/library-runtime-provider.tsx", import.meta.url),
  "utf8"
)
const persistenceProviderSource = readFileSync(
  new URL(
    "../features/persistence/studio-persistence-provider.tsx",
    import.meta.url
  ),
  "utf8"
)
const persistenceContextSource = readFileSync(
  new URL(
    "../features/persistence/studio-persistence-context.ts",
    import.meta.url
  ),
  "utf8"
)

describe("Studio persistence route layout", () => {
  it("keeps the UI below one client-only pathless owner and API routes at root", () => {
    expect(layoutSource).toContain('createFileRoute("/_studio")')
    expect(layoutSource).toContain("ssr: false")
    expect(layoutSource).toContain("<StudioPersistenceProvider>")
    expect(layoutSource).toContain("<LibraryPreviewProvider>")
    expect(layoutSource).toContain("<LibraryRuntimeProvider>")
    expect(layoutSource).toContain("<DocumentPreviewProvider>")
    expect(layoutSource).toContain("<RecentDocumentsProvider>")
    expect(layoutSource).toContain("</RecentDocumentsProvider>")
    expect(layoutSource).toContain("</DocumentPreviewProvider>")
    expect(layoutSource).toContain("</LibraryRuntimeProvider>")
    expect(layoutSource).toContain("</LibraryPreviewProvider>")
    expect(layoutSource).toContain("<Outlet />")
    expect(layoutSource).toMatch(
      /<StudioPersistenceProvider>\s*<LibraryPreviewProvider>\s*<LibraryRuntimeProvider>\s*<DocumentPreviewProvider>\s*<RecentDocumentsProvider>\s*<Outlet \/>\s*<\/RecentDocumentsProvider>\s*<\/DocumentPreviewProvider>\s*<\/LibraryRuntimeProvider>\s*<\/LibraryPreviewProvider>\s*<\/StudioPersistenceProvider>/
    )

    expect(generatedTree).toContain("id: '/_studio'")
    expect(generatedTree).toContain(
      "const StudioIndexRoute = StudioIndexRouteImport.update({\n  id: '/',\n  path: '/',\n  getParentRoute: () => StudioRouteRoute,"
    )
    expect(generatedTree).toContain(
      "const ApiHealthRoute = ApiHealthRouteImport.update({\n  id: '/api/health',\n  path: '/api/health',\n  getParentRoute: () => rootRouteImport,"
    )
    expect(generatedTree).toContain(
      "id: '/v1/studio/library/preferences',\n    path: '/v1/studio/library/preferences',\n    getParentRoute: () => rootRouteImport,"
    )
    expect(generatedTree).toContain(
      "StudioRouteRoute: typeof StudioRouteRouteWithChildren"
    )
    expect(generatedTree).toContain("fullPath: '/'")

    expect(libraryRuntimeSource).toMatch(
      /<LibraryPreferenceProvider\s+\{\.\.\.preferences\}\s+fetchRequest=\{bootstrapFetch\}>\s*<LibraryDiscoveryBootstrap\s+discovery=\{discovery\}\s+mediaDiscovery=\{mediaDiscovery\}\s*>/
    )
    expect(libraryRuntimeSource).toMatch(
      /<LibraryDiscoveryProvider \{\.\.\.discovery\}>\s*<LibraryDiscoveryInvalidationBridge \/>\s*<LibraryMediaDiscoveryProvider \{\.\.\.mediaDiscovery\}>/
    )
    expect(layoutSource.match(/<LibraryRuntimeProvider>/g) ?? []).toHaveLength(
      1
    )
  })

  it("keeps persistence context identity outside the Fast Refresh provider boundary", () => {
    expect(persistenceProviderSource).toContain(
      'from "./studio-persistence-context"'
    )
    expect(persistenceProviderSource).not.toContain("createContext(")
    expect(persistenceContextSource).toContain(
      "createContext<StudioPersistenceApi | null>(null)"
    )
    expect(persistenceContextSource).toContain(
      "export function useStudioPersistence"
    )
  })
})
