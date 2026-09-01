import { useEffect, useId, useRef, useState } from "react"
import type { ComponentProps } from "react"
import { isRenderSafeCssColor } from "@webmcp/document"
import type { InspectorSharedValue } from "@webmcp/editor/inspector"
import {
  formatInspectorNumber,
  parseInspectorNumber,
} from "@webmcp/editor/inspector"
import { Field, FieldError, FieldLabel } from "@webmcp/ui/components/field"
import { Input } from "@webmcp/ui/components/input"
import { Slider } from "@webmcp/ui/components/slider"
import { Textarea } from "@webmcp/ui/components/textarea"
import { cn } from "@webmcp/ui/lib/utils"

export function InspectorSectionLabel({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <span className="text-[11px] leading-4 font-medium text-muted-foreground">
      {children}
    </span>
  )
}

export function CommitInput({
  value,
  onCommit,
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange"> & {
  value: string | number
  onCommit: (value: string) => void
}) {
  const generatedId = useId()
  const [draft, setDraft] = useState(String(value))
  const cancelBlurRef = useRef(false)
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    if (draft !== String(value)) onCommit(draft)
  }
  return (
    <Input
      {...props}
      id={props.id ?? generatedId}
      name={props.name ?? generatedId}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (cancelBlurRef.current) {
          cancelBlurRef.current = false
          return
        }
        commit()
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur()
        if (event.key === "Escape") {
          cancelBlurRef.current = true
          setDraft(String(value))
          event.currentTarget.blur()
        }
      }}
    />
  )
}

export function CommitTextarea({
  value,
  disabled = false,
  onCommit,
}: {
  value: string
  disabled?: boolean
  onCommit: (value: string) => void
}) {
  const id = useId()
  const [draft, setDraft] = useState(value)
  const cancelBlurRef = useRef(false)
  useEffect(() => setDraft(value), [value])
  return (
    <Textarea
      id={id}
      name={id}
      className="max-h-40 min-h-16 resize-y rounded-[5px] px-2 py-1.5 text-[11px] leading-4"
      value={draft}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (cancelBlurRef.current) {
          cancelBlurRef.current = false
          return
        }
        if (draft !== value) onCommit(draft)
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          cancelBlurRef.current = true
          setDraft(value)
          event.currentTarget.blur()
        }
      }}
    />
  )
}

export function CommitPercentSlider({
  label,
  value,
  disabled = false,
  onCommit,
}: {
  label: string
  value: number
  disabled?: boolean
  onCommit: (value: number) => void
}) {
  const id = useId()
  const [draft, setDraft] = useState(value)
  const [textDraft, setTextDraft] = useState(formatInspectorNumber(value))
  const [error, setError] = useState<string | null>(null)
  const cancelBlurRef = useRef(false)

  useEffect(() => {
    setDraft(value)
    setTextDraft(formatInspectorNumber(value))
    setError(null)
  }, [value])

  const commitTextDraft = () => {
    const result = parseInspectorNumber(textDraft, value, {
      label,
      min: 0,
      max: 100,
    })
    if (!result.ok) {
      setError(result.message)
      return false
    }
    setError(null)
    setDraft(result.value)
    setTextDraft(formatInspectorNumber(result.value))
    if (result.value !== value) onCommit(result.value)
    return true
  }

  return (
    <Field
      className="gap-3"
      data-disabled={disabled || undefined}
      data-invalid={Boolean(error) || undefined}
    >
      <div className="flex items-center justify-between gap-3">
        <FieldLabel
          htmlFor={id}
          className="text-[11px] leading-4 font-medium text-muted-foreground"
        >
          {label}
        </FieldLabel>
        <div className="relative w-16">
          <Input
            id={id}
            aria-label={`${label} percentage`}
            inputMode="decimal"
            value={textDraft}
            disabled={disabled}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            className="h-7 rounded-[5px] border-transparent bg-muted/55 pr-5 text-right font-mono text-[11px] tabular-nums hover:bg-muted/75 focus-visible:border-studio-accent focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-studio-accent/25 md:text-[11px]"
            onChange={(event) => {
              setTextDraft(event.target.value)
              if (error) setError(null)
            }}
            onBlur={() => {
              if (cancelBlurRef.current) {
                cancelBlurRef.current = false
                return
              }
              commitTextDraft()
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                if (commitTextDraft()) {
                  cancelBlurRef.current = true
                  event.currentTarget.blur()
                }
                return
              }
              if (event.key === "Escape") {
                cancelBlurRef.current = true
                setDraft(value)
                setTextDraft(formatInspectorNumber(value))
                setError(null)
                event.currentTarget.blur()
              }
            }}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-2 flex items-center font-mono text-[11px] text-muted-foreground"
          >
            %
          </span>
        </div>
      </div>
      <Slider
        aria-label={label}
        aria-valuetext={`${formatInspectorNumber(draft)}%`}
        aria-describedby={error ? `${id}-error` : undefined}
        value={[draft]}
        disabled={disabled}
        max={100}
        step={1}
        onValueChange={([next]) => {
          setDraft(next)
          setTextDraft(formatInspectorNumber(next))
          if (error) setError(null)
        }}
        onValueCommit={([next]) => {
          setDraft(next)
          setTextDraft(formatInspectorNumber(next))
          if (next !== value) onCommit(next)
        }}
      />
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </Field>
  )
}

export function InspectorNumberField({
  label,
  compactLabel,
  value,
  min,
  max,
  integer = false,
  disabled = false,
  suffix,
  onCommit,
}: {
  label: string
  compactLabel?: string
  value: InspectorSharedValue<number>
  min?: number
  max?: number
  integer?: boolean
  disabled?: boolean
  suffix?: string
  onCommit: (value: number) => void
}) {
  const id = useId()
  const canonical = value.kind === "value" ? value.value : undefined
  const canonicalDraft =
    canonical === undefined ? "" : formatInspectorNumber(canonical)
  const [draft, setDraft] = useState(canonicalDraft)
  const [error, setError] = useState<string | null>(null)
  const cancelBlurRef = useRef(false)

  useEffect(() => {
    setDraft(canonicalDraft)
    setError(null)
  }, [canonicalDraft, value.kind])

  const commit = () => {
    const result = parseInspectorNumber(draft, canonical, {
      label,
      min,
      max,
      integer,
    })
    if (!result.ok) {
      setError(result.message)
      return false
    }
    setError(null)
    setDraft(formatInspectorNumber(result.value))
    if (canonical === undefined || result.value !== canonical) {
      onCommit(result.value)
    }
    return true
  }

  return (
    <Field
      className="min-w-0 gap-1.5"
      data-invalid={Boolean(error) || undefined}
      data-mixed={value.kind === "mixed" || undefined}
      data-disabled={disabled || undefined}
    >
      <FieldLabel
        htmlFor={id}
        className={
          compactLabel
            ? "sr-only"
            : "text-[11px] leading-4 font-medium text-muted-foreground"
        }
      >
        {label}
        {value.kind === "mixed" ? (
          <span
            aria-hidden="true"
            className="tracking-normal text-muted-foreground/70 normal-case"
          >
            Mixed
          </span>
        ) : null}
      </FieldLabel>
      <div className="relative">
        {compactLabel ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-2 z-10 flex items-center font-mono text-[10px] text-muted-foreground"
          >
            {compactLabel}
          </span>
        ) : null}
        <Input
          id={id}
          aria-label={label}
          inputMode="decimal"
          value={draft}
          placeholder={value.kind === "mixed" ? "Mixed" : undefined}
          disabled={disabled}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={cn(
            "h-7 rounded-[5px] border-transparent bg-muted/55 font-mono text-[11px] tabular-nums hover:bg-muted/75 focus-visible:border-studio-accent focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-studio-accent/25 md:text-[11px]",
            compactLabel && "pl-7",
            suffix && "pr-8"
          )}
          onChange={(event) => {
            setDraft(event.target.value)
            if (error) setError(null)
          }}
          onBlur={() => {
            if (cancelBlurRef.current) {
              cancelBlurRef.current = false
              return
            }
            commit()
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              if (commit()) {
                cancelBlurRef.current = true
                event.currentTarget.blur()
              }
              return
            }
            if (event.key === "Escape") {
              cancelBlurRef.current = true
              setDraft(canonicalDraft)
              setError(null)
              event.currentTarget.blur()
              return
            }
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
            event.preventDefault()
            const parsed = parseInspectorNumber(draft, canonical, {
              label,
              min,
              max,
              integer,
            })
            const base = parsed.ok ? parsed.value : (canonical ?? 0)
            const multiplier = event.shiftKey ? 10 : event.altKey ? 0.1 : 1
            const direction = event.key === "ArrowUp" ? 1 : -1
            const next = base + direction * multiplier
            setDraft(formatInspectorNumber(next))
            setError(null)
          }}
        />
        {suffix ? (
          <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center font-mono text-[11px] text-muted-foreground">
            {suffix}
          </span>
        ) : null}
      </div>
      <FieldError id={`${id}-error`} className="text-[11px] leading-4">
        {error}
      </FieldError>
    </Field>
  )
}

const canonicalInspectorColorDraft = (value: string) =>
  value.startsWith("#") ? value.toUpperCase() : value

export function nativeInspectorColorValue(value: string): string {
  const match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim())
  const digits = match?.[1]
  if (!digits) return "#000000"
  if (digits.length === 3 || digits.length === 4) {
    return `#${[...digits.slice(0, 3)]
      .map((digit) => `${digit}${digit}`)
      .join("")}`.toUpperCase()
  }
  return `#${digits.slice(0, 6)}`.toUpperCase()
}

export type InspectorColorDraftResult =
  { ok: true; value: string } | { ok: false; message: string }

export function parseInspectorColorDraft(
  label: string,
  draft: string
): InspectorColorDraftResult {
  const trimmed = draft.trim()
  if (!isRenderSafeCssColor(trimmed)) {
    return {
      ok: false,
      message: `${label} must be a safe CSS color such as #1F2937, rgb(31 41 55 / 80%), or transparent.`,
    }
  }
  return { ok: true, value: canonicalInspectorColorDraft(trimmed) }
}

export function InspectorColorField({
  label,
  value,
  disabled = false,
  onPreview,
  onPreviewCancel,
  onCommit,
}: {
  label: string
  value: string
  disabled?: boolean
  onPreview?: (value: string) => void
  onPreviewCancel?: () => void
  onCommit: (value: string) => void
}) {
  const id = useId()
  const [draft, setDraft] = useState(canonicalInspectorColorDraft(value))
  const [error, setError] = useState<string | null>(null)
  const cancelBlurRef = useRef(false)
  const pickerRef = useRef<HTMLInputElement>(null)
  const pickerActiveRef = useRef(false)
  const pickerPreviewFrameRef = useRef<number | null>(null)
  const pickerPreviewValueRef = useRef(value)
  const valueRef = useRef(value)
  const onPreviewRef = useRef(onPreview)
  const onPreviewCancelRef = useRef(onPreviewCancel)
  const commitRef = useRef<(nextDraft: string) => boolean>(() => false)
  valueRef.current = value
  onPreviewRef.current = onPreview
  onPreviewCancelRef.current = onPreviewCancel

  const cancelScheduledPreview = () => {
    if (pickerPreviewFrameRef.current === null) return
    globalThis.cancelAnimationFrame(pickerPreviewFrameRef.current)
    pickerPreviewFrameRef.current = null
  }

  const schedulePreview = (next: string) => {
    pickerPreviewValueRef.current = next
    if (pickerPreviewFrameRef.current !== null) return
    pickerPreviewFrameRef.current = globalThis.requestAnimationFrame(() => {
      pickerPreviewFrameRef.current = null
      onPreviewRef.current?.(pickerPreviewValueRef.current)
    })
  }

  useEffect(() => {
    setDraft(canonicalInspectorColorDraft(value))
    setError(null)
  }, [value])

  const commit = (nextDraft = draft) => {
    const parsed = parseInspectorColorDraft(label, nextDraft)
    if (!parsed.ok) {
      setError(parsed.message)
      return false
    }
    setError(null)
    setDraft(parsed.value)
    if (parsed.value !== value) onCommit(parsed.value)
    return true
  }
  commitRef.current = commit

  useEffect(() => {
    const picker = pickerRef.current
    if (!picker) return
    const finishPickerInteraction = () => {
      if (!pickerActiveRef.current) return
      const next = picker.value.toUpperCase()
      cancelScheduledPreview()
      onPreviewRef.current?.(next)
      pickerActiveRef.current = false
      commitRef.current(next)
    }
    picker.addEventListener("change", finishPickerInteraction)
    return () => {
      picker.removeEventListener("change", finishPickerInteraction)
      cancelScheduledPreview()
      if (pickerActiveRef.current) onPreviewCancelRef.current?.()
      pickerActiveRef.current = false
    }
  }, [])

  const swatchColor = isRenderSafeCssColor(draft) ? draft.trim() : value
  const pickerLabel = /\bcolor$/i.test(label)
    ? `${label} picker`
    : `${label} color picker`

  return (
    <Field
      className="gap-1.5"
      data-invalid={Boolean(error) || undefined}
      data-disabled={disabled || undefined}
    >
      <FieldLabel
        htmlFor={id}
        className="text-[11px] leading-4 font-medium text-muted-foreground"
      >
        {label}
      </FieldLabel>
      <div className="flex h-7 items-center gap-2 rounded-[5px] border border-transparent bg-muted/55 px-2 transition-colors hover:bg-muted/75 has-[:focus-visible]:border-studio-accent has-[:focus-visible]:bg-background has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-studio-accent/25 has-[input[aria-invalid=true]]:border-destructive has-[input[aria-invalid=true]]:ring-2 has-[input[aria-invalid=true]]:ring-destructive/20">
        <span
          className="relative size-4 shrink-0 overflow-hidden rounded-sm border border-black/10 shadow-[inset_0_0_0_1px_rgb(255_255_255_/_0.16)]"
          style={{ backgroundColor: swatchColor }}
        >
          <input
            ref={pickerRef}
            aria-label={pickerLabel}
            name={`${id}-picker`}
            type="color"
            disabled={disabled}
            className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            value={nativeInspectorColorValue(swatchColor)}
            onInput={(event) => {
              const next = event.currentTarget.value.toUpperCase()
              pickerActiveRef.current = true
              setDraft(next)
              setError(null)
              schedulePreview(next)
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape" || !pickerActiveRef.current) return
              cancelScheduledPreview()
              pickerActiveRef.current = false
              setDraft(canonicalInspectorColorDraft(valueRef.current))
              onPreviewCancelRef.current?.()
            }}
          />
        </span>
        <input
          id={id}
          className="min-w-0 flex-1 bg-transparent font-mono text-[11px] outline-none disabled:cursor-not-allowed disabled:opacity-50"
          value={draft}
          disabled={disabled}
          spellCheck={false}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => {
            setDraft(event.target.value)
            if (error) setError(null)
          }}
          onBlur={() => {
            if (cancelBlurRef.current) {
              cancelBlurRef.current = false
              return
            }
            commit()
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              if (commit()) {
                cancelBlurRef.current = true
                event.currentTarget.blur()
              }
            }
            if (event.key === "Escape") {
              cancelBlurRef.current = true
              setDraft(canonicalInspectorColorDraft(value))
              setError(null)
              event.currentTarget.blur()
            }
          }}
        />
      </div>
      <FieldError id={`${id}-error`} className="text-[11px] leading-4">
        {error}
      </FieldError>
    </Field>
  )
}
