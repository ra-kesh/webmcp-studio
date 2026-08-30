// @vitest-environment jsdom

import "fake-indexeddb/auto"
import { builtInDesignTemplateRepository } from "@webmcp/document"
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRoute,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router"
import { act } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { CurrentDraftSnapshot } from "../features/editor/current-draft-repository"
import { DocumentDraftRepository } from "../features/editor/document-draft-repository"
import { documentPath } from "../features/editor/document-route"
import { Route as StudioIndexRoute } from "./_studio/index"
import { Route as StudioLayoutRoute } from "./_studio/route"
import { Route as StudioDocumentRoute } from "./_studio/documents/$documentId"

type MockInitialDocumentRecord = {
  summary: { documentId: string; name: string }
  envelope: { document: { id: string } }
}

vi.mock("../features/studio-shell", () => ({
  StudioShell: (props: {
    initialDocumentRecord?: MockInitialDocumentRecord | null
    routeDocumentId?: string | null
    routeNotice?: string | null
    onDismissRouteNotice?: () => void
    onHome?: () => void | Promise<void>
    onSessionOpened?: (documentId: string) => Promise<boolean>
    onInitialDocumentInstalled?: (record: MockInitialDocumentRecord) => void
  }) => (
    <main data-testid="studio-shell">
      <p data-testid="record-id">
        {props.initialDocumentRecord?.summary.documentId ?? "library"}
      </p>
      <p data-testid="canonical-id">
        {props.initialDocumentRecord?.envelope.document.id ?? "library"}
      </p>
      <p data-testid="route-id">{props.routeDocumentId ?? "library"}</p>
      <p data-testid="record-name">
        {props.initialDocumentRecord?.summary.name ?? "Documents"}
      </p>
      {props.routeNotice ? (
        <section aria-label="Document route notice">
          <p>{props.routeNotice}</p>
          <button onClick={props.onDismissRouteNotice}>Dismiss notice</button>
        </section>
      ) : null}
      {props.onHome ? (
        <button onClick={() => void props.onHome?.()}>Home</button>
      ) : null}
      {props.onSessionOpened ? (
        <button onClick={() => void props.onSessionOpened?.("document-b")}>
          Open document B
        </button>
      ) : null}
      {props.onInitialDocumentInstalled && props.initialDocumentRecord ? (
        <button
          onClick={() =>
            props.onInitialDocumentInstalled?.(props.initialDocumentRecord!)
          }
        >
          Confirm installed
        </button>
      ) : null}
    </main>
  ),
}))

const DATABASE_NAME = "webmcp-studio-documents"

const snapshot = (documentId: string, name: string): CurrentDraftSnapshot => {
  const document = builtInDesignTemplateRepository.materialize(
    "editorial-one-pager",
    1,
    { identity: "canonical" }
  )
  return {
    document: { ...document, id: documentId, name },
    sourceContext: {
      quotationSource: null,
      quotationTemplateId: "editorial-olive",
      designTemplate: { id: "editorial-one-pager", version: 1 },
    },
  }
}

const deleteDatabase = () =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME)
    request.onerror = () => reject(request.error)
    request.onblocked = () =>
      reject(new Error("The Studio test database is blocked."))
    request.onsuccess = () => resolve()
  })

const waitFor = async (assertion: () => void, timeoutMs = 3_000) => {
  const startedAt = Date.now()
  let lastError: unknown
  while (Date.now() - startedAt < timeoutMs) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
  throw lastError
}

const waitForAsync = async (
  assertion: () => Promise<void>,
  timeoutMs = 3_000
) => {
  const startedAt = Date.now()
  let lastError: unknown
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await assertion()
      return
    } catch (error) {
      lastError = error
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
  throw lastError
}

const text = (container: HTMLElement, testId: string) =>
  container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.textContent

describe("mounted canonical document routing", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    localStorage.clear()
    window.scrollTo = vi.fn()
    await deleteDatabase()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    await deleteDatabase()
    vi.restoreAllMocks()
  })

  const seed = async (...drafts: Array<readonly [string, string]>) => {
    const repository = new DocumentDraftRepository()
    for (const [documentId, name] of drafts) {
      const created = await repository.create(snapshot(documentId, name))
      expect(created.ok).toBe(true)
    }
    repository.close()
  }

  const mountAt = async (pathname: string) => {
    const history = createMemoryHistory({ initialEntries: [pathname] })
    const rootRoute = createRootRoute({ component: Outlet })
    const studioLayoutRoute = createRoute({
      component: StudioLayoutRoute.options.component,
      getParentRoute: () => rootRoute,
      id: "/_studio",
    })
    const studioIndexRoute = createRoute({
      component: StudioIndexRoute.options.component,
      getParentRoute: () => studioLayoutRoute,
      path: "/",
      validateSearch: StudioIndexRoute.options.validateSearch,
    })
    const studioDocumentRoute = createRoute({
      component: StudioDocumentRoute.options.component,
      getParentRoute: () => studioLayoutRoute,
      path: "/documents/$documentId",
    })
    const routeTree = rootRoute.addChildren([
      studioLayoutRoute.addChildren([studioIndexRoute, studioDocumentRoute]),
    ])
    const router = createRouter({ routeTree, history })
    await router.load()
    await act(async () => {
      root.render(<RouterProvider router={router} />)
    })
    return router
  }

  it("deep-links through the real route and hands one exact admitted identity to the keyed session", async () => {
    await seed(["document-a", "Alpha proposal"])
    const router = await mountAt("/documents/document-a")

    await waitFor(() => {
      expect(text(container, "record-id")).toBe("document-a")
    })
    expect(text(container, "canonical-id")).toBe("document-a")
    expect(text(container, "route-id")).toBe("document-a")
    expect(text(container, "record-name")).toBe("Alpha proposal")
    expect(router.state.location.pathname).toBe("/documents/document-a")
  })

  it("touches an admitted document only after the editor confirms exact installation", async () => {
    await seed(["document-a", "Alpha proposal"])
    const baselineRepository = new DocumentDraftRepository()
    const baseline = await baselineRepository.get("document-a")
    expect(baseline.ok && baseline.status === "found").toBe(true)
    if (!baseline.ok || baseline.status !== "found") return
    const baselineLastOpenedAt = baseline.record.summary.lastOpenedAt
    baselineRepository.close()
    await mountAt("/documents/document-a")
    await waitFor(() => expect(text(container, "record-id")).toBe("document-a"))

    const beforeRepository = new DocumentDraftRepository()
    const before = await beforeRepository.get("document-a")
    expect(before.ok && before.status === "found").toBe(true)
    if (!before.ok || before.status !== "found") return
    expect(before.record.summary.lastOpenedAt).toBe(baselineLastOpenedAt)
    beforeRepository.close()

    const confirm = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Confirm installed"
    )
    expect(confirm).toBeTruthy()
    await act(async () => confirm?.click())

    await waitFor(() => {
      expect(
        container.querySelector('[data-testid="record-id"]')?.textContent
      ).toBe("document-a")
    })
    const afterRepository = new DocumentDraftRepository()
    await waitForAsync(async () => {
      const after = await afterRepository.get("document-a")
      expect(after.ok && after.status === "found").toBe(true)
      if (!after.ok || after.status !== "found") return
      expect(after.record.summary.lastOpenedAt).not.toBe(baselineLastOpenedAt)
    })
    afterRepository.close()
  })

  it("preserves an encoded one-segment ID at the actual router boundary", async () => {
    const documentId = "quote / 50% ✓"
    const target = documentPath(documentId)
    expect(target.ok).toBe(true)
    if (!target.ok) return
    await seed([documentId, "Encoded proposal"])

    const router = await mountAt(target.pathname)
    await waitFor(() => {
      expect(text(container, "record-id")).toBe(documentId)
    })
    expect(text(container, "canonical-id")).toBe(documentId)
    expect(text(container, "route-id")).toBe(documentId)
    expect(router.state.location.pathname).toContain("%2F")
    expect(router.state.location.pathname.split("/")).toHaveLength(3)
  })

  it("switches A to B and Back without ever mounting an editor shell for the wrong record", async () => {
    await seed(
      ["document-a", "Alpha proposal"],
      ["document-b", "Beta proposal"]
    )
    const seenRecordIds: string[] = []
    const observer = new MutationObserver(() => {
      const current = text(container, "record-id")
      if (current && current !== "library") seenRecordIds.push(current)
    })
    observer.observe(container, { childList: true, subtree: true })
    const router = await mountAt("/documents/document-a")
    await waitFor(() => expect(text(container, "record-id")).toBe("document-a"))

    const openB = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Open document B"
    )
    expect(openB).toBeTruthy()
    await act(async () => openB?.click())
    await waitFor(() => expect(text(container, "record-id")).toBe("document-b"))
    expect(router.state.location.pathname).toBe("/documents/document-b")

    await act(async () => router.history.back())
    await waitFor(() => expect(text(container, "record-id")).toBe("document-a"))
    observer.disconnect()
    expect(
      seenRecordIds.every((id) => id === "document-a" || id === "document-b")
    ).toBe(true)
    expect(text(container, "canonical-id")).toBe("document-a")
    expect(text(container, "route-id")).toBe("document-a")
  })

  it("redirects a missing deep link with a persistent typed notice and dismisses it through the real index route", async () => {
    const router = await mountAt("/documents/missing-document")

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/")
      expect(container.textContent).toContain(
        "The document “missing-document” could not be found."
      )
    })
    expect(router.state.location.search).toEqual({
      notice: "document_missing",
      documentId: "missing-document",
    })

    await act(async () => router.invalidate())
    expect(container.textContent).toContain(
      "The document “missing-document” could not be found."
    )

    const dismiss = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Dismiss notice"
    )
    expect(dismiss).toBeTruthy()
    await act(async () => dismiss?.click())
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    expect(container.textContent).not.toContain("could not be found")
  })
})
