import { useEffect, useRef, useState } from "react"
import type { ChangeSet } from "@webmcp/document"
import {
  registerStudioWebMcpTools,
  type StudioWebMcpSnapshot,
  type WebMcpModelContext,
} from "@webmcp/webmcp"

declare global {
  interface Document {
    modelContext?: WebMcpModelContext
  }
}

type WebMcpStatus = "unavailable" | "registering" | "ready" | "error"

type StudioWebMcpServices = StudioWebMcpSnapshot & {
  proposeChangeSet(changeSet: ChangeSet): ChangeSet
}

export function useStudioWebMcp(services: StudioWebMcpServices) {
  const servicesRef = useRef(services)
  servicesRef.current = services
  const [status, setStatus] = useState<WebMcpStatus>("unavailable")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let registrationStarted = false
    let interval = 0

    const register = async () => {
      const modelContext = document.modelContext
      if (!modelContext || registrationStarted || controller.signal.aborted) {
        return
      }
      registrationStarted = true
      setStatus("registering")
      try {
        await registerStudioWebMcpTools(
          modelContext,
          {
            getSnapshot: () => servicesRef.current,
            proposeChangeSet: (changeSet) =>
              servicesRef.current.proposeChangeSet(changeSet),
            id: () => crypto.randomUUID(),
            now: () => new Date().toISOString(),
          },
          controller.signal
        )
        if (controller.signal.aborted) return
        window.clearInterval(interval)
        setStatus("ready")
        setError(null)
      } catch (registrationError) {
        if (controller.signal.aborted) return
        window.clearInterval(interval)
        setStatus("error")
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
      window.clearInterval(interval)
      controller.abort()
    }
  }, [])

  return { status, error, registeredToolCount: status === "ready" ? 3 : 0 }
}
