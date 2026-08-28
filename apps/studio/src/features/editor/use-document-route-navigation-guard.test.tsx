// @vitest-environment jsdom

import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRoute,
  createRootRoute,
  createRouter,
  useRouter,
} from "@tanstack/react-router"
import { act, useEffect } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useDocumentRouteNavigationGuard } from "./use-document-route-navigation-guard"

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe("useDocumentRouteNavigationGuard", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    window.scrollTo = vi.fn()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  const mount = async ({
    prepareToLeave,
    onBlocked = vi.fn(),
    onSourceUnmount = vi.fn(),
  }: {
    prepareToLeave: () => boolean | Promise<boolean>
    onBlocked?: (error: unknown | null) => void
    onSourceUnmount?: () => void
  }) => {
    function Source() {
      const router = useRouter()
      useDocumentRouteNavigationGuard({
        enabled: true,
        shouldWarnBeforeUnload: () => true,
        prepareToLeave,
        onBlocked,
      })
      useEffect(() => onSourceUnmount, [])
      return <button onClick={() => router.history.push("/next")}>Next</button>
    }

    const rootRoute = createRootRoute({ component: Outlet })
    const sourceRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/source",
      component: Source,
    })
    const nextRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/next",
      component: () => <p>Next route</p>,
    })
    const history = createMemoryHistory({ initialEntries: ["/source"] })
    const router = createRouter({
      history,
      routeTree: rootRoute.addChildren([sourceRoute, nextRoute]),
    })
    await router.load()
    await act(async () => root.render(<RouterProvider router={router} />))
    const navigationButton = container.querySelector("button")
    if (!navigationButton) throw new Error("Expected the route control")
    return {
      navigationButton,
      onBlocked,
      onSourceUnmount,
      router,
    }
  }

  it("keeps the old route and owner mounted until a deferred durable exit succeeds", async () => {
    const gate = deferred<boolean>()
    const mounted = await mount({ prepareToLeave: () => gate.promise })

    await act(async () => mounted.navigationButton.click())
    expect(mounted.router.state.location.pathname).toBe("/source")
    expect(mounted.onSourceUnmount).not.toHaveBeenCalled()

    await act(async () => gate.resolve(true))
    expect(mounted.router.state.location.pathname).toBe("/next")
    expect(mounted.onBlocked).not.toHaveBeenCalled()
    expect(mounted.onSourceUnmount).toHaveBeenCalledTimes(1)
  })

  it("rejects failed and thrown exits without changing URL or destroying the owner", async () => {
    const failure = await mount({ prepareToLeave: () => false })
    await act(async () => failure.navigationButton.click())
    expect(failure.router.state.location.pathname).toBe("/source")
    expect(failure.onBlocked).toHaveBeenCalledWith(null)
    expect(failure.onSourceUnmount).not.toHaveBeenCalled()

    await act(async () => root.unmount())
    root = createRoot(container)
    const error = new Error("flush failed")
    const rejection = await mount({
      prepareToLeave: () => Promise.reject(error),
    })
    await act(async () => rejection.navigationButton.click())
    expect(rejection.router.state.location.pathname).toBe("/source")
    expect(rejection.onBlocked).toHaveBeenCalledWith(error)
    expect(rejection.onSourceUnmount).not.toHaveBeenCalled()
  })
})
