import type {
  CurrentDraftBootstrapResult,
  CurrentDraftEnvelope,
} from "./current-draft-repository"

export type StudioStartIntent =
  | { kind: "template"; templateId: string; version: number }
  | { kind: "blank" }
  | { kind: "import" }
  | { kind: "sample" }

export type StudioStartModel =
  | Readonly<{
      status: "opening"
    }>
  | Readonly<{
      status: "recovery_required"
      recovery: Extract<
        CurrentDraftBootstrapResult,
        { status: "recovery_required" }
      >["recovery"]
    }>
  | Readonly<{
      status: "ready"
      durable: boolean
      storageWarning: string | null
      recoverableEnvelope: CurrentDraftEnvelope | null
    }>
  | Readonly<{
      status: "blocked" | "unavailable"
      durable: false
      storageWarning: string
      recoverableEnvelope: CurrentDraftEnvelope | null
    }>

export function projectStudioStartModel(
  bootstrap: CurrentDraftBootstrapResult
): StudioStartModel {
  if (bootstrap.status === "recovery_required") {
    return { status: "recovery_required", recovery: bootstrap.recovery }
  }
  if (bootstrap.status === "current") {
    return {
      status: "ready",
      durable: true,
      storageWarning: bootstrap.warnings.length
        ? bootstrap.warnings.map((warning) => warning.message).join(" ")
        : null,
      recoverableEnvelope: null,
    }
  }
  if (bootstrap.status === "storage_unavailable") {
    return {
      status: "ready",
      durable: false,
      storageWarning: bootstrap.failure.message,
      recoverableEnvelope: bootstrap.recoverableDraft ?? null,
    }
  }
  return {
    status: "ready",
    durable: true,
    storageWarning: null,
    recoverableEnvelope: null,
  }
}
