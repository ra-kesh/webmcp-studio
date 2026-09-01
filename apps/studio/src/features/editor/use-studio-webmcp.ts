import { useEffect, useRef, useState } from "react"
import type {
  ChangeSet,
  GeneratedDocumentPlan,
  TemplateModifications,
  TemplateVersion,
} from "@webmcp/document"
import type {
  ProductCommandInvocation,
  ProductCommandRunResult,
  ProductCommandRuntimeContext,
} from "@webmcp/editor/product-commands"
import { registerStudioWebMcpTools } from "@webmcp/webmcp"
import type {
  StudioWebMcpRenderRecord,
  StudioWebMcpRenderSelection,
  StudioWebMcpSnapshot,
  StudioWebMcpProposalProvenance,
  StudioWebMcpServices as RegisteredStudioWebMcpServices,
  WebMcpModelContext,
} from "@webmcp/webmcp"
import type { StudioAsset } from "./asset-catalog"
import { createManagedWebMcpCatalog } from "./managed-webmcp-catalog"
import type { ManagedWebMcpCatalog } from "./managed-webmcp-catalog"

declare global {
  interface Document {
    modelContext?: WebMcpModelContext
  }
}

type WebMcpStatus = "unavailable" | "registering" | "ready" | "error"

export const WEBMCP_REGISTRATION_TIMEOUT_MS = 10_000
const WEBMCP_REGISTRATION_RETRY_MS = 1_500

const waitForRegistration = <T>(pending: Promise<T>, signal: AbortSignal) => {
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const cleanUp = () => signal.removeEventListener("abort", abort)
    const abort = () => {
      cleanUp()
      reject(signal.reason)
    }
    signal.addEventListener("abort", abort, { once: true })
    void pending.then(
      (value) => {
        cleanUp()
        if (!signal.aborted) resolve(value)
      },
      (error: unknown) => {
        cleanUp()
        if (!signal.aborted) reject(error)
      }
    )
  })
}

type StudioWebMcpServices = Omit<
  StudioWebMcpSnapshot,
  "assets" | "commandCapabilities" | "productCommandContext"
> & {
  assets: readonly StudioAsset[]
  mediaDerivations?: RegisteredStudioWebMcpServices["mediaDerivations"]
  mutationDisabledReason?: string | null
  outputDisabledReason?: string | null
  getProductCommandContext: () => ProductCommandRuntimeContext | null
  runProductCommand: (
    invocation: ProductCommandInvocation
  ) => ProductCommandRunResult
  proposeChangeSet: (
    changeSet: ChangeSet,
    provenance: StudioWebMcpProposalProvenance
  ) => ChangeSet
  proposeDocumentGeneration?: (
    plan: GeneratedDocumentPlan,
    provenance: StudioWebMcpProposalProvenance
  ) => GeneratedDocumentPlan
  publishTemplate: (
    expected: {
      documentId: string
      revision: number
      snapshotId: string
    },
    options?: { signal?: AbortSignal }
  ) => Promise<TemplateVersion>
  renderTemplate: (
    version: TemplateVersion,
    modifications: TemplateModifications,
    selections: StudioWebMcpRenderSelection[],
    options?: { signal?: AbortSignal; idempotencyKey?: string }
  ) => Promise<StudioWebMcpRenderRecord>
}

const mutationDisabledReason = (services: StudioWebMcpServices) =>
  services.mutationDisabledReason ?? null

const assertMutationEnabled = (services: StudioWebMcpServices) => {
  const reason = mutationDisabledReason(services)
  if (reason) throw new Error(reason)
}

const assertOutputEnabled = (services: StudioWebMcpServices) => {
  const reason = services.outputDisabledReason ?? null
  if (reason) throw new Error(reason)
}

export function projectStudioWebMcpSnapshot(
  services: StudioWebMcpServices
): StudioWebMcpSnapshot {
  const {
    mutationDisabledReason: disabledReason,
    outputDisabledReason: _outputDisabledReason,
    mediaDerivations: _mediaDerivations,
    getProductCommandContext,
    runProductCommand: _runProductCommand,
    proposeChangeSet: _proposeChangeSet,
    proposeDocumentGeneration: _proposeDocumentGeneration,
    publishTemplate: _publishTemplate,
    renderTemplate: _renderTemplate,
    ...current
  } = services
  const productCommandContext = disabledReason
    ? null
    : getProductCommandContext()
  return {
    ...current,
    commandCapabilities: [],
    productCommandContext,
    assets: current.assets.map((asset) => ({
      ...asset,
      ownership: "built_in" as const,
      selectable: true,
    })),
  }
}

export function useStudioWebMcp(
  services: StudioWebMcpServices,
  { enabled = true }: { enabled?: boolean } = {}
) {
  const servicesRef = useRef(services)
  servicesRef.current = services
  const [status, setStatus] = useState<WebMcpStatus>("unavailable")
  const [error, setError] = useState<string | null>(null)
  const [registeredToolCount, setRegisteredToolCount] = useState(0)

  useEffect(() => {
    if (!enabled) {
      setStatus("unavailable")
      setError(null)
      setRegisteredToolCount(0)
      return
    }
    let active = true
    let interval = 0
    let generation = 0
    let retryAt = 0
    let observedContext: WebMcpModelContext | undefined
    let inFlight: {
      generation: number
      controller: AbortController
      catalog: ManagedWebMcpCatalog
    } | null = null
    let registered: {
      context: WebMcpModelContext
      controller: AbortController
      catalog: ManagedWebMcpCatalog
    } | null = null

    const retireRegistration = () => {
      generation += 1
      inFlight?.controller.abort(
        new DOMException("WebMCP registration was replaced.", "AbortError")
      )
      inFlight?.catalog.dispose()
      inFlight = null
      registered?.controller.abort(
        new DOMException("WebMCP registration was replaced.", "AbortError")
      )
      registered?.catalog.dispose()
      registered = null
    }

    const register = async () => {
      const modelContext = document.modelContext
      if (modelContext !== observedContext) {
        retireRegistration()
        observedContext = modelContext
        retryAt = 0
        if (!modelContext && active) {
          setStatus("unavailable")
          setError(null)
          setRegisteredToolCount(0)
        }
      }
      if (
        !active ||
        !modelContext ||
        registered?.context === modelContext ||
        inFlight ||
        Date.now() < retryAt
      ) {
        return
      }
      const attemptGeneration = generation + 1
      generation = attemptGeneration
      const controller = new AbortController()
      const registeredCatalog = createManagedWebMcpCatalog(
        servicesRef.current.assets
      )
      inFlight = {
        generation: attemptGeneration,
        controller,
        catalog: registeredCatalog,
      }
      setStatus("registering")
      setRegisteredToolCount(0)
      const timeout = window.setTimeout(
        () =>
          controller.abort(
            new DOMException(
              "WebMCP tool registration timed out.",
              "TimeoutError"
            )
          ),
        WEBMCP_REGISTRATION_TIMEOUT_MS
      )
      try {
        const toolCount = await waitForRegistration(
          registerStudioWebMcpTools(
            modelContext,
            {
              getSnapshot: () =>
                projectStudioWebMcpSnapshot(servicesRef.current),
              searchAssets: (input, signal) =>
                registeredCatalog.search(input, signal),
              resolveAsset: (assetId, signal) =>
                registeredCatalog.resolve(assetId, signal),
              mediaDerivations: servicesRef.current.mediaDerivations,
              proposeChangeSet: (changeSet, provenance) => {
                controller.signal.throwIfAborted()
                assertMutationEnabled(servicesRef.current)
                return servicesRef.current.proposeChangeSet(
                  changeSet,
                  provenance
                )
              },
              ...(servicesRef.current.proposeDocumentGeneration
                ? {
                    proposeDocumentGeneration: (plan, provenance) => {
                      controller.signal.throwIfAborted()
                      assertMutationEnabled(servicesRef.current)
                      return servicesRef.current.proposeDocumentGeneration!(
                        plan,
                        provenance
                      )
                    },
                  }
                : {}),
              runProductCommand: (invocation) => {
                controller.signal.throwIfAborted()
                const reason = mutationDisabledReason(servicesRef.current)
                return reason
                  ? { status: "disabled" as const, reason }
                  : servicesRef.current.runProductCommand(invocation)
              },
              publishTemplate: (expected, options) => {
                controller.signal.throwIfAborted()
                assertMutationEnabled(servicesRef.current)
                assertOutputEnabled(servicesRef.current)
                return servicesRef.current.publishTemplate(expected, options)
              },
              renderTemplate: (version, modifications, selections, options) => {
                controller.signal.throwIfAborted()
                assertMutationEnabled(servicesRef.current)
                return servicesRef.current.renderTemplate(
                  version,
                  modifications,
                  selections,
                  options
                )
              },
              id: () => crypto.randomUUID(),
              now: () => new Date().toISOString(),
            },
            controller.signal
          ),
          controller.signal
        )
        if (
          controller.signal.aborted ||
          generation !== attemptGeneration ||
          document.modelContext !== modelContext
        ) {
          controller.abort()
          registeredCatalog.dispose()
          return
        }
        inFlight = null
        registered = {
          context: modelContext,
          controller,
          catalog: registeredCatalog,
        }
        setStatus("ready")
        setError(null)
        setRegisteredToolCount(toolCount)
      } catch (registrationError) {
        controller.abort()
        registeredCatalog.dispose()
        if (inFlight?.generation === attemptGeneration) inFlight = null
        if (generation !== attemptGeneration) return
        retryAt = Date.now() + WEBMCP_REGISTRATION_RETRY_MS
        setStatus("error")
        setRegisteredToolCount(0)
        const caughtMessage =
          registrationError &&
          typeof registrationError === "object" &&
          "message" in registrationError &&
          typeof registrationError.message === "string"
            ? registrationError.message
            : null
        setError(caughtMessage ?? "WebMCP tools could not be registered.")
      } finally {
        window.clearTimeout(timeout)
      }
    }

    void register()
    interval = window.setInterval(() => void register(), 500)
    return () => {
      active = false
      window.clearInterval(interval)
      retireRegistration()
    }
  }, [enabled])

  return { status, error, registeredToolCount }
}
