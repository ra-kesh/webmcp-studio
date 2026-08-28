import type { InspectorImageSourceReadiness } from "@webmcp/editor/inspector"

export type MissingImageRecoveryActionId = "retry" | "locate" | "remove"

export type MissingImageRecoveryAction = Readonly<{
  id: MissingImageRecoveryActionId
  enabled: boolean
  disabledReason: string | null
}>

export function projectMissingImageRecoveryActions({
  readiness,
  documentEditable,
  imageLocked,
  canReplaceImage,
  replacementDisabledReason = null,
}: Readonly<{
  readiness: InspectorImageSourceReadiness
  documentEditable: boolean
  imageLocked: boolean
  canReplaceImage: boolean
  replacementDisabledReason?: string | null
}>): readonly MissingImageRecoveryAction[] {
  const sourceIsMissing = readiness === "unavailable"
  const documentReason = documentEditable
    ? null
    : "Finish or discard the pending review before editing this layer."
  const lockReason = imageLocked ? "Unlock this layer before editing it." : null

  return [
    {
      id: "retry",
      enabled: sourceIsMissing,
      disabledReason: sourceIsMissing
        ? null
        : "Retry becomes available when this image cannot be loaded.",
    },
    {
      id: "locate",
      enabled: sourceIsMissing && canReplaceImage,
      disabledReason: sourceIsMissing
        ? canReplaceImage
          ? null
          : (replacementDisabledReason ?? documentReason ?? lockReason)
        : "Locate replacement becomes available when this image cannot be loaded.",
    },
    {
      id: "remove",
      enabled: sourceIsMissing && documentEditable && !imageLocked,
      disabledReason: sourceIsMissing
        ? (documentReason ?? lockReason)
        : "Remove layer becomes available when this image cannot be loaded.",
    },
  ]
}
