import { formatFieldValueForText, parseAssetReference } from "@webmcp/document"
import type { FieldDefinition, FieldValue } from "@webmcp/document"
import { studioAssets } from "./asset-catalog"

export function displayFieldChangeValue(
  field: FieldDefinition | undefined,
  value: FieldValue | undefined
): string {
  if (value === undefined || value === "") return "No value"
  if (!field) return String(value)
  if (field.type === "asset") {
    if (typeof value !== "string") return "Invalid asset reference"
    const catalogAsset = studioAssets.find((asset) => asset.src === value)
    if (catalogAsset) return `${catalogAsset.name} (${catalogAsset.id})`
    const reference = parseAssetReference(value)
    if (!reference) return "Invalid asset reference"
    if (reference.source === "managed_local") {
      return `Uploaded Studio asset (${reference.reference.replace("asset:local/", "")})`
    }
    if (reference.source === "inline_render_safe") {
      return "Embedded renderer-safe asset"
    }
    return "External asset awaiting upload"
  }
  try {
    return formatFieldValueForText(field, value)
  } catch {
    return `Invalid ${field.type} value`
  }
}
