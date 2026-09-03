import { useMemo, useState } from "react"
import {
  ArrowRight,
  Check,
  DatabaseZap,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@webmcp/ui/components/alert-dialog"
import { Badge } from "@webmcp/ui/components/badge"
import { Button } from "@webmcp/ui/components/button"
import { ScrollArea } from "@webmcp/ui/components/scroll-area"
import { Separator } from "@webmcp/ui/components/separator"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@webmcp/ui/components/toggle-group"
import type { QuotationRefreshConflictPolicy } from "@webmcp/document"
import type { PendingQuotationRefresh } from "./quotation-refresh-journal"

const propertyLabel = (property: string) =>
  property
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .toLowerCase()

export function QuotationRefreshDialog({
  open,
  pending,
  error,
  onOpenChange,
  onChooseConflict,
  onAccept,
  onReject,
}: {
  open: boolean
  pending: PendingQuotationRefresh | null
  error: string | null
  onOpenChange: (open: boolean) => void
  onChooseConflict: (
    semanticKey: string,
    choice: QuotationRefreshConflictPolicy
  ) => Promise<boolean>
  onAccept: () => Promise<boolean>
  onReject: () => Promise<boolean>
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const conflicts = useMemo(() => {
    if (!pending) return []
    return [...pending.impact.conflicts].sort((left, right) =>
      left.layerName.localeCompare(right.layerName)
    )
  }, [pending])
  if (!pending) return null
  const unresolvedCount = new Set(
    conflicts
      .map((conflict) => conflict.semanticKey)
      .filter((semanticKey) => !pending.collisionChoices[semanticKey])
  ).size
  const run = async (action: "accept" | "reject") => {
    if (busy) return
    setBusy(action)
    try {
      const completed = await (action === "accept" ? onAccept() : onReject())
      if (completed) onOpenChange(false)
    } finally {
      setBusy(null)
    }
  }
  const choose = async (
    semanticKey: string,
    choice: QuotationRefreshConflictPolicy
  ) => {
    if (busy) return
    setBusy(`choice:${semanticKey}`)
    try {
      await onChooseConflict(semanticKey, choice)
    } finally {
      setBusy(null)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-h-[min(820px,calc(100dvh-32px))] max-w-[min(720px,calc(100vw-32px))] grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-[720px]">
        <div className="p-5 sm:p-6">
          <AlertDialogHeader className="place-items-start text-left sm:place-items-start">
            <AlertDialogMedia className="mb-3 bg-primary text-primary-foreground">
              <DatabaseZap aria-hidden="true" />
            </AlertDialogMedia>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <AlertDialogTitle>Review source changes</AlertDialogTitle>
              <Badge
                aria-label={`Revision ${pending.base.sourceRevision} to ${pending.incoming.sourceRevision}`}
                variant="secondary"
              >
                Revision {pending.base.sourceRevision}
                <ArrowRight aria-hidden="true" data-icon="inline-start" />
                {pending.incoming.sourceRevision}
              </Badge>
            </div>
            <AlertDialogDescription className="max-w-[62ch] text-left">
              Studio compared the saved source, your current design, and the
              incoming source. Upstream-only changes are ready. Your canvas
              edits stay in place unless you choose the source value below.
            </AlertDialogDescription>
          </AlertDialogHeader>
        </div>

        <Separator />
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-6 p-5 sm:p-6">
            <section aria-labelledby="refresh-impact-heading">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h3 id="refresh-impact-heading" className="text-sm font-medium">
                  Source impact
                </h3>
                <p className="text-xs text-muted-foreground">
                  {pending.impact.changedSourcePaths.length} changed source
                  values
                </p>
              </div>
              <div className="grid grid-cols-2 divide-x divide-y rounded-lg border sm:grid-cols-4 sm:divide-y-0">
                {[
                  [
                    "Pages",
                    pending.impact.previousGeneratedPageCount ===
                    pending.impact.generatedPageCount
                      ? pending.impact.generatedPageCount
                      : `${pending.impact.previousGeneratedPageCount} → ${pending.impact.generatedPageCount}`,
                  ],
                  ["Updated", pending.impact.updatedSourceLayers],
                  ["Added", pending.impact.addedSourceLayers],
                  ["Removed", pending.impact.removedSourceLayers],
                ].map(([label, value]) => (
                  <div className="flex flex-col gap-1 px-3 py-3" key={label}>
                    <span className="font-mono text-lg tabular-nums">
                      {value}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {label}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {pending.impact.changedCategories.map((category) => (
                  <Badge key={category} variant="outline">
                    {category}
                  </Badge>
                ))}
              </div>
              {pending.impact.businessChanges.length ? (
                <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                  {pending.impact.businessChanges.map((change) => (
                    <p
                      className="rounded-md bg-muted/55 px-2.5 py-2 text-xs text-muted-foreground"
                      key={change.category}
                    >
                      <span className="font-medium text-foreground">
                        {change.category}
                      </span>
                      {` · ${[
                        change.added ? `${change.added} added` : null,
                        change.removed ? `${change.removed} removed` : null,
                        change.updated ? `${change.updated} updated` : null,
                      ]
                        .filter(Boolean)
                        .join(", ")}`}
                    </p>
                  ))}
                </div>
              ) : null}
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                {pending.impact.preservedStudioLayers} Studio-edited layers are
                preserved
                {pending.impact.preservedCustomLayerCount
                  ? `, including ${pending.impact.preservedCustomLayerCount} custom layers`
                  : ""}
                .
              </p>
            </section>

            <Separator />

            <section aria-labelledby="refresh-collisions-heading">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h3
                    id="refresh-collisions-heading"
                    className="text-sm font-medium"
                  >
                    Decisions
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    These layers changed in Studio and the source. Choose which
                    value should win for each layer.
                  </p>
                </div>
                <Badge variant={unresolvedCount ? "destructive" : "secondary"}>
                  {unresolvedCount
                    ? `${unresolvedCount} unresolved`
                    : "Ready to accept"}
                </Badge>
              </div>

              {conflicts.length ? (
                <div className="divide-y rounded-lg border">
                  {conflicts.map((conflict) => {
                    const choice =
                      pending.collisionChoices[conflict.semanticKey]
                    return (
                      <div
                        className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                        key={conflict.semanticKey}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {conflict.layerName}
                          </p>
                          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                            {conflict.kind === "edited_then_removed"
                              ? "Removed at the source after you edited it in Studio"
                              : `Both changed ${conflict.properties
                                  .map(propertyLabel)
                                  .join(", ")}`}
                          </p>
                        </div>
                        <ToggleGroup
                          aria-label={`Resolve ${conflict.layerName}`}
                          disabled={busy !== null}
                          onValueChange={(value) => {
                            if (
                              value === "preserve_studio" ||
                              value === "use_source"
                            ) {
                              void choose(conflict.semanticKey, value)
                            }
                          }}
                          type="single"
                          value={choice ?? ""}
                          variant="outline"
                          size="sm"
                          spacing={0}
                        >
                          <ToggleGroupItem value="preserve_studio">
                            Keep Studio
                          </ToggleGroupItem>
                          <ToggleGroupItem value="use_source">
                            Use source
                          </ToggleGroupItem>
                        </ToggleGroup>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="flex items-start gap-3 rounded-lg border px-3 py-3">
                  <ShieldCheck
                    className="mt-0.5 size-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-sm font-medium">No collisions</p>
                    <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                      Studio can apply the incoming source while preserving your
                      existing design edits.
                    </p>
                  </div>
                </div>
              )}
            </section>

            {error ? (
              <p
                className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-xs leading-5 text-destructive"
                role="alert"
              >
                {error}
              </p>
            ) : null}
          </div>
        </ScrollArea>

        <AlertDialogFooter className="m-0 rounded-none px-5 py-4 sm:px-6">
          <AlertDialogCancel disabled={busy !== null}>
            Review later
          </AlertDialogCancel>
          <Button
            disabled={busy !== null}
            variant="outline"
            onClick={() => void run("reject")}
          >
            {busy === "reject" ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : null}
            Reject update
          </Button>
          <Button
            disabled={busy !== null || unresolvedCount > 0}
            onClick={() => void run("accept")}
          >
            {busy === "accept" ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : (
              <Check data-icon="inline-start" />
            )}
            Accept update
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
