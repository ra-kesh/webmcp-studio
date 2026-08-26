import { useEffect, useState } from "react"
import { Check, CircleAlert, Code2, LoaderCircle, Rocket } from "lucide-react"
import {
  getPublishReadiness,
  type Document,
  type TemplateVersion,
} from "@webmcp/document"
import { Badge } from "@webmcp/ui/components/badge"
import { Button } from "@webmcp/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@webmcp/ui/components/dialog"
import { Separator } from "@webmcp/ui/components/separator"

export function PublishDialog({
  open,
  onOpenChange,
  document,
  templateId,
  latestVersion,
  pendingChangeSet,
  publishError,
  publishSyncStatus,
  onPublish,
}: {
  open: boolean
  onOpenChange(open: boolean): void
  document: Document
  templateId: string
  latestVersion?: TemplateVersion
  pendingChangeSet: boolean
  publishError: string | null
  publishSyncStatus: "idle" | "syncing" | "synced" | "error"
  onPublish(): Promise<TemplateVersion | undefined>
}) {
  const [published, setPublished] = useState<TemplateVersion | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)

  useEffect(() => {
    if (!open) {
      setPublished(null)
      setLocalError(null)
      setPublishing(false)
    }
  }, [open])

  const readiness = getPublishReadiness(document)
  const currentVersion =
    published ??
    (latestVersion?.sourceRevision === document.revision ? latestVersion : null)
  const nextVersion = (latestVersion?.version ?? 0) + 1
  const blockingMessage = pendingChangeSet
    ? "Resolve the pending agent change set before publishing."
    : readiness.blocking[0]?.message
  const blocked = Boolean(blockingMessage)
  const syncing = publishing || publishSyncStatus === "syncing"
  const needsSync = Boolean(currentVersion && publishSyncStatus === "error")

  const handlePublish = async () => {
    setPublishing(true)
    setLocalError(null)
    try {
      const version = await onPublish()
      if (version) setPublished(version)
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "Publishing failed."
      )
    } finally {
      setPublishing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex size-8 items-center justify-center rounded-lg bg-secondary">
            {currentVersion ? (
              <Check className="size-4" />
            ) : (
              <Rocket className="size-4" />
            )}
          </div>
          <DialogTitle>
            {needsSync
              ? `Version ${currentVersion?.version} needs to sync`
              : currentVersion
                ? `Version ${currentVersion.version} is published`
                : `Publish version ${nextVersion}`}
          </DialogTitle>
          <DialogDescription>
            {needsSync
              ? "The immutable snapshot is safe locally, but the API publishing service has not accepted it yet."
              : currentVersion
                ? "This immutable snapshot is ready for API rendering."
                : "Freeze the current document and its public parameter manifest for API use."}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border">
          <div className="grid grid-cols-3 gap-3 p-3">
            <div>
              <p className="text-[10px] text-muted-foreground">Source</p>
              <p className="mt-1 text-xs font-medium">
                Revision {document.revision}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Outputs</p>
              <p className="mt-1 text-xs font-medium">
                {document.outputs.length}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Parameters</p>
              <p className="mt-1 text-xs font-medium">
                {document.fields.length}
              </p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center gap-2 p-3">
            <Code2 className="size-3.5 text-muted-foreground" />
            <p className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
              {currentVersion?.templateId ??
                latestVersion?.templateId ??
                templateId}
            </p>
            {currentVersion ? (
              <Badge variant="secondary">
                {syncing ? "Syncing" : needsSync ? "Local only" : "Immutable"}
              </Badge>
            ) : null}
          </div>
        </div>

        {blocked || localError || publishError ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-[11px] leading-relaxed text-destructive"
          >
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>{localError ?? publishError ?? blockingMessage}</span>
          </div>
        ) : readiness.warnings.length ? (
          <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-[11px] leading-relaxed text-muted-foreground">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {readiness.warnings.length} layout warning
              {readiness.warnings.length === 1 ? "" : "s"} will be recorded with
              this version. They do not block rendering.
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-[11px] text-muted-foreground">
            <Check className="size-3.5" />
            Validation passed. The snapshot is ready to publish.
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={publishing}>
              {currentVersion ? "Done" : "Cancel"}
            </Button>
          </DialogClose>
          {!currentVersion || needsSync ? (
            <Button
              disabled={blocked || syncing}
              onClick={() => void handlePublish()}
            >
              {syncing ? (
                <LoaderCircle
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <Rocket data-icon="inline-start" />
              )}
              {syncing
                ? "Publishing…"
                : needsSync
                  ? "Retry API sync"
                  : `Publish version ${nextVersion}`}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
