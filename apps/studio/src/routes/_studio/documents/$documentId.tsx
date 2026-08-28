import { useEffect, useMemo, useRef, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { Button } from "@webmcp/ui/components/button"
import { LoaderCircle } from "lucide-react"
import { StudioShell } from "../../../features/studio-shell"
import { documentPath } from "../../../features/editor/document-route"
import type { DocumentLibraryNoticeSearch } from "../../../features/editor/document-route"
import type { DocumentRouteAdmission } from "../../../features/editor/document-route-admission"
import { useStudioPersistence } from "../../../features/persistence/studio-persistence-provider"

export const Route = createFileRoute("/_studio/documents/$documentId")({
  component: StudioDocumentRoute,
})

type RouteState =
  | Readonly<{ status: "waiting" | "admitting" }>
  | Readonly<{
      status: "opened"
      admission: Extract<DocumentRouteAdmission, { status: "opened" }>
    }>
  | Readonly<{ status: "failed"; message: string }>

const redirectSearchFor = (
  result: Exclude<DocumentRouteAdmission, { status: "opened" | "superseded" }>
): DocumentLibraryNoticeSearch => {
  switch (result.status) {
    case "missing":
      return { notice: "document_missing", documentId: result.documentId }
    case "deleted":
      return { notice: "document_deleted", documentId: result.documentId }
    case "recovery_required":
      return {
        notice: "document_recovery_required",
        documentId: result.documentId,
      }
    case "unavailable":
      return {
        notice: "document_unavailable",
        documentId: result.documentId,
      }
  }
}

function StudioDocumentRoute() {
  const { documentId } = Route.useParams()
  return (
    <StudioDocumentRouteSession key={documentId} routeDocumentId={documentId} />
  )
}

function StudioDocumentRouteSession({
  routeDocumentId,
}: {
  routeDocumentId: string
}) {
  const persistence = useStudioPersistence()
  const navigate = Route.useNavigate()
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<RouteState>({ status: "waiting" })
  const admissionErrorHeadingRef = useRef<HTMLHeadingElement>(null)
  const routeIdentity = useMemo(
    () => documentPath(routeDocumentId),
    [routeDocumentId]
  )
  const activeRouteDocumentId = routeIdentity.ok
    ? routeIdentity.documentId
    : null

  useEffect(() => {
    if (state.status !== "failed") return
    admissionErrorHeadingRef.current?.focus()
  }, [state])

  useEffect(() => {
    if (!routeIdentity.ok) {
      void navigate({
        replace: true,
        search: { notice: "invalid_document_route" },
        to: "/",
      })
      return
    }
    if (persistence.state.status === "opening") {
      setState({ status: "waiting" })
      return
    }
    if (persistence.state.status !== "ready") {
      void navigate({
        replace: true,
        search: {
          notice:
            persistence.state.status === "recovery_required"
              ? "document_recovery_required"
              : "document_unavailable",
          documentId: routeIdentity.documentId,
        },
        to: "/",
      })
      return
    }

    const controller = persistence.documentRouteAdmission
    let active = true
    setState({ status: "admitting" })
    void controller
      .admit(routeIdentity.documentId)
      .then(async (result) => {
        if (!active || result.status === "superseded") return
        if (result.status === "opened") {
          setState({ status: "opened", admission: result })
          return
        }
        await navigate({
          replace: true,
          search: redirectSearchFor(result),
          to: "/",
        })
      })
      .catch((error: unknown) => {
        if (!active) return
        setState({
          status: "failed",
          message:
            error instanceof Error
              ? error.message
              : "Studio could not verify this local document.",
        })
      })
    return () => {
      active = false
      controller.supersede()
    }
  }, [attempt, navigate, persistence, routeIdentity])

  const navigateToDocument = async (documentId: string) => {
    const target = documentPath(documentId)
    if (!target.ok) return false
    if (documentId === activeRouteDocumentId) return true
    await navigate({
      params: { documentId },
      to: "/documents/$documentId",
    })
    return true
  }

  if (state.status === "failed") {
    return (
      <main className="grid min-h-dvh place-items-center bg-muted/20 p-4">
        <section
          aria-labelledby="document-admission-error-heading"
          className="w-full max-w-sm border bg-background p-5 text-center shadow-sm"
          role="alert"
        >
          <h1
            className="text-base font-semibold"
            id="document-admission-error-heading"
            ref={admissionErrorHeadingRef}
            tabIndex={-1}
          >
            Studio could not verify this document
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {state.message}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button onClick={() => setAttempt((current) => current + 1)}>
              Retry
            </Button>
            <Button
              variant="outline"
              onClick={() => void navigate({ to: "/" })}
            >
              Return to documents
            </Button>
          </div>
        </section>
      </main>
    )
  }

  if (state.status !== "opened") {
    return (
      <main
        aria-busy="true"
        className="grid min-h-dvh place-items-center bg-muted/20"
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          <span>Verifying the document…</span>
        </div>
      </main>
    )
  }

  const documentId = state.admission.record.summary.documentId
  return (
    <StudioShell
      key={documentId}
      initialDocumentRecord={state.admission.record}
      initialDocumentWarning={state.admission.warning?.message ?? null}
      routeDocumentId={documentId}
      onHome={() => navigate({ to: "/" })}
      onSessionOpened={navigateToDocument}
    />
  )
}
