import { useRef, useState } from "react"
import type { PropsWithChildren } from "react"
import {
  LibraryDiscoveryProvider,
  useLibraryDiscoveryCommands,
} from "./library-discovery-provider"
import type { LibraryDiscoveryProviderProps } from "./library-discovery-provider"
import { LibraryMediaDiscoveryProvider } from "./library-media-discovery-provider"
import type { LibraryMediaDiscoveryProviderProps } from "./library-media-discovery-provider"
import {
  LibraryPreferenceProvider,
  useLibraryDiscoveryInvalidation,
  useLibraryPreferences,
} from "./library-preference-provider"
import type { LibraryPreferenceProviderProps } from "./library-preference-provider"
import type { LibraryPreferenceFetch } from "./library-preference-client"

type ProviderPropsWithoutChildren<TProps> = Omit<TProps, "children">

export const LIBRARY_PREFERENCE_BOOTSTRAP_TIMEOUT_MS = 12_000

const defaultPreferenceFetch: LibraryPreferenceFetch = (input, init) =>
  globalThis.fetch(input, init)

const bootstrapTimeoutError = () => {
  const error = new Error("Studio timed out while opening library preferences.")
  error.name = "AbortError"
  return error
}

const createBoundedBootstrapFetch = (
  fetchRequest: LibraryPreferenceFetch,
  timeoutMs: number
): LibraryPreferenceFetch => {
  let firstRequest = true

  return (input, init) => {
    if (!firstRequest) return fetchRequest(input, init)
    firstRequest = false

    const controller = new AbortController()
    const upstreamSignal = init?.signal
    let rejectAbort: (reason: unknown) => void = () => undefined
    const abortPromise = new Promise<Response>((_resolve, reject) => {
      rejectAbort = reject
    })
    const rejectFromAbort = () =>
      rejectAbort(
        controller.signal.reason instanceof Error
          ? controller.signal.reason
          : bootstrapTimeoutError()
      )
    controller.signal.addEventListener("abort", rejectFromAbort, {
      once: true,
    })

    const relayUpstreamAbort = () =>
      controller.abort(upstreamSignal?.reason ?? bootstrapTimeoutError())
    if (upstreamSignal?.aborted) relayUpstreamAbort()
    else
      upstreamSignal?.addEventListener("abort", relayUpstreamAbort, {
        once: true,
      })

    const timer = globalThis.setTimeout(
      () => controller.abort(bootstrapTimeoutError()),
      Math.max(1, timeoutMs)
    )
    const request = Promise.resolve().then(() =>
      fetchRequest(input, { ...init, signal: controller.signal })
    )

    return Promise.race([request, abortPromise]).finally(() => {
      globalThis.clearTimeout(timer)
      controller.signal.removeEventListener("abort", rejectFromAbort)
      upstreamSignal?.removeEventListener("abort", relayUpstreamAbort)
    })
  }
}

export type LibraryRuntimeProviderProps = PropsWithChildren<{
  bootstrapTimeoutMs?: number
  discovery?: ProviderPropsWithoutChildren<LibraryDiscoveryProviderProps>
  mediaDiscovery?: ProviderPropsWithoutChildren<LibraryMediaDiscoveryProviderProps>
  preferences?: ProviderPropsWithoutChildren<LibraryPreferenceProviderProps>
}>

/**
 * Owns the two independent library controllers for one Studio route lifetime.
 * Preferences settle first so the first catalog request includes the current
 * principal projection. A failed preference read still releases discovery.
 */
export function LibraryRuntimeProvider({
  bootstrapTimeoutMs = LIBRARY_PREFERENCE_BOOTSTRAP_TIMEOUT_MS,
  children,
  discovery,
  mediaDiscovery,
  preferences,
}: LibraryRuntimeProviderProps) {
  const [bootstrapFetch] = useState(() =>
    createBoundedBootstrapFetch(
      preferences?.fetchRequest ?? defaultPreferenceFetch,
      bootstrapTimeoutMs
    )
  )

  return (
    <LibraryPreferenceProvider {...preferences} fetchRequest={bootstrapFetch}>
      <LibraryDiscoveryBootstrap
        discovery={discovery}
        mediaDiscovery={mediaDiscovery}
      >
        {children}
      </LibraryDiscoveryBootstrap>
    </LibraryPreferenceProvider>
  )
}

function LibraryDiscoveryBootstrap({
  children,
  discovery,
  mediaDiscovery,
}: PropsWithChildren<{
  discovery?: ProviderPropsWithoutChildren<LibraryDiscoveryProviderProps>
  mediaDiscovery?: ProviderPropsWithoutChildren<LibraryMediaDiscoveryProviderProps>
}>) {
  const { state } = useLibraryPreferences()
  const bootstrapSettledRef = useRef(false)
  if (state.snapshotStatus === "ready" || state.snapshotStatus === "failed") {
    bootstrapSettledRef.current = true
  }

  if (!bootstrapSettledRef.current) {
    return (
      <main
        aria-busy="true"
        className="grid min-h-dvh place-items-center bg-muted/20"
        data-library-runtime-bootstrap="loading"
      >
        <div
          className="flex items-center gap-2 text-sm text-muted-foreground"
          role="status"
        >
          <span
            aria-hidden="true"
            className="size-2 animate-pulse rounded-full bg-current"
          />
          <span>Opening your Studio library…</span>
        </div>
      </main>
    )
  }

  return (
    <LibraryDiscoveryProvider {...discovery}>
      <LibraryDiscoveryInvalidationBridge />
      <LibraryMediaDiscoveryProvider {...mediaDiscovery}>
        {children}
      </LibraryMediaDiscoveryProvider>
    </LibraryDiscoveryProvider>
  )
}

function LibraryDiscoveryInvalidationBridge() {
  const { refresh } = useLibraryDiscoveryCommands()
  const newestRevisionRef = useRef(-1)

  useLibraryDiscoveryInvalidation((workspaceRevision) => {
    if (workspaceRevision <= newestRevisionRef.current) return
    newestRevisionRef.current = workspaceRevision
    void refresh()
  })

  return null
}
