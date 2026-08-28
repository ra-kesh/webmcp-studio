import { useEffect, useId, useRef, useState } from "react"
import {
  fieldValueSatisfiesDefinition,
  fieldValueValidationMessage,
  normalizeFieldValueForStorage,
  parseAssetReference,
  parseCurrencyValue,
} from "@webmcp/document"
import type { FieldDefinition, FieldType, FieldValue } from "@webmcp/document"
import {
  Field,
  FieldDescription,
  FieldError,
} from "@webmcp/ui/components/field"
import { Input } from "@webmcp/ui/components/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@webmcp/ui/components/input-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@webmcp/ui/components/select"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@webmcp/ui/components/toggle-group"
import { studioAssetIdForValue, studioAssets } from "./asset-catalog"

export type ParsedFieldDraft =
  { ok: true; value: FieldValue } | { ok: false; message: string }

export function fieldDraftValue(type: FieldType, value: FieldValue): string {
  if (
    type === "currency" &&
    (typeof value === "string" || typeof value === "number")
  ) {
    return parseCurrencyValue(value)?.decimal ?? String(value)
  }
  return String(value)
}

export function parseTypedFieldDraft(
  field: FieldDefinition,
  draft: string
): ParsedFieldDraft {
  let value: FieldValue

  if (field.type === "number") {
    if (draft.trim() === "") {
      return { ok: false, message: "Enter a finite number." }
    }
    const number = Number(draft)
    if (!Number.isFinite(number)) {
      return { ok: false, message: "Enter a finite number." }
    }
    value = number
  } else if (field.type === "currency") {
    if (draft.trim() === "" && !field.required) {
      value = ""
    } else {
      const parsed = parseCurrencyValue(draft)
      if (!parsed) {
        return {
          ok: false,
          message: "Enter an amount with no more than two decimal places.",
        }
      }
      value = parsed.decimal
    }
  } else if (field.type === "boolean") {
    value = draft === "true"
  } else {
    value = draft
  }

  const message = fieldValueValidationMessage(field, value)
  if (message) return { ok: false, message }
  return {
    ok: true,
    value: normalizeFieldValueForStorage(field, value),
  }
}

function nativeColorValue(value: FieldValue): string {
  if (typeof value !== "string") return "#000000"
  const shortHex = /^#([0-9a-f]{3})$/i.exec(value)
  if (shortHex) {
    return `#${[...shortHex[1]].map((digit) => `${digit}${digit}`).join("")}`
  }
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"
}

type TypedFieldValueControlCommonProps = {
  id?: string
  value: FieldValue
  ariaLabel: string
  onCommit: (value: FieldValue) => void
  onDraftValidityChange?: (valid: boolean) => void
  assetCanBeEmpty?: boolean
  assetValueMode?: "source" | "id"
}

type TypedFieldValueControlProps = TypedFieldValueControlCommonProps &
  (
    | { field: FieldDefinition; type?: never; required?: never }
    | {
        field?: never
        type: FieldType
        required?: boolean
      }
  )

export function TypedFieldValueControl(props: TypedFieldValueControlProps) {
  const {
    id: providedId,
    value,
    ariaLabel,
    onCommit,
    onDraftValidityChange,
  } = props
  const field: FieldDefinition =
    "field" in props && props.field
      ? props.field
      : {
          id: providedId ?? "legacy_typed_control",
          key: "legacy_typed_control",
          label: ariaLabel,
          type: props.type,
          required: props.required ?? false,
          defaultValue: value,
          agentDescription: "",
          validation: {},
        }
  const assetCanBeEmpty = props.assetCanBeEmpty ?? !field.required
  const assetValueMode = props.assetValueMode ?? "source"
  const generatedId = useId()
  const id = providedId ?? generatedId
  const canonicalDraft = fieldDraftValue(field.type, value)
  const assetIdValid =
    field.type === "asset" && assetValueMode === "id"
      ? value === ""
        ? !field.required
        : typeof value === "string" &&
          studioAssets.some((asset) => asset.id === value)
      : null
  const assetSourceValid =
    field.type === "asset" && assetValueMode === "source"
      ? value === ""
        ? !field.required
        : Boolean(studioAssetIdForValue(value))
      : null
  const definitionValid =
    assetIdValid ??
    assetSourceValid ??
    fieldValueSatisfiesDefinition(field, value)
  const assetSelectionValid =
    field.type !== "asset" || assetCanBeEmpty || value !== ""
  const canonicalValid = definitionValid && assetSelectionValid
  const canonicalError =
    (assetIdValid === false
      ? `${field.label} must match one approved asset ID`
      : assetSourceValid === false
        ? `${field.label} must use an approved Studio asset before publishing`
        : fieldValueValidationMessage(field, value)) ??
    (!assetSelectionValid
      ? "An asset used by image layers cannot be empty."
      : null)
  const [draft, setDraft] = useState(canonicalDraft)
  const [error, setError] = useState<string | null>(canonicalError)
  const cancelBlurRef = useRef(false)
  const validityCallbackRef = useRef(onDraftValidityChange)

  useEffect(() => {
    validityCallbackRef.current = onDraftValidityChange
  }, [onDraftValidityChange])

  useEffect(() => {
    setDraft(canonicalDraft)
    setError(canonicalError)
    validityCallbackRef.current?.(canonicalValid)
  }, [canonicalDraft, canonicalError, canonicalValid, field.type])

  if (field.type === "boolean") {
    return (
      <ToggleGroup
        type="single"
        aria-label={ariaLabel}
        value={value ? "true" : "false"}
        variant="outline"
        spacing={1}
        onValueChange={(next) => next && onCommit(next === "true")}
      >
        <ToggleGroupItem id={id} className="h-11 flex-1" value="true">
          True
        </ToggleGroupItem>
        <ToggleGroupItem className="h-11 flex-1" value="false">
          False
        </ToggleGroupItem>
      </ToggleGroup>
    )
  }

  if (field.type === "asset") {
    const selectedAsset = studioAssets.find((asset) =>
      assetValueMode === "id" ? asset.id === value : asset.src === value
    )
    const currentReference =
      assetValueMode === "source" && typeof value === "string"
        ? parseAssetReference(value)
        : null
    const selectValue =
      value === "" ? "__none__" : (selectedAsset?.id ?? "__current__")
    const currentAssetLabel =
      currentReference?.source === "managed_local"
        ? "Uploaded Studio asset"
        : currentReference?.source === "inline_render_safe"
          ? "Embedded renderer-safe asset"
          : assetValueMode === "id"
            ? "Unknown asset ID"
            : "External asset awaiting upload"
    return (
      <Field className="gap-1.5" data-invalid={!canonicalValid || undefined}>
        <Select
          value={selectValue}
          onValueChange={(next) => {
            if (next === "__none__") {
              validityCallbackRef.current?.(assetCanBeEmpty)
              if (assetCanBeEmpty) onCommit("")
              return
            }
            const asset = studioAssets.find(
              (candidate) => candidate.id === next
            )
            if (asset) {
              validityCallbackRef.current?.(true)
              onCommit(assetValueMode === "id" ? asset.id : asset.src)
            }
          }}
        >
          <SelectTrigger
            id={id}
            aria-label={ariaLabel}
            aria-invalid={!canonicalValid || undefined}
            aria-describedby={!canonicalValid ? `${id}-error` : undefined}
            className="h-11 w-full"
          >
            <SelectValue placeholder="Choose an approved asset" />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectGroup>
              <SelectItem value="__none__" disabled={!assetCanBeEmpty}>
                {field.required
                  ? "Asset required"
                  : assetCanBeEmpty
                    ? "No asset"
                    : "Used by image layers"}
              </SelectItem>
              {!selectedAsset && value !== "" ? (
                <SelectItem value="__current__" disabled>
                  {currentAssetLabel}
                </SelectItem>
              ) : null}
              {studioAssets.map((asset) => (
                <SelectItem key={asset.id} value={asset.id}>
                  {asset.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {!canonicalValid ? (
          <FieldError id={`${id}-error`}>{canonicalError}</FieldError>
        ) : currentReference?.publishRequiresResolution ? (
          <FieldDescription>
            Replace this asset with an uploaded Studio asset before publishing.
          </FieldDescription>
        ) : null}
      </Field>
    )
  }

  if (field.type === "choice") {
    const selectValue = value === "" ? "__none__" : String(value)
    return (
      <Field className="gap-1.5" data-invalid={!canonicalValid || undefined}>
        <Select
          value={selectValue}
          onValueChange={(next) => {
            const nextValue = next === "__none__" ? "" : next
            const message = fieldValueValidationMessage(field, nextValue)
            setError(message)
            validityCallbackRef.current?.(!message)
            if (!message && nextValue !== value) onCommit(nextValue)
          }}
        >
          <SelectTrigger
            id={id}
            aria-label={ariaLabel}
            aria-invalid={!canonicalValid || undefined}
            aria-describedby={!canonicalValid ? `${id}-error` : undefined}
            className="h-11 w-full"
          >
            <SelectValue placeholder="Choose an option" />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectGroup>
              <SelectItem value="__none__" disabled={field.required}>
                {field.required ? "A choice is required" : "No selection"}
              </SelectItem>
              {(field.validation.options ?? []).map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
      </Field>
    )
  }

  const commitDraft = (nextDraft: string) => {
    const parsed = parseTypedFieldDraft(field, nextDraft)
    if (!parsed.ok) {
      setError(parsed.message)
      validityCallbackRef.current?.(false)
      return false
    }
    setError(null)
    validityCallbackRef.current?.(true)
    const normalizedDraft = fieldDraftValue(field.type, parsed.value)
    setDraft(normalizedDraft)
    if (parsed.value !== value) onCommit(parsed.value)
    return true
  }

  const inputProps: React.InputHTMLAttributes<HTMLInputElement> = {
    id,
    "aria-label": ariaLabel,
    "aria-invalid": Boolean(error) || undefined,
    "aria-describedby": error ? `${id}-error` : undefined,
    value: draft,
    required: field.required,
    className: "h-11",
    inputMode:
      field.type === "number" || field.type === "currency"
        ? "decimal"
        : undefined,
    min:
      field.type === "number" || field.type === "date"
        ? (field.validation.minimum as string | number | undefined)
        : undefined,
    max:
      field.type === "number" || field.type === "date"
        ? (field.validation.maximum as string | number | undefined)
        : undefined,
    minLength: field.type === "text" ? field.validation.minLength : undefined,
    maxLength: field.type === "text" ? field.validation.maxLength : undefined,
    type:
      field.type === "date"
        ? "date"
        : field.type === "number"
          ? "number"
          : "text",
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextDraft = event.target.value
      setDraft(nextDraft)
      validityCallbackRef.current?.(parseTypedFieldDraft(field, nextDraft).ok)
      if (error) setError(null)
    },
    onBlur: () => {
      if (cancelBlurRef.current) {
        cancelBlurRef.current = false
        return
      }
      commitDraft(draft)
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault()
        if (commitDraft(draft)) {
          cancelBlurRef.current = true
          event.currentTarget.blur()
        }
      }
      if (event.key === "Escape") {
        event.preventDefault()
        cancelBlurRef.current = true
        setDraft(canonicalDraft)
        setError(canonicalError)
        validityCallbackRef.current?.(canonicalValid)
        event.currentTarget.blur()
      }
    },
  }

  return (
    <Field className="gap-1.5" data-invalid={Boolean(error) || undefined}>
      {field.type === "currency" ? (
        <InputGroup className="h-11">
          <InputGroupAddon>
            <InputGroupText aria-hidden="true">₹</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput {...inputProps} className="h-full" />
        </InputGroup>
      ) : field.type === "color" ? (
        <InputGroup className="h-11">
          <InputGroupAddon className="h-full p-0">
            <input
              aria-label={`${ariaLabel} color picker`}
              type="color"
              className="size-11 cursor-pointer rounded-md border border-input bg-transparent p-2"
              value={nativeColorValue(draft)}
              onChange={(event) => {
                const nextDraft = event.target.value.toLowerCase()
                setDraft(nextDraft)
                commitDraft(nextDraft)
              }}
            />
          </InputGroupAddon>
          <InputGroupInput
            {...inputProps}
            className="h-full font-mono uppercase"
            placeholder="#1f2937"
          />
        </InputGroup>
      ) : (
        <Input {...inputProps} />
      )}
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </Field>
  )
}
