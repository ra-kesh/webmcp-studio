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
    <span className="text-[11px] leading-4 font-normal text-muted-foreground">
      {children}
    </span>
  )
}

export function CommitInput({
  value,
  onCommit,
  className,
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
      className={cn(
        "h-6 rounded-sm border-transparent bg-editor-field px-2 text-[11px] hover:bg-editor-field-hover focus-visible:border-studio-accent focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-studio-accent/20 md:text-[11px]",
        className
      )}
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
      className="max-h-40 min-h-16 resize-y rounded-sm border-transparent bg-editor-field px-2 py-1.5 text-[11px] leading-4 hover:bg-editor-field-hover focus-visible:bg-background md:text-[11px]"
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
  const [draft, setDraft] = useState(value)

  useEffect(() => setDraft(value), [value])

  return (
    <Field className="gap-3" data-disabled={disabled || undefined}>
      <div className="flex items-center justify-between gap-3">
        <FieldLabel className="text-[11px] leading-4 font-normal text-muted-foreground">
          {label}
        </FieldLabel>
        <div className="w-16">
          <InspectorNumberField
            label={`${label} percentage`}
            hideLabel
            value={{ kind: "value", value }}
            min={0}
            max={100}
            suffix="%"
            disabled={disabled}
            onPreview={(next) => setDraft(next)}
            onPreviewCancel={() => setDraft(value)}
            onCommit={(next) => {
              setDraft(next)
              if (next !== value) onCommit(next)
            }}
          />
        </div>
      </div>
      <Slider
        aria-label={label}
        aria-valuetext={`${formatInspectorNumber(draft)}%`}
        value={[draft]}
        disabled={disabled}
        max={100}
        step={1}
        onValueChange={([next]) => setDraft(next)}
        onValueCommit={([next]) => {
          setDraft(next)
          if (next !== value) onCommit(next)
        }}
      />
    </Field>
  )
}

export function InspectorNumberField({
  label,
  compactLabel,
  hideLabel = false,
  value,
  min,
  max,
  step = 1,
  sensitivity = 1,
  integer = false,
  disabled = false,
  suffix,
  onPreview,
  onPreviewCancel,
  onCommit,
}: {
  label: string
  compactLabel?: string
  hideLabel?: boolean
  value: InspectorSharedValue<number>
  min?: number
  max?: number
  step?: number
  sensitivity?: number
  integer?: boolean
  disabled?: boolean
  suffix?: string
  onPreview?: (value: number) => void
  onPreviewCancel?: () => void
  onCommit: (value: number) => void
}) {
  const id = useId()
  const canonical = value.kind === "value" ? value.value : undefined
  const canonicalDraft =
    canonical === undefined ? "" : formatInspectorNumber(canonical)
  const [draft, setDraft] = useState(canonicalDraft)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [scrubbing, setScrubbing] = useState(false)
  const cancelBlurRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const previewFrameRef = useRef<number | null>(null)
  const previewValueRef = useRef(canonical ?? 0)
  const onPreviewRef = useRef(onPreview)
  const onPreviewCancelRef = useRef(onPreviewCancel)
  const onCommitRef = useRef(onCommit)
  const interactionRef = useRef<{
    pointerId: number
    startX: number
    lastX: number
    startValue: number
    value: number
    moved: boolean
    previewed: boolean
  } | null>(null)
  onPreviewRef.current = onPreview
  onPreviewCancelRef.current = onPreviewCancel
  onCommitRef.current = onCommit

  const cancelScheduledPreview = () => {
    if (previewFrameRef.current === null) return
    globalThis.cancelAnimationFrame(previewFrameRef.current)
    previewFrameRef.current = null
  }

  const flushPreview = () => {
    cancelScheduledPreview()
    onPreviewRef.current?.(previewValueRef.current)
  }

  const schedulePreview = (next: number) => {
    previewValueRef.current = next
    if (!onPreviewRef.current || previewFrameRef.current !== null) return
    previewFrameRef.current = globalThis.requestAnimationFrame(() => {
      previewFrameRef.current = null
      onPreviewRef.current?.(previewValueRef.current)
    })
  }

  const normalizedScrubValue = (next: number) => {
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next))
    if (integer) return Math.round(clamped)
    return Number(clamped.toFixed(6))
  }

  useEffect(() => {
    if (editing || interactionRef.current) return
    setDraft(canonicalDraft)
    setError(null)
  }, [canonicalDraft, editing, value.kind])

  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  useEffect(
    () => () => {
      cancelScheduledPreview()
      if (interactionRef.current?.previewed) onPreviewCancelRef.current?.()
      interactionRef.current = null
    },
    []
  )

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

  const startEditing = () => {
    if (disabled) return
    setEditing(true)
  }

  const finishScrub = (
    target: HTMLDivElement,
    pointerId: number,
    cancelled: boolean
  ) => {
    const interaction = interactionRef.current
    if (!interaction || interaction.pointerId !== pointerId) return
    if (target.hasPointerCapture(pointerId))
      target.releasePointerCapture(pointerId)
    interactionRef.current = null
    setScrubbing(false)

    if (cancelled) {
      cancelScheduledPreview()
      setDraft(canonicalDraft)
      setError(null)
      if (interaction.previewed) onPreviewCancelRef.current?.()
      return
    }

    if (!interaction.moved) {
      startEditing()
      return
    }

    if (interaction.previewed) flushPreview()
    if (interaction.value !== interaction.startValue) {
      onCommitRef.current(interaction.value)
    }
  }

  return (
    <Field
      className="min-w-0 gap-1"
      data-invalid={Boolean(error) || undefined}
      data-mixed={value.kind === "mixed" || undefined}
      data-disabled={disabled || undefined}
    >
      <FieldLabel
        htmlFor={id}
        className={
          compactLabel || hideLabel
            ? "sr-only"
            : "text-[11px] leading-4 font-normal text-muted-foreground"
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
      <div
        aria-disabled={disabled || undefined}
        aria-label={label}
        aria-valuemax={max}
        aria-valuemin={min}
        aria-valuenow={canonical}
        data-disabled={disabled || undefined}
        data-editing={editing || undefined}
        data-invalid={Boolean(error) || undefined}
        data-mixed={value.kind === "mixed" || undefined}
        data-scrubbing={scrubbing || undefined}
        data-slot="inspector-number-field"
        role={editing ? undefined : "spinbutton"}
        tabIndex={editing || disabled ? -1 : 0}
        className={cn(
          "group flex h-6 min-w-0 items-center overflow-hidden rounded-sm border border-transparent bg-editor-field font-mono text-[11px] tabular-nums transition-[background-color,border-color,box-shadow] outline-none hover:bg-editor-field-hover focus-visible:border-studio-accent focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-studio-accent/20 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[invalid]:border-destructive data-[invalid]:ring-2 data-[invalid]:ring-destructive/20 data-[scrubbing]:cursor-ew-resize data-[scrubbing]:select-none",
          !editing && !disabled && "cursor-ew-resize touch-none"
        )}
        onFocus={() => {
          if (!editing) setError(null)
        }}
        onKeyDown={(event) => {
          if (editing || disabled) return
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            startEditing()
            return
          }
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
          event.preventDefault()
          const multiplier = event.shiftKey ? 10 : event.altKey ? 0.1 : 1
          const direction = event.key === "ArrowUp" ? 1 : -1
          const next = normalizedScrubValue(
            (canonical ?? 0) + direction * step * multiplier
          )
          setDraft(formatInspectorNumber(next))
          onCommitRef.current(next)
        }}
        onPointerDown={(event) => {
          if (editing || disabled || event.button !== 0) return
          event.preventDefault()
          event.currentTarget.focus({ preventScroll: true })
          interactionRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            lastX: event.clientX,
            startValue: canonical ?? 0,
            value: canonical ?? 0,
            moved: false,
            previewed: false,
          }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const interaction = interactionRef.current
          if (!interaction || interaction.pointerId !== event.pointerId) return
          const totalDelta = event.clientX - interaction.startX
          if (!interaction.moved && Math.abs(totalDelta) <= 2) return
          interaction.moved = true
          setScrubbing(true)
          const delta = event.clientX - interaction.lastX
          interaction.lastX = event.clientX
          interaction.value = normalizedScrubValue(
            interaction.value + delta * step * sensitivity
          )
          interaction.previewed = true
          setDraft(formatInspectorNumber(interaction.value))
          setError(null)
          schedulePreview(interaction.value)
        }}
        onPointerUp={(event) =>
          finishScrub(event.currentTarget, event.pointerId, false)
        }
        onPointerCancel={(event) =>
          finishScrub(event.currentTarget, event.pointerId, true)
        }
      >
        {compactLabel ? (
          <span
            aria-hidden="true"
            className="pointer-events-none flex h-full shrink-0 items-center justify-center px-[5px] text-[10px] leading-none text-muted-foreground select-none"
          >
            {compactLabel}
          </span>
        ) : null}
        {editing ? (
          <Input
            ref={inputRef}
            id={id}
            aria-label={label}
            inputMode="decimal"
            value={draft}
            placeholder={value.kind === "mixed" ? "Mixed" : undefined}
            disabled={disabled}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            className={cn(
              "h-full w-0 min-w-0 flex-1 cursor-text rounded-none border-0 bg-transparent px-0 pr-1.5 font-mono text-[11px] shadow-none ring-0 outline-none hover:bg-transparent focus-visible:border-0 focus-visible:bg-transparent focus-visible:ring-0 md:text-[11px]",
              !compactLabel && "pl-1.5"
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
              if (commit()) setEditing(false)
            }}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === "Enter") {
                event.preventDefault()
                if (commit()) {
                  cancelBlurRef.current = true
                  setEditing(false)
                }
                return
              }
              if (event.key === "Escape") {
                event.preventDefault()
                cancelBlurRef.current = true
                setDraft(canonicalDraft)
                setError(null)
                setEditing(false)
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
              const next = normalizedScrubValue(
                base + direction * step * multiplier
              )
              setDraft(formatInspectorNumber(next))
              setError(null)
            }}
          />
        ) : (
          <span
            className={cn(
              "min-w-0 flex-1 truncate pr-1.5 text-foreground select-none",
              !compactLabel && "pl-1.5"
            )}
          >
            {value.kind === "mixed" ? "Mixed" : draft}
          </span>
        )}
        {suffix ? (
          <span className="pointer-events-none shrink-0 pr-1.5 text-[11px] text-muted-foreground select-none">
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
      className="gap-1"
      data-invalid={Boolean(error) || undefined}
      data-disabled={disabled || undefined}
    >
      <FieldLabel
        htmlFor={id}
        className="text-[11px] leading-4 font-normal text-muted-foreground"
      >
        {label}
      </FieldLabel>
      <div className="flex h-6 items-center gap-2 rounded-sm border border-transparent bg-editor-field px-1.5 transition-colors hover:bg-editor-field-hover has-[:focus-visible]:border-studio-accent has-[:focus-visible]:bg-background has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-studio-accent/20 has-[input[aria-invalid=true]]:border-destructive has-[input[aria-invalid=true]]:ring-2 has-[input[aria-invalid=true]]:ring-destructive/20">
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
