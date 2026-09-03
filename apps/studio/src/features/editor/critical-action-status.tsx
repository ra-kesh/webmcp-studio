import { AlertTriangle, LoaderCircle } from "lucide-react"
import type { CriticalActionLifecycle } from "./use-critical-action-owner"
import { Button } from "@webmcp/ui/components/button"

export type StudioCriticalAction =
  | "home"
  | "import-json"
  | "import-quotation"
  | "export-json"
  | "export-figma"
  | "export-interchange"
  | "export-png"
  | "export-pdf"

type VisibleAction = Extract<
  StudioCriticalAction,
  | `export-${"figma" | "interchange" | "png" | "pdf"}`
  | `import-${"json" | "quotation"}`
>

const actionLabel: Record<VisibleAction, string> = {
  "export-figma": "Figma handoff",
  "export-interchange": "Studio package download",
  "export-png": "PNG export",
  "export-pdf": "PDF export",
  "import-json": "Document import",
  "import-quotation": "Quotation import",
}

const isVisibleAction = (
  action: StudioCriticalAction
): action is VisibleAction =>
  action === "export-png" ||
  action === "export-figma" ||
  action === "export-interchange" ||
  action === "export-pdf" ||
  action === "import-json" ||
  action === "import-quotation"

export function CriticalActionStatus({
  lifecycle,
  onCancel,
  onRetry,
}: {
  lifecycle: CriticalActionLifecycle<StudioCriticalAction>
  onCancel: () => void
  onRetry: () => void
}) {
  if (lifecycle.status === "idle" || !isVisibleAction(lifecycle.action)) {
    return <div hidden data-testid="critical-action-status" />
  }

  const running = lifecycle.status === "running"
  const cancelling = lifecycle.status === "cancelling"
  const active = running || cancelling
  const label = actionLabel[lifecycle.action]
  const importing = lifecycle.action.startsWith("import-")
  return (
    <section
      aria-atomic="true"
      aria-live={active ? "polite" : "assertive"}
      className="fixed top-3 right-3 z-80 flex w-[min(24rem,calc(100vw-1.5rem))] items-center gap-3 rounded-lg border bg-popover px-3 py-2.5 text-popover-foreground shadow-lg"
      data-testid="critical-action-status"
      role={active ? "status" : "alert"}
    >
      {active ? (
        <LoaderCircle className="size-4 shrink-0 animate-spin" />
      ) : (
        <AlertTriangle className="size-4 shrink-0 text-destructive" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {running
            ? `${label} in progress`
            : cancelling
              ? `Stopping ${label}`
              : `${label} stopped`}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {running
            ? importing
              ? lifecycle.cancelable
                ? "Reading and validating the selected file…"
                : "Saving the validated document to this browser…"
              : "Preparing the current saved document…"
            : cancelling
              ? lifecycle.reason === "timed_out"
                ? "The deadline passed. Waiting for owned work to stop…"
                : "Waiting for owned work to stop…"
              : lifecycle.message}
        </p>
      </div>
      {running && lifecycle.cancelable ? (
        <Button size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      ) : !active && lifecycle.retryable ? (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </section>
  )
}
