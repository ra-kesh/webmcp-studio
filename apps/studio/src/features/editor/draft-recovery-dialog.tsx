import { Download, RefreshCcw, ShieldAlert, Trash2 } from "lucide-react"
import { Button } from "@webmcp/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@webmcp/ui/components/dialog"
import type { DraftRecoveryRecord } from "./draft-recovery"

const failureLabels = {
  malformed_json: "Unreadable JSON",
  schema_invalid: "Incompatible draft schema",
  migration_failed: "Migration stopped",
  aggregate_invalid: "Invalid document relationships",
} satisfies Record<DraftRecoveryRecord["failure"]["kind"], string>

export function DraftRecoveryDialog({
  recovery,
  notice,
  onDownload,
  onRetry,
  onReset,
}: {
  recovery: DraftRecoveryRecord | null
  notice: string | null
  onDownload: () => void
  onRetry: () => void
  onReset: () => void
}) {
  return (
    <Dialog open={Boolean(recovery)} onOpenChange={() => undefined}>
      <DialogContent
        aria-describedby="draft-recovery-description"
        className="gap-0 overflow-hidden p-0 sm:max-w-lg"
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="border-b px-5 py-4 pr-5">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <ShieldAlert aria-hidden="true" />
            </span>
            <div className="flex min-w-0 flex-col gap-1.5">
              <DialogTitle>Draft recovery required</DialogTitle>
              <DialogDescription id="draft-recovery-description">
                Studio stopped before autosave because the local draft could not
                be opened safely.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {recovery ? (
          <div className="flex flex-col gap-4 px-5 py-5">
            <div className="rounded-lg border bg-muted/40 px-4 py-3">
              <p className="text-xs font-medium text-foreground">
                {failureLabels[recovery.failure.kind]}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {recovery.failure.message}
              </p>
            </div>

            <div className="flex flex-col gap-2 text-xs leading-relaxed text-muted-foreground">
              <p>
                The original bytes are still stored unchanged. Studio will not
                save the starter or any edits over them until you choose what to
                do.
              </p>
              <p>
                Download the original first if the draft contains work you may
                need to repair in a newer build or with support.
              </p>
            </div>
            {notice ? (
              <p
                className="rounded-md bg-muted px-3 py-2 text-xs text-foreground"
                role="status"
                aria-live="polite"
              >
                {notice}
              </p>
            ) : null}
          </div>
        ) : null}

        <DialogFooter className="m-0 flex-col-reverse sm:flex-row sm:items-center sm:justify-between">
          <Button variant="destructive" onClick={onReset}>
            <Trash2 data-icon="inline-start" />
            Reset to starter
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={onDownload}>
              <Download data-icon="inline-start" />
              Download original
            </Button>
            <Button variant="secondary" onClick={onRetry}>
              <RefreshCcw data-icon="inline-start" />
              Try recovery again
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
