import { useEffect, useRef, useState } from "react"
import type {
  ChangeSet,
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

type StudioWebMcpServices = Omit<
  StudioWebMcpSnapshot,
  "assets" | "commandCapabilities" | "productCommandContext"
> & {
  assets: readonly StudioAsset[]
  getProductCommandContext: () => ProductCommandRuntimeContext | null
  runProductCommand: (
    invocation: ProductCommandInvocation
  ) => ProductCommandRunResult
  proposeChangeSet: (changeSet: ChangeSet) => ChangeSet
  publishTemplate: () => Promise<TemplateVersion>
  renderTemplate: (
    version: TemplateVersion,
    modifications: TemplateModifications,
    selections: StudioWebMcpRenderSelection[]
  ) => Promise<StudioWebMcpRenderRecord>
}

export function projectStudioWebMcpSnapshot(
  services: StudioWebMcpServices
): StudioWebMcpSnapshot {
  const {
    getProductCommandContext,
    runProductCommand: _runProductCommand,
    proposeChangeSet: _proposeChangeSet,
    publishTemplate: _publishTemplate,
    renderTemplate: _renderTemplate,
    ...current
  } = services
  const productCommandContext = getProductCommandContext()
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
    const controller = new AbortController()
    let active = true
    let registrationStarted = false
    let interval = 0
    let catalog: ManagedWebMcpCatalog | null = null

    const register = async () => {
      const modelContext = document.modelContext
      if (!modelContext || registrationStarted || controller.signal.aborted) {
        return
      }
      registrationStarted = true
      const registeredCatalog = createManagedWebMcpCatalog(
        servicesRef.current.assets
      )
      catalog = registeredCatalog
      setStatus("registering")
      setRegisteredToolCount(0)
      try {
        const toolCount = await registerStudioWebMcpTools(
          modelContext,
          {
            getSnapshot: () => projectStudioWebMcpSnapshot(servicesRef.current),
            searchAssets: (input) => registeredCatalog.search(input),
            resolveAsset: (assetId) => registeredCatalog.resolve(assetId),
            proposeChangeSet: (changeSet) =>
              servicesRef.current.proposeChangeSet(changeSet),
            runProductCommand: (invocation) =>
              servicesRef.current.runProductCommand(invocation),
            publishTemplate: () => servicesRef.current.publishTemplate(),
            renderTemplate: (version, modifications, selections) =>
              servicesRef.current.renderTemplate(
                version,
                modifications,
                selections
              ),
            id: () => crypto.randomUUID(),
            now: () => new Date().toISOString(),
          },
          controller.signal
        )
        if (!active) return
        window.clearInterval(interval)
        setStatus("ready")
        setError(null)
        setRegisteredToolCount(toolCount)
      } catch (registrationError) {
        controller.abort()
        registeredCatalog.dispose()
        if (catalog === registeredCatalog) catalog = null
        if (!active) return
        window.clearInterval(interval)
        setStatus("error")
        setRegisteredToolCount(0)
        setError(
          registrationError instanceof Error
            ? registrationError.message
            : "WebMCP tools could not be registered."
        )
      }
    }

    void register()
    interval = window.setInterval(() => void register(), 500)
    return () => {
      active = false
      window.clearInterval(interval)
      controller.abort()
      catalog?.dispose()
    }
  }, [enabled])

  return { status, error, registeredToolCount }
}
