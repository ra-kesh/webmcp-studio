import { useEffect, useId, useRef, useState } from "react"
import type { ComponentProps } from "react"
import type { InspectorSharedValue } from "@webmcp/editor/inspector"
import {
  formatInspectorNumber,
  parseInspectorNumber,
} from "@webmcp/editor/inspector"
import { Field, FieldError, FieldLabel } from "@webmcp/ui/components/field"
import { Input } from "@webmcp/ui/components/input"
import { Slider } from "@webmcp/ui/components/slider"
import { Textarea } from "@webmcp/ui/components/textarea"

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
  const [draft, setDraft] = useState(String(value))
  const cancelBlurRef = useRef(false)
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    if (draft !== String(value)) onCommit(draft)
  }
  return (
    <Input
      {...props}
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
  const [draft, setDraft] = useState(value)
  const cancelBlurRef = useRef(false)
  useEffect(() => setDraft(value), [value])
  return (
    <Textarea
      className="min-h-24 resize-y text-xs leading-relaxed"
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
          className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase"
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
            className="h-7 pr-5 text-right font-mono text-[10px] tabular-nums"
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
            className="pointer-events-none absolute inset-y-0 right-2 flex items-center font-mono text-[10px] text-muted-foreground"
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
  value,
  min,
  max,
  integer = false,
  disabled = false,
  suffix,
  onCommit,
}: {
  label: string
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
        className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase"
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
        <Input
          id={id}
          aria-label={label}
          inputMode="decimal"
          value={draft}
          placeholder={value.kind === "mixed" ? "Mixed" : undefined}
          disabled={disabled}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={suffix ? "pr-8" : undefined}
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
          <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center font-mono text-[10px] text-muted-foreground">
            {suffix}
          </span>
        ) : null}
      </div>
      <FieldError id={`${id}-error`} className="text-[10px] leading-4">
        {error}
      </FieldError>
    </Field>
  )
}

export function InspectorColorField({
  label,
  value,
  disabled = false,
  onCommit,
}: {
  label: string
  value: string
  disabled?: boolean
  onCommit: (value: string) => void
}) {
  const id = useId()
  const [draft, setDraft] = useState(value.toUpperCase())
  const [error, setError] = useState<string | null>(null)
  const cancelBlurRef = useRef(false)
  useEffect(() => {
    setDraft(value.toUpperCase())
    setError(null)
  }, [value])

  const commit = (nextDraft = draft) => {
    const normalized = nextDraft.trim().toUpperCase()
    if (!/^#[0-9A-F]{6}$/.test(normalized)) {
      setError(`${label} must be a six-digit hex color.`)
      return false
    }
    setError(null)
    setDraft(normalized)
    if (normalized !== value.toUpperCase()) onCommit(normalized)
    return true
  }

  return (
    <Field
      className="gap-1.5"
      data-invalid={Boolean(error) || undefined}
      data-disabled={disabled || undefined}
    >
      <FieldLabel
        htmlFor={id}
        className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase"
      >
        {label}
      </FieldLabel>
      <div className="flex h-8 items-center gap-2 rounded-lg border border-input px-2 has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 has-[input[aria-invalid=true]]:border-destructive has-[input[aria-invalid=true]]:ring-3 has-[input[aria-invalid=true]]:ring-destructive/20">
        <input
          aria-label={`${label} color picker`}
          type="color"
          disabled={disabled}
          className="size-4 shrink-0 cursor-pointer appearance-none overflow-hidden rounded-sm border-0 bg-transparent p-0 disabled:cursor-not-allowed disabled:opacity-50"
          value={/^#[0-9A-F]{6}$/i.test(draft) ? draft : value}
          onChange={(event) => {
            const next = event.target.value.toUpperCase()
            setDraft(next)
            commit(next)
          }}
        />
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
              setDraft(value.toUpperCase())
              setError(null)
              event.currentTarget.blur()
            }
          }}
        />
      </div>
      <FieldError id={`${id}-error`} className="text-[10px] leading-4">
        {error}
      </FieldError>
    </Field>
  )
}
