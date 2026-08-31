"use client"

import { useEffect, useRef, useState } from "react"
import { ExternalLink, Link2, Unlink2, X } from "lucide-react"

import { isSafeTextLinkTarget } from "@webmcp/document"
import type { TextSelectionLinkState } from "@webmcp/document"
import { Button } from "@webmcp/ui/components/button"
import { Input } from "@webmcp/ui/components/input"
import { cn } from "@webmcp/ui/lib/utils"

const schemelessWebTarget =
  /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}(?:[/?#].*)?$/i

export function normalizeTextLinkTargetInput(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const candidate = schemelessWebTarget.test(trimmed)
    ? `https://${trimmed}`
    : trimmed
  return isSafeTextLinkTarget(candidate) ? candidate : null
}

export type TextLinkEditorResult = Readonly<{
  target: string
  newTab: boolean
}> | null

export function TextLinkEditor({
  link,
  onApply,
  onCancel,
  className,
}: {
  link: TextSelectionLinkState
  onApply: (value: TextLinkEditorResult) => void
  onCancel: () => void
  className?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [target, setTarget] = useState(link.kind === "value" ? link.target : "")
  const [newTab, setNewTab] = useState(
    link.kind === "value" ? link.newTab : true
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true })
    inputRef.current?.select()
  }, [])

  const submit = () => {
    const normalized = normalizeTextLinkTargetInput(target)
    if (!normalized) {
      setError("Use an https://, mailto:, or tel: link.")
      return
    }
    onApply({
      target: normalized,
      newTab: normalized.startsWith("https://") ? newTab : false,
    })
  }

  return (
    <form
      aria-label="Edit selected text link"
      aria-modal="false"
      className={cn(
        "w-[min(22rem,calc(100vw-1rem))] rounded-xl border bg-background p-3 shadow-xl ring-1 ring-black/5",
        className
      )}
      data-editor-overlay-control="true"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return
        event.preventDefault()
        event.stopPropagation()
        onCancel()
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      role="dialog"
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <Link2 className="size-3.5" />
            {link.kind === "mixed" ? "Replace selected links" : "Text link"}
          </div>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
            Link only the selected characters.
          </p>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Close link editor"
          className="-mt-1 -mr-1 size-7 rounded-md"
          onClick={onCancel}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <label className="text-[11px] font-medium text-muted-foreground">
        Destination
        <Input
          ref={inputRef}
          value={target}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "text-link-error" : "text-link-help"}
          className="mt-1 h-9 text-xs"
          placeholder="https://example.com"
          onChange={(event) => {
            setTarget(event.target.value)
            setError(null)
          }}
        />
      </label>
      {error ? (
        <p id="text-link-error" className="mt-1 text-[11px] text-destructive">
          {error}
        </p>
      ) : (
        <p
          id="text-link-help"
          className="mt-1 text-[11px] text-muted-foreground"
        >
          Web addresses may omit https://. Email and phone links must include
          mailto: or tel:.
        </p>
      )}
      <label className="mt-3 flex min-h-8 items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={newTab}
          className="size-3.5 rounded border-input accent-foreground"
          disabled={
            target.trim().startsWith("mailto:") ||
            target.trim().startsWith("tel:")
          }
          onChange={(event) => setNewTab(event.target.checked)}
        />
        <ExternalLink className="size-3.5 text-muted-foreground" />
        Open web links in a new tab
      </label>
      <div className="mt-3 flex items-center justify-between gap-2">
        {link.kind !== "none" ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 px-2 text-xs text-destructive hover:text-destructive"
            onClick={() => onApply(null)}
          >
            <Unlink2 className="size-3.5" />
            Remove link
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" className="gap-1.5">
            <Link2 className="size-3.5" />
            {link.kind === "mixed" ? "Replace" : "Apply"}
          </Button>
        </div>
      </div>
    </form>
  )
}
