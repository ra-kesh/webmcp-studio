import { describe, expect, it } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import {
  nextManagedUploadClaims,
  UploadQueue,
} from "./asset-library-components"
import type { UploadPhase, UploadQueueItem } from "./asset-library-components"

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
