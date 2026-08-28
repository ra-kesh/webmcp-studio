import { renderPolicyLimits } from "@webmcp/document"

export const NEW_DOCUMENT_NAME_MAX_LENGTH = 80

export const newDocumentPresets = [
  {
    id: "portrait",
    name: "Portrait document",
    width: 1240,
    height: 1754,
  },
  {
    id: "square",
    name: "Square social",
    width: 1080,
    height: 1080,
  },
  {
    id: "story",
    name: "Social story",
    width: 1080,
    height: 1920,
  },
] as const

export type NewDocumentPresetId = (typeof newDocumentPresets)[number]["id"]

export type NewDocumentDraft = Readonly<{
  name: string
  width: string
  height: string
}>

export type NewDocumentOptions = Readonly<{
  name: string
  width: number
  height: number
  kind: "square" | "custom"
  exportFormats: readonly ["png", "pdf"]
}>

export type NewDocumentInput = Readonly<{
  name: string
  width: number
  height: number
}>

export type NewDocumentDraftErrors = Readonly<{
  name?: string
  width?: string
  height?: string
  dimensions?: string
}>

export type NewDocumentDraftResult =
  | Readonly<{ ok: true; options: NewDocumentOptions }>
  | Readonly<{ ok: false; errors: NewDocumentDraftErrors }>

function validatedOptions(
  name: string,
  width: number,
  height: number
): NewDocumentOptions {
  return {
    name,
    width,
    height,
    kind: width === height ? "square" : "custom",
    exportFormats: ["png", "pdf"],
  }
}

export function validateNewDocumentOptions(
  input: NewDocumentInput
): NewDocumentDraftResult {
  return validateNewDocumentDraft({
    name: input.name,
    width: String(input.width),
    height: String(input.height),
  })
}

type ParsedDimension =
  Readonly<{ ok: true; value: number }> | Readonly<{ ok: false; error: string }>

function parseDimension(
  value: string,
  label: "Width" | "Height"
): ParsedDimension {
  const parsed = Number(value)
  if (!value.trim()) return { ok: false, error: `${label} is required.` }
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return {
      ok: false,
      error: `${label} must be a whole number of pixels.`,
    }
  }
  if (parsed < 1)
    return { ok: false, error: `${label} must be at least 1 pixel.` }
  if (parsed > renderPolicyLimits.maxPageDimension) {
    return {
      ok: false,
      error: `${label} cannot exceed ${renderPolicyLimits.maxPageDimension.toLocaleString()} pixels.`,
    }
  }
  return { ok: true, value: parsed }
}

export function validateNewDocumentDraft(
  draft: NewDocumentDraft
): NewDocumentDraftResult {
  const name = draft.name.trim()
  const width = parseDimension(draft.width, "Width")
  const height = parseDimension(draft.height, "Height")
  const errors: {
    name?: string
    width?: string
    height?: string
    dimensions?: string
  } = {}

  if (!name) errors.name = "Document name is required."
  else if (name.length > NEW_DOCUMENT_NAME_MAX_LENGTH) {
    errors.name = `Document name cannot exceed ${NEW_DOCUMENT_NAME_MAX_LENGTH} characters.`
  }
  if (!width.ok) errors.width = width.error
  if (!height.ok) errors.height = height.error
  if (
    width.ok &&
    height.ok &&
    width.value * height.value > renderPolicyLimits.maxPagePixelArea
  ) {
    errors.dimensions = `Page area cannot exceed ${renderPolicyLimits.maxPagePixelArea.toLocaleString()} pixels.`
  }

  if (Object.keys(errors).length) return { ok: false, errors }
  if (!width.ok || !height.ok) {
    return { ok: false, errors: { dimensions: "Page dimensions are invalid." } }
  }
  return {
    ok: true,
    options: validatedOptions(name, width.value, height.value),
  }
}

export function presetIdForDraftDimensions(
  draft: Pick<NewDocumentDraft, "width" | "height">
): NewDocumentPresetId | null {
  return (
    newDocumentPresets.find(
      (preset) =>
        String(preset.width) === draft.width.trim() &&
        String(preset.height) === draft.height.trim()
    )?.id ?? null
  )
}

export function draftForNewDocumentPreset(
  presetId: NewDocumentPresetId
): NewDocumentDraft {
  const preset = newDocumentPresets.find((item) => item.id === presetId)
  if (!preset) throw new Error(`Unknown new-document preset: ${presetId}`)
  return {
    name: preset.name,
    width: String(preset.width),
    height: String(preset.height),
  }
}
