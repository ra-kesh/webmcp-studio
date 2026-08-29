import { Download, FileWarning, LoaderCircle } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@webmcp/ui/components/alert-dialog"
import { Button } from "@webmcp/ui/components/button"

export function ReplaceCurrentDraftDialog({
  open,
  documentName,
  nextActionLabel,
  sessionOnly = false,
  replacing,
  error,
  onCancel,
  onDownload,
  onReplace,
}: {
  open: boolean
  documentName: string
  nextActionLabel: string
  sessionOnly?: boolean
  replacing: boolean
  error?: string | null
  onCancel: () => void
  onDownload: () => void
  onReplace: () => void
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !replacing) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <FileWarning aria-hidden="true" />
          </AlertDialogMedia>
          <AlertDialogTitle>Replace current browser draft?</AlertDialogTitle>
          <AlertDialogDescription>
            {sessionOnly ? (
              <>
                “{documentName}” exists only in this tab because browser storage
                is unavailable. {nextActionLabel} will replace it and cannot be
                undone from the new document.
              </>
            ) : (
              <>
                “{documentName}” is the only draft stored in this browser.{" "}
                {nextActionLabel} will replace it and cannot be undone from the
                new document.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="rounded-md border bg-muted/40 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
          {sessionOnly
            ? "Download the current Studio JSON before continuing if you need to keep this session-only work."
            : "Download the current Studio JSON first if you want to keep a separate copy."}
        </div>
        {error ? (
          <p
            className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-xs leading-5 text-destructive"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <AlertDialogFooter className="sm:flex-wrap">
          <AlertDialogCancel disabled={replacing}>Cancel</AlertDialogCancel>
          <Button disabled={replacing} variant="outline" onClick={onDownload}>
            <Download data-icon="inline-start" />
            Download current JSON
          </Button>
          <AlertDialogAction
            disabled={replacing}
            variant="destructive"
            onClick={(event) => {
              event.preventDefault()
              onReplace()
            }}
          >
            {replacing ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : null}
            Replace
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
