import { useEffect, useRef, useState } from "react"
import { AlertTriangle, Download, Files, RefreshCcw } from "lucide-react"
import { Button } from "@webmcp/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@webmcp/ui/components/dialog"
import type { DocumentConflictModel } from "./document-conflict-model"

export type DocumentConflictDialogProps = Readonly<{
  model: DocumentConflictModel
  onDownload: () => boolean | void
  onReload: () => void | Promise<void>
  onSaveCopy: () => void | Promise<void>
  onReturnHome?: () => void | Promise<void>
}>

const isVisible = (model: DocumentConflictModel) =>
  model.status === "external_change" ||
  model.status === "conflict" ||
  model.status === "recovery_required"

export function DocumentConflictDialog({
  model,
  onDownload,
  onReload,
  onSaveCopy,
  onReturnHome,
}: DocumentConflictDialogProps) {
  const [open, setOpen] = useState(() => isVisible(model))
  const [confirmingReload, setConfirmingReload] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const previousIdentityRef = useRef("")
  const identity =
    model.status === "conflict"
      ? `${model.documentId}:${model.identity.conflictId}:${model.identity.candidateDraftSnapshotId}`
      : model.status === "none"
        ? ""
        : `${model.documentId}:${model.status}`

  useEffect(() => {
    if (!identity || identity === previousIdentityRef.current) return
    previousIdentityRef.current = identity
    setConfirmingReload(false)
    setOpen(true)
  }, [identity])

  if (!isVisible(model)) return null

  const busy = model.operation.status === "running"
  const deleted =
    (model.status === "conflict" && model.reason === "deleted_elsewhere") ||
    (model.status === "external_change" && model.reason === "deleted_elsewhere")
  const recoveryRequired = model.status === "recovery_required"
  const savedCopyReady =
    model.operation.status === "failed" &&
    model.operation.action === "save_copy" &&
    Boolean(model.operation.createdDocumentId)
  const heading = model.heading
  const detail = model.detail

  return (
    <>
      {!open ? (
        <section
          aria-labelledby="document-conflict-banner-heading"
          className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-2xl items-center gap-3 border border-destructive/40 bg-background px-3 py-2.5 shadow-lg min-[640px]:inset-x-auto min-[640px]:right-4 min-[640px]:bottom-4 min-[640px]:left-auto min-[640px]:w-[28rem]"
        >
          <AlertTriangle
            aria-hidden="true"
            className="size-4 shrink-0 text-destructive"
          />
          <div className="min-w-0 flex-1">
            <h2
              className="truncate text-sm font-medium"
              id="document-conflict-banner-heading"
            >
              {heading}
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              Recovery is still required before you leave.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Review
          </Button>
        </section>
      ) : null}

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen)
          if (!nextOpen) setConfirmingReload(false)
        }}
      >
        <DialogContent
          className="gap-0 overflow-hidden p-0 sm:max-w-[31rem]"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            headingRef.current?.focus()
          }}
          onEscapeKeyDown={() => setConfirmingReload(false)}
        >
          <DialogHeader className="border-b px-5 py-5 text-left">
            <div className="mb-3 flex size-9 items-center justify-center border bg-destructive/5 text-destructive">
              <AlertTriangle aria-hidden="true" className="size-4" />
            </div>
            <DialogTitle ref={headingRef} tabIndex={-1}>
              {heading}
            </DialogTitle>
            <DialogDescription className="pt-1 leading-6">
              {detail}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-5 py-4">
            {model.status === "conflict" ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                <dt className="text-muted-foreground">Reason</dt>
                <dd className="text-right font-medium">{model.reasonLabel}</dd>
                <dt className="text-muted-foreground">Detected</dt>
                <dd className="text-right font-medium">
                  {new Date(model.detectedAt).toLocaleString()}
                </dd>
              </dl>
            ) : null}

            {confirmingReload ? (
              <section
                aria-labelledby="confirm-reload-heading"
                className="border border-destructive/30 bg-destructive/5 p-3"
              >
                <h3 className="text-sm font-medium" id="confirm-reload-heading">
                  {deleted
                    ? "Accept the deletion?"
                    : "Replace the open version?"}
                </h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {deleted
                    ? "Your preserved version remains downloadable. The document will stay in Trash."
                    : "The editor will load the saved version. Download your version first if you want a separate file."}
                </p>
                <div className="mt-3 flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmingReload(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant={deleted ? "destructive" : "default"}
                    onClick={() => void onReload()}
                  >
                    {deleted ? "Accept deletion" : "Load saved version"}
                  </Button>
                </div>
              </section>
            ) : null}

            {model.operation.status === "running" ? (
              <p
                aria-live="polite"
                className="text-sm text-muted-foreground"
                role="status"
              >
                {model.operation.message}
              </p>
            ) : model.operation.status === "failed" ? (
              <p className="text-sm text-destructive" role="alert">
                {model.operation.message}
              </p>
            ) : null}
          </div>

          <DialogFooter className="border-t bg-muted/20 px-5 py-4 sm:flex-col sm:items-stretch">
            <Button
              className="justify-start"
              disabled={busy}
              variant="outline"
              onClick={() => void onDownload()}
            >
              <Download data-icon="inline-start" />
              Download my version
            </Button>
            {recoveryRequired ? (
              onReturnHome ? (
                <Button
                  className="justify-start"
                  disabled={busy}
                  variant="outline"
                  onClick={() => void onReturnHome()}
                >
                  Return to documents
                </Button>
              ) : null
            ) : (
              <>
                <Button
                  className="justify-start"
                  disabled={busy}
                  variant="outline"
                  onClick={() => void onSaveCopy()}
                >
                  <Files data-icon="inline-start" />
                  {savedCopyReady
                    ? "Open saved copy"
                    : "Save my changes as a copy"}
                </Button>
                <Button
                  className="justify-start"
                  disabled={busy}
                  variant="ghost"
                  onClick={() => setConfirmingReload(true)}
                >
                  <RefreshCcw data-icon="inline-start" />
                  {deleted ? "Accept deletion" : "Reload saved version"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
