import { describe, expect, it } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import {
  LocalAssetPromotionControl,
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
