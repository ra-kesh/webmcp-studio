import type {
  Document,
  LibraryCompletedAction,
  LibraryItemIdentity,
  SceneNode,
} from "@webmcp/document"
import type { CommandDraft } from "@webmcp/editor"
import type { LibraryPreferenceCommands } from "../../content/library/library-preference-provider"
import {
  captureAddAssetAnchor,
  captureReplaceAssetAnchor,
  getAssetMutationAbortReason,
} from "./asset-mutation-transaction"
import type {
  AssetMutationAnchor,
  AssetMutationState,
} from "./asset-mutation-transaction"
import { imageReplacementBindingImpact } from "./image-replacement-binding"
import type { PreparedLibraryMediaAction } from "./library-media-action-preparation"
import {
  createReusableImageNode,
  reusableImageReplacementCommand,
} from "./media-selection-model"

type ImageNode = Extract<SceneNode, { type: "image" }>

export type LibraryMediaActionAnchor =
  | Readonly<{
      kind: "insert"
      assetAnchor: AssetMutationAnchor
    }>
  | Readonly<{
      kind: "replace"
      assetAnchor: AssetMutationAnchor
    }>
  | Readonly<{
      kind: "assign_field"
      snapshotId: string
      documentId: string
      fieldId: string
    }>

export type LibraryMediaActionExecutionErrorCode =
  | "action_target_unavailable"
  | "action_target_changed"
  | "action_target_bound"
  | "action_field_incompatible"

export class LibraryMediaActionExecutionError extends Error {
  constructor(
    readonly code: LibraryMediaActionExecutionErrorCode,
    message: string
  ) {
    super(message)
    this.name = "LibraryMediaActionExecutionError"
  }
}

const executionError = (
  code: LibraryMediaActionExecutionErrorCode,
  message: string
) => new LibraryMediaActionExecutionError(code, message)

export function captureLibraryMediaActionAnchor(
  prepared: PreparedLibraryMediaAction,
  state: AssetMutationState
): LibraryMediaActionAnchor {
  const target = prepared.target
  if (target.type === "insert") {
    const anchor = captureAddAssetAnchor(state)
    if (!anchor || anchor.pageId !== target.pageId) {
      throw executionError(
        "action_target_unavailable",
        "The selected page is no longer active. Choose the page and retry."
      )
    }
    return { kind: "insert", assetAnchor: anchor }
  }
  if (target.type === "replace") {
    const binding = imageReplacementBindingImpact(state.document, target.nodeId)
    if (binding) {
      throw executionError("action_target_bound", binding.message)
    }
    const anchor = captureReplaceAssetAnchor(state, target.nodeId)
    if (!anchor || anchor.pageId !== target.pageId) {
      throw executionError(
        "action_target_unavailable",
        "That image layer is no longer available on the active page. Select it and retry."
      )
    }
    return { kind: "replace", assetAnchor: anchor }
  }
  const field = state.document.fields.find(
    (candidate) => candidate.id === target.fieldId
  )
  if (!field) {
    throw executionError(
      "action_target_unavailable",
      "That asset field no longer exists. Choose another field and retry."
    )
  }
  if (field.type !== "asset") {
    throw executionError(
      "action_field_incompatible",
      `${field.label} does not accept images.`
    )
  }
  if (state.reviewPending || state.recoveryPending) {
    throw executionError(
      "action_target_unavailable",
      "Resolve the current review or recovery before changing an asset field."
    )
  }
  return {
    kind: "assign_field",
    snapshotId: state.snapshotId,
    documentId: state.document.id,
    fieldId: field.id,
  }
}

export function libraryMediaActionAnchorError(
  anchor: LibraryMediaActionAnchor,
  state: AssetMutationState
): string | null {
  if (anchor.kind !== "assign_field") {
    const reason = getAssetMutationAbortReason(anchor.assetAnchor, state)
    return reason
      ? "The document target changed while the image was being prepared. Nothing was changed. Retry in the current design."
      : null
  }
  if (
    state.recoveryPending ||
    state.reviewPending ||
    state.document.id !== anchor.documentId ||
    state.snapshotId !== anchor.snapshotId
  ) {
    return "The document changed while the image was being prepared. The asset field was not changed."
  }
  const field = state.document.fields.find(
    (candidate) => candidate.id === anchor.fieldId
  )
  if (!field || field.type !== "asset") {
    return "The target asset field changed or no longer exists."
  }
  return null
}

export function commandForPreparedLibraryMediaAction(
  prepared: PreparedLibraryMediaAction,
  anchor: LibraryMediaActionAnchor,
  state: AssetMutationState,
  createNodeId: () => string
): Readonly<{ command: CommandDraft; insertedNodeId: string | null }> {
  const target = prepared.target
  if (target.type === "insert" && anchor.kind === "insert") {
    const page = state.document.pages.find(
      (candidate) => candidate.id === anchor.assetAnchor.pageId
    )
    if (!page) {
      throw executionError(
        "action_target_changed",
        "The selected page no longer exists."
      )
    }
    const nodeId = createNodeId()
    return {
      command: {
        type: "add_node",
        pageId: page.id,
        node: createReusableImageNode(page, prepared.asset, nodeId),
      },
      insertedNodeId: nodeId,
    }
  }
  if (target.type === "replace" && anchor.kind === "replace") {
    const node = state.document.nodes.find(
      (candidate): candidate is ImageNode =>
        candidate.id === target.nodeId && candidate.type === "image"
    )
    if (!node) {
      throw executionError(
        "action_target_changed",
        "The image layer changed or no longer exists."
      )
    }
    return {
      command: reusableImageReplacementCommand(node, prepared.asset),
      insertedNodeId: null,
    }
  }
  if (target.type === "assign_field" && anchor.kind === "assign_field") {
    return {
      command: {
        type: "set_field",
        fieldId: anchor.fieldId,
        value: prepared.asset.src,
      },
      insertedNodeId: null,
    }
  }
  throw executionError(
    "action_target_changed",
    "The prepared image action no longer matches its document target."
  )
}

export function libraryMediaCommandIsNoOp(
  command: CommandDraft,
  state: AssetMutationState
) {
  if (command.type === "replace_image_source") {
    const node = state.document.nodes.find(
      (candidate) => candidate.id === command.nodeId
    )
    return Boolean(
      node?.type === "image" &&
        node.assetId === command.assetId &&
        node.src === command.src &&
        (command.alt === undefined ||
          (node.alt === command.alt &&
            node.altProvenance ===
              (command.altProvenance ?? "authored")))
    )
  }
  if (command.type === "set_field") {
    return state.document.fieldValues[command.fieldId] === command.value
  }
  return false
}

export const completedActionForLibraryMedia = (
  prepared: PreparedLibraryMediaAction
): LibraryCompletedAction => {
  switch (prepared.target.type) {
    case "insert":
      return "insert"
    case "replace":
      return "replace"
    case "assign_field":
      return "assign_field"
  }
}

const sameReusableAsset = (
  left: PreparedLibraryMediaAction["asset"],
  right: PreparedLibraryMediaAction["asset"]
) =>
  left.assetId === right.assetId &&
  left.name === right.name &&
  left.description === right.description &&
  left.src === right.src &&
  left.width === right.width &&
  left.height === right.height

export function libraryMediaFinalAdmissionError(
  prepared: PreparedLibraryMediaAction,
  admitted: PreparedLibraryMediaAction
): string | null {
  const commonMismatch =
    prepared.source !== admitted.source ||
    prepared.correlationId !== admitted.correlationId ||
    JSON.stringify(prepared.target) !== JSON.stringify(admitted.target) ||
    prepared.exactDetail.summary.id !== admitted.exactDetail.summary.id ||
    prepared.exactDetail.summary.version !==
      admitted.exactDetail.summary.version ||
    prepared.exactDetail.summary.mediaSource !==
      admitted.exactDetail.summary.mediaSource ||
    prepared.mimeType !== admitted.mimeType ||
    prepared.bytes !== admitted.bytes ||
    !sameReusableAsset(prepared.asset, admitted.asset)
  if (commonMismatch) {
    return "The replacement image changed before it could be committed. The original image was kept."
  }
  if (
    prepared.source === "managed" &&
    admitted.source === "managed" &&
    (prepared.catalogVersion !== admitted.catalogVersion ||
      prepared.contentHash !== admitted.contentHash)
  ) {
    return "The workspace image changed before it could be committed. The original image was kept."
  }
  if (
    prepared.source === "local" &&
    admitted.source === "local" &&
    (prepared.revision !== admitted.revision ||
      prepared.previewBlob.type !== admitted.previewBlob.type ||
      prepared.previewBlob.size !== admitted.previewBlob.size)
  ) {
    return "The device-local image changed before it could be committed. The original image was kept."
  }
  return null
}

export type LibraryMediaUsageWarning = Readonly<{
  key:
    | "record_used"
    | "managed_mark_used"
    | "local_mark_used"
    | "local_preview"
  message: string
  retry: () => Promise<boolean>
}>

export type LibraryMediaPostCommitPorts = Readonly<{
  recordUsed?: LibraryPreferenceCommands["recordUsed"]
  markManagedUsed?: (
    assetId: string,
    idempotencyKey: string
  ) => Promise<unknown>
  markLocalUsed?: (assetId: string) => Promise<unknown>
  refreshLocal?: () => Promise<unknown>
  onWarning?: (warning: LibraryMediaUsageWarning) => void
}>

const runUsageTask = async (
  key: LibraryMediaUsageWarning["key"],
  message: string,
  task: () => Promise<unknown>,
  onWarning?: LibraryMediaPostCommitPorts["onWarning"]
) => {
  const attempt = async () => {
    try {
      const result = await task()
      return result !== false
    } catch {
      return false
    }
  }
  if (await attempt()) return true
  onWarning?.({ key, message, retry: attempt })
  return false
}

const preferenceIdentity = (
  prepared: PreparedLibraryMediaAction
): LibraryItemIdentity => ({
  itemKind: "media",
  mediaSource: prepared.source,
  id: prepared.exactDetail.summary.id,
  version: prepared.exactDetail.summary.version,
})

export async function runLibraryMediaPostCommitUsage(
  prepared: PreparedLibraryMediaAction,
  completionId: string,
  ports: LibraryMediaPostCommitPorts
) {
  const action = completedActionForLibraryMedia(prepared)
  const name = prepared.exactDetail.summary.name
  const tasks: Promise<boolean>[] = []
  if (prepared.source !== "local") {
    tasks.push(
      runUsageTask(
        "record_used",
        "The image change was saved, but Studio could not update the shared Recent list. Retry the Recent update without repeating the edit.",
        async () => {
          if (!ports.recordUsed) return false
          return ports.recordUsed(
            preferenceIdentity(prepared),
            name,
            action,
            completionId
          )
        },
        ports.onWarning
      )
    )
  }
  if (prepared.source === "managed") {
    tasks.push(
      runUsageTask(
        "managed_mark_used",
        "The image change was saved, but Studio could not update the workspace media activity. Retry that update without repeating the edit.",
        async () => {
          if (!ports.markManagedUsed) return false
          return ports.markManagedUsed(prepared.asset.assetId, completionId)
        },
        ports.onWarning
      )
    )
  }
  if (prepared.source === "local") {
    tasks.push(
      runUsageTask(
        "local_mark_used",
        "The image change was saved, but Studio could not update this device's Recent list. Retry that update without repeating the edit.",
        async () => {
          if (!ports.markLocalUsed) return false
          const result = await ports.markLocalUsed(prepared.asset.assetId)
          if (result === null || result === undefined) return false
          await ports.refreshLocal?.()
          return true
        },
        ports.onWarning
      )
    )
  }
  const results = await Promise.all(tasks)
  return results.every(Boolean)
}

export function currentImageNode(
  document: Document,
  nodeId: string
): ImageNode | null {
  const node = document.nodes.find((candidate) => candidate.id === nodeId)
  return node?.type === "image" ? node : null
}
