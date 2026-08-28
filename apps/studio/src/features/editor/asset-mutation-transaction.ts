import type { Document } from "@webmcp/document"

export type AssetMutationState = {
  snapshotId: string
  document: Document
  activePageId: string
  reviewPending: boolean
  recoveryPending: boolean
}

export type AssetMutationAnchor = {
  kind: "add" | "replace"
  snapshotId: string
  documentId: string
  activePageId: string
  pageId: string
  nodeId?: string
  nodeAssetId?: string
  nodeSource?: string
}

export type AssetMutationAbortReason =
  | "review_started"
  | "recovery_started"
  | "document_changed"
  | "page_changed"
  | "page_removed"
  | "target_changed"

export type AssetMutationFailureReason =
  | "prepare_failed"
  | "persist_failed"
  | "source_failed"
  | "commit_rejected"
  | "commit_failed"
  | "rollback_failed"

export type AssetMutationResult<TPrepared> =
  | { status: "committed"; prepared: TPrepared }
  | { status: "aborted"; reason: AssetMutationAbortReason }
  | {
      status: "failed"
      reason: AssetMutationFailureReason
      cause: unknown
    }

type AssetMutationFailureResult = Extract<
  AssetMutationResult<never>,
  { status: "failed" }
>

export function captureAddAssetAnchor(
  state: AssetMutationState
): AssetMutationAnchor | null {
  const page = state.document.pages.find(
    (candidate) => candidate.id === state.activePageId
  )
  if (!page || state.reviewPending || state.recoveryPending) return null
  return {
    kind: "add",
    snapshotId: state.snapshotId,
    documentId: state.document.id,
    activePageId: state.activePageId,
    pageId: page.id,
  }
}

export function captureReplaceAssetAnchor(
  state: AssetMutationState,
  nodeId: string
): AssetMutationAnchor | null {
  if (state.reviewPending || state.recoveryPending) return null
  const node = state.document.nodes.find((candidate) => candidate.id === nodeId)
  const page = state.document.pages.find((candidate) =>
    candidate.nodeIds.includes(nodeId)
  )
  if (
    !node ||
    node.type !== "image" ||
    !page ||
    page.id !== state.activePageId
  ) {
    return null
  }
  return {
    kind: "replace",
    snapshotId: state.snapshotId,
    documentId: state.document.id,
    activePageId: state.activePageId,
    pageId: page.id,
    nodeId: node.id,
    nodeAssetId: node.assetId,
    nodeSource: node.src,
  }
}

export function getAssetMutationAbortReason(
  anchor: AssetMutationAnchor,
  state: AssetMutationState
): AssetMutationAbortReason | null {
  if (state.recoveryPending) return "recovery_started"
  if (state.reviewPending) return "review_started"
  if (state.document.id !== anchor.documentId) return "document_changed"
  if (state.activePageId !== anchor.activePageId) return "page_changed"
  const page = state.document.pages.find(
    (candidate) => candidate.id === anchor.pageId
  )
  if (!page) return "page_removed"
  if (anchor.kind === "replace") {
    const node = state.document.nodes.find(
      (candidate) => candidate.id === anchor.nodeId
    )
    if (
      !node ||
      node.type !== "image" ||
      !page.nodeIds.includes(node.id) ||
      node.assetId !== anchor.nodeAssetId ||
      node.src !== anchor.nodeSource
    ) {
      return "target_changed"
    }
  }
  if (state.snapshotId !== anchor.snapshotId) return "document_changed"
  return null
}

async function rollbackPersistedAsset(
  rollback: () => Promise<void>,
  originalReason: Exclude<
    AssetMutationFailureReason,
    "prepare_failed" | "rollback_failed"
  >,
  originalCause: unknown
): Promise<AssetMutationFailureResult> {
  try {
    await rollback()
    return {
      status: "failed",
      reason: originalReason,
      cause: originalCause,
    }
  } catch (rollbackError) {
    return {
      status: "failed",
      reason: "rollback_failed",
      cause: rollbackError,
    }
  }
}

export async function executeAssetMutation<TPrepared>({
  anchor,
  readState,
  prepare,
  persist,
  activate,
  rollback,
  commit,
}: {
  anchor: AssetMutationAnchor
  readState: () => AssetMutationState
  prepare: () => Promise<TPrepared>
  persist: (prepared: TPrepared) => Promise<void>
  activate?: (prepared: TPrepared) => Promise<void>
  rollback: () => Promise<void>
  commit: (prepared: TPrepared) => boolean
}): Promise<AssetMutationResult<TPrepared>> {
  let prepared: TPrepared
  try {
    prepared = await prepare()
  } catch (error) {
    return { status: "failed", reason: "prepare_failed", cause: error }
  }

  const afterPrepare = getAssetMutationAbortReason(anchor, readState())
  if (afterPrepare) return { status: "aborted", reason: afterPrepare }

  try {
    await persist(prepared)
  } catch (error) {
    return { status: "failed", reason: "persist_failed", cause: error }
  }

  if (activate) {
    try {
      await activate(prepared)
    } catch (error) {
      return rollbackPersistedAsset(rollback, "source_failed", error)
    }
  }

  const afterPersist = getAssetMutationAbortReason(anchor, readState())
  if (afterPersist) {
    const rollbackResult = await rollbackPersistedAsset(
      rollback,
      "commit_rejected",
      afterPersist
    )
    return rollbackResult.reason === "rollback_failed"
      ? rollbackResult
      : { status: "aborted", reason: afterPersist }
  }

  try {
    if (commit(prepared)) return { status: "committed", prepared }
    return rollbackPersistedAsset(
      rollback,
      "commit_rejected",
      new Error("The document rejected the asset command")
    )
  } catch (error) {
    return rollbackPersistedAsset(rollback, "commit_failed", error)
  }
}

export function assetMutationMessage(
  action: "add" | "replace",
  result: Exclude<AssetMutationResult<unknown>, { status: "committed" }>
) {
  const noun = action === "add" ? "upload" : "replacement"
  if (result.status === "aborted") {
    switch (result.reason) {
      case "review_started":
        return `Image ${noun} stopped because a change review started. Resolve or discard the review, then retry.`
      case "recovery_started":
        return `Image ${noun} stopped because draft recovery became active. Resolve the draft, then retry.`
      case "target_changed":
        return "Image replacement stopped because that layer changed or no longer exists. Select the current image layer and retry."
      case "page_changed":
      case "page_removed":
        return `Image ${noun} stopped because the active page changed. Nothing was added. Retry on the current page.`
      case "document_changed":
        return `Image ${noun} stopped because the design changed while the file was being prepared. Nothing was added. Retry in the current design.`
    }
  }
  if (result.reason === "rollback_failed") {
    return `Image ${noun} stopped, but Studio could not finish local cleanup. Reload Studio to retry cleanup before uploading again.`
  }
  if (result.reason === "prepare_failed") {
    return "The selected image could not be decoded. Choose another PNG, JPEG, or WebP file."
  }
  if (result.reason === "source_failed") {
    return "The replacement source could not be opened. The staged local file was removed and the original image was kept."
  }
  if (result.reason === "commit_rejected") {
    return `Image ${noun} was not committed. The staged local file was removed; retry in the current design.`
  }
  return `Image ${noun} failed. The staged local file was removed; retry after checking browser storage.`
}
