import { useEffect, useRef, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { Button } from "@webmcp/ui/components/button"
import { LoaderCircle } from "lucide-react"
import { z } from "zod"
import { createCompositionHandoffDocument } from "../../../features/editor/composition-handoff-document"
import { useStudioPersistence } from "../../../features/persistence/studio-persistence-provider"
import { compositionHandoffV1Schema } from "../../../server/composition-handoff"

export const Route = createFileRoute("/_studio/composition-handoffs/$token")({
  component: CompositionHandoffRoute,
})

type RouteState =
  { status: "waiting" | "creating" } | { status: "failed"; message: string }

const handoffResponseSchema = z.object({
  data: z.object({ handoff: z.unknown() }),
})

async function readHandoff(token: string) {
  const path = `/v1/studio/composition-handoffs/${encodeURIComponent(token)}`
  let response = await fetch(path, { cache: "no-store" })
  if (response.status === 401) {
    const session = await fetch("/v1/studio/session/demo", {
      method: "POST",
    })
    if (session.ok) response = await fetch(path, { cache: "no-store" })
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string }
    } | null
    throw new Error(
      body?.error?.message ??
        "Studio could not open this document. Request a new editor link."
    )
  }
  const body = handoffResponseSchema.parse(await response.json())
  return compositionHandoffV1Schema.parse(body.data.handoff)
}

function CompositionHandoffRoute() {
  const { token } = Route.useParams()
  const navigate = Route.useNavigate()
  const persistence = useStudioPersistence()
  const startedFor = useRef<string | null>(null)
  const [state, setState] = useState<RouteState>({ status: "waiting" })

  useEffect(() => {
    if (persistence.state.status === "opening") return
    if (persistence.state.status !== "ready") {
      setState({
        status: "failed",
        message: "Studio browser storage is unavailable on this device.",
      })
      return
    }
    if (startedFor.current === token) return
    startedFor.current = token
    let active = true
    setState({ status: "creating" })
    void readHandoff(token)
      .then(createCompositionHandoffDocument)
      .then((snapshot) => persistence.repository.create(snapshot))
      .then(async (result) => {
        if (!active) return
        if (!result.ok) {
          throw new Error(
            result.reason === "exists"
              ? "Studio generated a duplicate document identity. Request a new editor link."
              : "failure" in result
                ? result.failure.message
                : "Studio could not save the imported document."
          )
        }
        await navigate({
          params: { documentId: result.record.summary.documentId },
          replace: true,
          to: "/documents/$documentId",
        })
      })
      .catch((error: unknown) => {
        if (!active) return
        setState({
          status: "failed",
          message:
            error instanceof Error
              ? error.message
              : "Studio could not create this document.",
        })
      })
    return () => {
      active = false
    }
  }, [navigate, persistence, token])

  if (state.status === "failed") {
    return (
      <main className="grid min-h-dvh place-items-center bg-muted/20 p-4">
        <section
          className="w-full max-w-sm border bg-background p-5 text-center shadow-sm"
          role="alert"
        >
          <h1 className="text-base font-semibold">Could not open document</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {state.message}
          </p>
          <Button
            className="mt-4"
            variant="outline"
            onClick={() => void navigate({ to: "/" })}
          >
            Return to documents
          </Button>
        </section>
      </main>
    )
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-muted/20 p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        Creating an editable document
      </div>
    </main>
  )
}
