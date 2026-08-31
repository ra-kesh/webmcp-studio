import { formatFieldValueForText, parseAssetReference } from "@webmcp/document"
import type { FieldDefinition, FieldValue } from "@webmcp/document"
import { curatedMediaManifestItemForValue } from "../../content/library/media/curated-media-content"
import { studioCompatibilityAssetForValue } from "./asset-catalog"

export type AssetValueDisplay = Readonly<{
  kind:
    | "canonical_curated"
    | "workspace_managed"
    | "device_local"
    | "embedded_renderer_safe"
    | "historical_https"
    | "legacy"
  label: string
  valid: boolean
  publishRequiresResolution: boolean
}>

export function assetValueDisplay(value: unknown): AssetValueDisplay {
  if (typeof value !== "string" || value === "") {
    return {
      kind: "legacy",
      label: "No asset",
      valid: value === "",
      publishRequiresResolution: false,
    }
  }

  const compatibilityAsset = studioCompatibilityAssetForValue(value)
  if (compatibilityAsset?.src === value) {
    return {
      kind: "legacy",
      label: `${compatibilityAsset.name} · Legacy curated value`,
      valid: true,
      publishRequiresResolution: false,
    }
  }

  const reference = parseAssetReference(value)
  if (!reference) {
    return {
      kind: "legacy",
      label: "Legacy asset value",
      valid: false,
      publishRequiresResolution: true,
    }
  }

  if (reference.source === "curated_studio") {
    const item = curatedMediaManifestItemForValue(value)
    if (!item) {
      return {
        kind: "legacy",
        label: "Legacy curated asset value",
        valid: true,
        publishRequiresResolution: true,
      }
    }
    return {
      kind: "canonical_curated",
      label: `${item.name} · Curated Studio asset`,
      valid: true,
      publishRequiresResolution: false,
    }
  }
  if (reference.source === "managed_workspace") {
    return {
      kind: "workspace_managed",
      label: `Workspace-managed image (${value.slice("asset:managed/".length)})`,
      valid: true,
      publishRequiresResolution: reference.publishRequiresResolution,
    }
  }
  if (reference.source === "managed_local") {
    return {
      kind: "device_local",
      label: `Device-local image (${value.slice("asset:local/".length)})`,
      valid: true,
      publishRequiresResolution: reference.publishRequiresResolution,
    }
  }
  if (reference.source === "inline_render_safe") {
    return {
      kind: "embedded_renderer_safe",
      label: "Embedded renderer-safe image",
      valid: true,
      publishRequiresResolution: false,
    }
  }
  return {
    kind: "historical_https",
    label: "Historical HTTPS image",
    valid: true,
    publishRequiresResolution: reference.publishRequiresResolution,
  }
}

export function displayFieldChangeValue(
  field: FieldDefinition | undefined,
  value: FieldValue | undefined
): string {
  if (value === undefined || value === "") return "No value"
  if (!field) return String(value)
  if (field.type === "asset") {
    return assetValueDisplay(value).label
  }
  try {
    return formatFieldValueForText(field, value)
  } catch {
    return `Invalid ${field.type} value`
  }
}
