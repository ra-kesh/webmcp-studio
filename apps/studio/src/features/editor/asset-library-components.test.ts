import { describe, expect, it } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import {
  LocalAssetPromotionControl,
  MissingLocalAssetRecoveryCard,
  nextManagedUploadClaims,
  UploadQueue,
} from "./asset-library-components"
import type { UploadPhase, UploadQueueItem } from "./asset-library-components"
import type { LocalAssetPromotionViewState } from "./use-document-editor"

const queuedItem = (id: string, phase: UploadPhase = "queued") =>
  ({
    id,
    file: new File([id], `${id}.png`, { type: "image/png" }),
    idempotencyKey: `request-${id}`,
    phase,
    progress: null,
    error: null,
    asset: null,
    retryable: false,
    attempt: 0,
  }) satisfies UploadQueueItem

describe("managed upload queue admission", () => {
  it("claims at most three uploads and preserves source order", () => {
    const items = Array.from({ length: 6 }, (_, index) =>
      queuedItem(`upload-${index + 1}`)
    )

    expect(
      nextManagedUploadClaims(items, new Set(), 3).map(({ id }) => id)
    ).toEqual(["upload-1", "upload-2", "upload-3"])
  })

  it("counts in-flight and synchronously claimed work without double starting it", () => {
    const items = [
      queuedItem("upload-1", "uploading"),
      queuedItem("upload-2", "reconciling"),
      queuedItem("upload-3"),
      queuedItem("upload-4"),
      queuedItem("upload-5"),
    ]

    expect(nextManagedUploadClaims(items, new Set(["upload-3"]), 3)).toEqual([])
    expect(
      nextManagedUploadClaims(items, new Set(), 3).map(({ id }) => id)
    ).toEqual(["upload-3"])
  })

  it("offers Retry only for typed retryable terminal outcomes", () => {
    const deterministic = {
      ...queuedItem("invalid", "failed"),
      error: "Invalid image",
      retryable: false,
    }
    const transient = {
      ...queuedItem("timeout", "status_unknown"),
      error:
        "Studio lost contact before it could confirm the result. Retry checks the server with the same request key before creating anything new.",
      retryable: true,
    }
    const markup = renderToStaticMarkup(
      createElement(UploadQueue, {
        items: [deterministic, transient],
        selectingId: null,
        disabled: false,
        onCancel: () => undefined,
        onRetry: () => undefined,
        onUse: () => undefined,
        onDismiss: () => undefined,
      })
    )

    expect(markup.match(/>Retry</g)).toHaveLength(1)
    expect(markup).toContain("Invalid image")
    expect(markup).toContain("Status unknown")
    expect(markup).toContain("Retry checks the server")
  })
})

const promotion = (
  phase: LocalAssetPromotionViewState["phase"],
  patch: Partial<LocalAssetPromotionViewState> = {}
): LocalAssetPromotionViewState => ({
  operationId: "promotion-1",
  localAssetId: "local-1",
  sourceDocumentId: "document-1",
  expectedReferenceKeys: ["node/photo/src"],
  managedAssetId: "asset-1234567890",
  relinkCommitId: "commit-1",
  phase,
  loaded: null,
  total: null,
  message: null,
  retryable: false,
  undoable: null,
  ...patch,
})

describe("local asset promotion control", () => {
  it("truthfully disables another image while the bounded owner is active", () => {
    const markup = renderToStaticMarkup(
      createElement(LocalAssetPromotionControl, {
        blockedByOtherPromotion: true,
        mutationDisabled: false,
        referenceCount: 2,
        onPromote: () => {},
      })
    )

    expect(markup).toContain("Another image is being made available.")
    expect(markup).toContain("disabled")
  })

  it("does not offer Cancel for another tab's active lease", () => {
    const markup = renderToStaticMarkup(
      createElement(LocalAssetPromotionControl, {
        mutationDisabled: false,
        promotion: promotion("reconciling", { retryable: false }),
        referenceCount: 1,
        onPromote: () => {},
      })
    )

    expect(markup).toContain("Checking workspace copy")
    expect(markup).not.toContain(">Cancel<")
    expect(markup).not.toContain(">Retry<")
  })

  it("keeps critical and completed truth visible after local references reach zero", () => {
    const saving = renderToStaticMarkup(
      createElement(LocalAssetPromotionControl, {
        promotion: promotion("saving", { undoable: true }),
        referenceCount: 0,
        mutationDisabled: false,
        onPromote: () => undefined,
        onCancelPromotion: () => undefined,
      })
    )
    const complete = renderToStaticMarkup(
      createElement(LocalAssetPromotionControl, {
        promotion: promotion("complete", { undoable: false }),
        referenceCount: 0,
        mutationDisabled: false,
        onPromote: () => undefined,
      })
    )

    expect(saving).toContain("Saving everywhere…")
    expect(saving).toContain('aria-busy="true"')
    expect(saving).not.toContain(">Cancel<")
    expect(complete).toContain("Available everywhere")
    expect(complete).toContain("No new Undo step is available")
  })

  it("replaces Cancel with an acknowledged Stopping state", () => {
    const active = renderToStaticMarkup(
      createElement(LocalAssetPromotionControl, {
        promotion: promotion("uploading", { loaded: 50, total: 100 }),
        referenceCount: 2,
        mutationDisabled: false,
        onPromote: () => undefined,
        onCancelPromotion: () => undefined,
      })
    )
    const stopping = renderToStaticMarkup(
      createElement(LocalAssetPromotionControl, {
        promotion: promotion("cancelling"),
        referenceCount: 2,
        mutationDisabled: false,
        onPromote: () => undefined,
        onCancelPromotion: () => undefined,
      })
    )

    expect(active).toContain("Uploading 50%…")
    expect(active).toContain(">Cancel<")
    expect(stopping).toContain("Stopping…")
    expect(stopping).not.toContain(">Cancel<")
  })
})

describe("missing local media recovery card", () => {
  const impact = {
    localAssetId: "missing-1",
    source: "asset:local/missing-1" as const,
    referenceKeys: ["field/hero/current", "node/photo/src"],
    directNodeIds: ["photo"],
    projectedNodeIds: ["photo"],
    fieldIds: ["hero"],
    pageIds: ["page-1"],
    outputIds: ["output-1"],
    lockedNodeIds: [],
    requiredFieldIds: ["hero"],
    referenceCount: 2,
  }

  it("discloses complete impact and a ready Studio copy", () => {
    const markup = renderToStaticMarkup(
      createElement(MissingLocalAssetRecoveryCard, {
        localAssetId: "missing-1",
        impact,
        mappingState: "ready",
        onUseStudioCopy: () => undefined,
        onLocateFile: () => undefined,
        onChooseStudioImage: () => undefined,
      })
    )

    expect(markup).toContain("2 uses · 1 page · 1 layer · 1 field · 1 output")
    expect(markup).toContain("Studio copy available")
    expect(markup).toContain("Use Studio copy")
    expect(markup).toContain(
      "Undo restores the device-only reference. If its file is still unavailable"
    )
    expect(markup).toContain("Locate file")
    expect(markup).toContain("Choose Studio image")
  })

  it("keeps unknown backup status distinct from unmapped and explains refusal", () => {
    const markup = renderToStaticMarkup(
      createElement(MissingLocalAssetRecoveryCard, {
        localAssetId: "missing-1",
        impact,
        mappingState: "unavailable",
        removeDisabledReason:
          "This required field cannot be cleared or removed.",
        onLocateFile: () => undefined,
        onChooseStudioImage: () => undefined,
        onRemove: () => undefined,
      })
    )

    expect(markup).toContain("Backup status unknown")
    expect(markup).not.toContain("Use Studio copy")
    expect(markup).toContain("This required field cannot be cleared")
    expect(markup).toContain("disabled")
  })

  it("keeps a restored alias card open for exact-use review without recovery controls", () => {
    const markup = renderToStaticMarkup(
      createElement(MissingLocalAssetRecoveryCard, {
        localAssetId: "missing-1",
        impact,
        deviceState: "ready",
        mappingState: "archived",
        reviewOnly: true,
        references: [
          {
            key: "field:hero",
            label: "Hero image",
            detail: "Field on Cover",
            nodeId: "photo",
            pageId: "page-1",
            fieldId: "hero",
          },
        ],
        onLocateFile: () => undefined,
        onChooseStudioImage: () => undefined,
      })
    )

    expect(markup).toContain("On this device")
    expect(markup).toContain("Studio backup found")
    expect(markup).toContain("Hero image")
    expect(markup).not.toContain("Locate file")
    expect(markup).not.toContain("Choose Studio image")
  })

  it("offers exact current/default slot clears and refuses only the protected slot", () => {
    const markup = renderToStaticMarkup(
      createElement(MissingLocalAssetRecoveryCard, {
        localAssetId: "missing-1",
        impact,
        mappingState: "unmapped",
        references: [
          {
            key: "field:hero:current",
            label: "Hero image",
            detail: "Current field value",
            nodeId: null,
            pageId: null,
            fieldId: "hero",
            clearReferenceKey: "field/hero/current",
          },
          {
            key: "field:hero:default",
            label: "Hero image",
            detail: "Default field value",
            nodeId: null,
            pageId: null,
            fieldId: "hero",
            clearReferenceKey: "field/hero/default",
            clearDisabledReason:
              "Required fields need a replacement and cannot be cleared.",
          },
        ],
        onLocateFile: () => undefined,
        onChooseStudioImage: () => undefined,
        onRemove: () => undefined,
        onClearReference: () => undefined,
      })
    )

    expect(markup).toContain("Current field value")
    expect(markup).toContain("Default field value")
    expect(markup.match(/>Clear<\/button>/g)).toHaveLength(2)
    expect(markup).toContain(
      'title="Required fields need a replacement and cannot be cleared."'
    )
    expect(markup).not.toContain("Clear from document")
  })

  it("offers Cancel only before commit and replaces stale actions with Finish saving after commit", () => {
    const preparing = renderToStaticMarkup(
      createElement(MissingLocalAssetRecoveryCard, {
        localAssetId: "missing-1",
        impact,
        mappingState: "ready",
        operation: {
          phase: "preparing",
          message: "Reviewing uses…",
          retryable: false,
        },
        onUseStudioCopy: () => undefined,
        onCancelRecovery: () => undefined,
        onLocateFile: () => undefined,
        onChooseStudioImage: () => undefined,
      })
    )
    const failedSave = renderToStaticMarkup(
      createElement(MissingLocalAssetRecoveryCard, {
        localAssetId: "missing-1",
        impact,
        mappingState: "ready",
        operation: {
          phase: "failed",
          message: "Durable save is unfinished.",
          retryable: true,
          retryAction: "finish_saving",
        },
        onUseStudioCopy: () => undefined,
        onRetryRecovery: () => undefined,
        onLocateFile: () => undefined,
        onChooseStudioImage: () => undefined,
      })
    )

    expect(preparing).toContain("Cancel recovery")
    expect(preparing).not.toContain("Finish saving")
    expect(failedSave).toContain("Finish saving")
    expect(failedSave).not.toContain("Use Studio copy")
    expect(failedSave).not.toContain("Locate file")
    expect(failedSave).not.toContain("Choose Studio image")
  })
})
