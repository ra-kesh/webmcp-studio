import { useEffect, useMemo, useRef, useState } from "react"
import { Check, CircleAlert, Code2, LoaderCircle, Send } from "lucide-react"
import { getPublishReadiness } from "@webmcp/document"
import type { Document, TemplateVersion } from "@webmcp/document"
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
import { studioAssetFieldPublicationIssues } from "./asset-catalog"

export function PublishDialog({
  open,
  onOpenChange,
  document,
  documentSnapshotId,
  templateId,
  latestVersion,
  currentSnapshotVersion,
  pendingChangeSet,
  outputDisabledReason,
  publishError,
  publishSyncStatus,
  onPublish,
  onCancelPublish,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  document: Document
  documentSnapshotId: string | null
  templateId: string
  latestVersion?: TemplateVersion
  currentSnapshotVersion?: TemplateVersion
  pendingChangeSet: boolean
  outputDisabledReason?: string | null
  publishError: string | null
  publishSyncStatus:
    "idle" | "syncing" | "cancelling" | "synced" | "status_unknown" | "error"
  onPublish: () => Promise<TemplateVersion | undefined>
  onCancelPublish: () => boolean
}) {
  const [published, setPublished] = useState<TemplateVersion | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const requestGenerationRef = useRef(0)
  const openRef = useRef(open)
  const identityRef = useRef({
    documentId: document.id,
    documentSnapshotId,
  })
  openRef.current = open
  identityRef.current = { documentId: document.id, documentSnapshotId }

  useEffect(() => {
    if (!open) {
      requestGenerationRef.current += 1
      setPublished(null)
      setLocalError(null)
      setPublishing(false)
    }
  }, [open])

  useEffect(() => {
    requestGenerationRef.current += 1
    setPublished(null)
    setLocalError(null)
    setPublishing(false)
  }, [document.id, documentSnapshotId])

  const readiness = useMemo(() => getPublishReadiness(document), [document])
  const studioAssetIssues = useMemo(
    () => studioAssetFieldPublicationIssues(document),
    [document]
  )
  const currentVersion =
    published ??
    (currentSnapshotVersion?.sourceSnapshotId === documentSnapshotId
      ? currentSnapshotVersion
      : null)
  const nextVersion = (latestVersion?.version ?? 0) + 1
  const blockingMessage =
    outputDisabledReason ??
    (pendingChangeSet
      ? "Resolve the pending agent change set before publishing."
      : (readiness.blocking[0]?.message ?? studioAssetIssues[0]?.message))
  const blocked = Boolean(blockingMessage)
  const syncing =
    publishing ||
    publishSyncStatus === "syncing" ||
    publishSyncStatus === "cancelling"
  const needsSync = Boolean(
    currentVersion &&
    (publishSyncStatus === "error" || publishSyncStatus === "status_unknown")
  )

  const handlePublish = async () => {
    const requestGeneration = requestGenerationRef.current + 1
    requestGenerationRef.current = requestGeneration
    const identity = identityRef.current
    setPublishing(true)
    setLocalError(null)
    try {
      const version = await onPublish()
      if (
        version &&
        openRef.current &&
        requestGenerationRef.current === requestGeneration &&
        identityRef.current.documentId === identity.documentId &&
        identityRef.current.documentSnapshotId === identity.documentSnapshotId
      ) {
        setPublished(version)
      }
    } catch (error) {
      if (
        openRef.current &&
        requestGenerationRef.current === requestGeneration &&
        identityRef.current.documentId === identity.documentId &&
        identityRef.current.documentSnapshotId === identity.documentSnapshotId
      ) {
        setLocalError(
          error instanceof Error ? error.message : "Publishing failed."
        )
      }
    } finally {
      if (requestGenerationRef.current === requestGeneration) {
        setPublishing(false)
      }
    }
  }

  const requestOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && syncing) {
      onCancelPublish()
      return
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={requestOpenChange}>
      <DialogContent data-testid="publish-dialog" className="sm:max-w-md">
        <DialogHeader>
          <div className="flex size-8 items-center justify-center rounded-lg bg-secondary">
            {currentVersion ? (
              <Check className="size-4" />
            ) : (
              <Send className="size-4" />
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
              <p className="text-[11px] text-muted-foreground">Source</p>
              <p className="mt-1 text-xs font-medium">
                Revision {document.revision}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">Outputs</p>
              <p className="mt-1 text-xs font-medium">
                {document.outputs.length}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">Parameters</p>
              <p className="mt-1 text-xs font-medium">
                {document.fields.length}
              </p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center gap-2 p-3">
            <Code2 className="size-3.5 text-muted-foreground" />
            <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
              {currentVersion?.templateId ??
                latestVersion?.templateId ??
                templateId}
            </p>
            {currentVersion ? (
              <Badge variant="secondary">
                {syncing
                  ? "Syncing"
                  : publishSyncStatus === "status_unknown"
                    ? "Status unknown"
                    : needsSync
                      ? "Local only"
                      : "Immutable"}
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
            <Button variant="outline" disabled={syncing}>
              {currentVersion ? "Done" : "Cancel"}
            </Button>
          </DialogClose>
          {!currentVersion || needsSync ? (
            <Button
              disabled={
                publishSyncStatus === "cancelling" || (!syncing && blocked)
              }
              onClick={() => {
                if (syncing) onCancelPublish()
                else void handlePublish()
              }}
            >
              {syncing ? (
                <LoaderCircle
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <Send data-icon="inline-start" />
              )}
              {publishSyncStatus === "cancelling"
                ? "Stopping…"
                : syncing
                  ? "Cancel publishing"
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
