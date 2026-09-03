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
import { createStudioWebMcpActivityStore } from "./studio-webmcp-activity"
import {
  prepareManagedMediaUpload,
  uploadManagedMedia,
} from "./managed-media-repository"

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
  runSceneTransaction?: RegisteredStudioWebMcpServices["runSceneTransaction"]
  proposeChangeSet: (
    changeSet: ChangeSet,
    provenance: StudioWebMcpProposalProvenance
  ) => ChangeSet
  proposeDocumentGeneration?: (
    plan: GeneratedDocumentPlan,
    provenance: StudioWebMcpProposalProvenance
  ) => GeneratedDocumentPlan
  inspectDocumentGenerationCandidate?: RegisteredStudioWebMcpServices["inspectDocumentGenerationCandidate"]
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

const fileExtensionFor = (
  mediaType: "image/png" | "image/jpeg" | "image/webp"
) =>
  mediaType === "image/png"
    ? "png"
    : mediaType === "image/jpeg"
      ? "jpg"
      : "webp"

const uploadWorkspaceAsset = async (
  input: Parameters<
    NonNullable<RegisteredStudioWebMcpServices["uploadAsset"]>
  >[0],
  signal?: AbortSignal
) => {
  signal?.throwIfAborted()
  const binary = atob(input.contentBase64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  const safeName =
    input.name
      .replace(/\.[A-Za-z0-9]{1,8}$/, "")
      .replace(/[^A-Za-z0-9._ -]+/g, "-")
      .trim() || "workspace-image"
  const file = new File(
    [bytes],
    `${safeName}.${fileExtensionFor(input.mediaType)}`,
    { type: input.mediaType }
  )
  const upload = uploadManagedMedia(file, {
    idempotencyKey: input.idempotencyKey,
  })
  const abort = () => upload.cancel()
  signal?.addEventListener("abort", abort, { once: true })
  try {
    return await upload.promise
  } finally {
    signal?.removeEventListener("abort", abort)
  }
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
    runSceneTransaction: _runSceneTransaction,
    proposeChangeSet: _proposeChangeSet,
    proposeDocumentGeneration: _proposeDocumentGeneration,
    inspectDocumentGenerationCandidate: _inspectDocumentGenerationCandidate,
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
  const activityStoreRef = useRef(
    null as ReturnType<typeof createStudioWebMcpActivityStore> | null
  )
  if (!activityStoreRef.current) {
    activityStoreRef.current = createStudioWebMcpActivityStore()
  }
  const activityStore = activityStoreRef.current
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
              onToolActivity: (activity) => activityStore.publish(activity),
              getSnapshot: () =>
                projectStudioWebMcpSnapshot(servicesRef.current),
              searchAssets: (input, signal) =>
                registeredCatalog.search(input, signal),
              resolveAsset: (assetId, signal) =>
                registeredCatalog.resolve(assetId, signal),
              uploadAsset: async (input, signal) => {
                controller.signal.throwIfAborted()
                assertMutationEnabled(servicesRef.current)
                const uploaded = await uploadWorkspaceAsset(input, signal)
                const asset = await registeredCatalog.resolve(
                  uploaded.id,
                  signal
                )
                if (!asset) {
                  throw new Error(
                    "The uploaded workspace asset could not be resolved."
                  )
                }
                return asset
              },
              prepareAssetUpload: async (input, signal) => {
                controller.signal.throwIfAborted()
                assertMutationEnabled(servicesRef.current)
                return prepareManagedMediaUpload(input, signal)
              },
              mediaDerivations: servicesRef.current.mediaDerivations,
              proposeChangeSet: (changeSet, provenance) => {
                controller.signal.throwIfAborted()
                assertMutationEnabled(servicesRef.current)
                return servicesRef.current.proposeChangeSet(
                  changeSet,
                  provenance
                )
              },
              runSceneTransaction: (transaction, provenance) => {
                controller.signal.throwIfAborted()
                if (transaction.mode === "commit") {
                  assertMutationEnabled(servicesRef.current)
                }
                const runner = servicesRef.current.runSceneTransaction
                if (!runner) {
                  throw new Error(
                    "Canonical canvas transactions are unavailable."
                  )
                }
                return runner(transaction, provenance)
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
              ...(servicesRef.current.inspectDocumentGenerationCandidate
                ? {
                    inspectDocumentGenerationCandidate: (identity, signal) => {
                      controller.signal.throwIfAborted()
                      return servicesRef.current
                        .inspectDocumentGenerationCandidate!(identity, signal)
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
  }, [activityStore, enabled])

  return { status, error, registeredToolCount, activityStore }
}
