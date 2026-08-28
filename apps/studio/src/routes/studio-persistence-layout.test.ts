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

describe("Studio persistence route layout", () => {
  it("keeps the UI below one client-only pathless owner and API routes at root", () => {
    expect(layoutSource).toContain('createFileRoute("/_studio")')
    expect(layoutSource).toContain("ssr: false")
    expect(layoutSource).toContain("<StudioPersistenceProvider>")
    expect(layoutSource).toContain("<RecentDocumentsProvider>")
    expect(layoutSource).toContain("</RecentDocumentsProvider>")
    expect(layoutSource).toContain("<Outlet />")
    expect(layoutSource).toMatch(
      /<StudioPersistenceProvider>\s*<RecentDocumentsProvider>\s*<Outlet \/>\s*<\/RecentDocumentsProvider>\s*<\/StudioPersistenceProvider>/
    )

    expect(generatedTree).toContain("id: '/_studio'")
    expect(generatedTree).toContain(
      "const StudioIndexRoute = StudioIndexRouteImport.update({\n  id: '/',\n  path: '/',\n  getParentRoute: () => StudioRouteRoute,"
    )
    expect(generatedTree).toContain(
      "const ApiHealthRoute = ApiHealthRouteImport.update({\n  id: '/api/health',\n  path: '/api/health',\n  getParentRoute: () => rootRouteImport,"
    )
    expect(generatedTree).toContain(
      "StudioRouteRoute: typeof StudioRouteRouteWithChildren"
    )
    expect(generatedTree).toContain("fullPath: '/'")
  })
})
