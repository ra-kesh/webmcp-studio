import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import type { FormEvent, RefObject } from "react"
import { PAGE_GUIDE_LIMIT } from "@webmcp/editor/page-guides"
import type { GuideAxis, PageGuide, PageSize } from "@webmcp/editor/page-guides"
import { Button } from "@webmcp/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@webmcp/ui/components/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@webmcp/ui/components/empty"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@webmcp/ui/components/field"
import { Input } from "@webmcp/ui/components/input"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@webmcp/ui/components/toggle-group"
import { Crosshair, Plus, Trash2 } from "lucide-react"

type GuideMutation = Readonly<{ axis: GuideAxis; position: number }>

export type GuideManagerDialogProps = Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  pageName: string
  pageSize: PageSize
  guides: readonly PageGuide[]
  onAddGuide: (guide: GuideMutation) => void
  onMoveGuide: (guideId: string, position: number) => void
  onRemoveGuide: (guideId: string) => void
  returnFocusRef?: RefObject<HTMLElement | null>
}>

const guideAxisLabel = (axis: GuideAxis) =>
  axis === "x" ? "Vertical" : "Horizontal"

const guideAxisLimit = (axis: GuideAxis, pageSize: PageSize) =>
  axis === "x" ? pageSize.width : pageSize.height

const formatCoordinate = (position: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(
    position
  )

export function validateGuidePosition(
  rawValue: string,
  axis: GuideAxis,
  pageSize: PageSize
): { value: number; error: null } | { value: null; error: string } {
  if (rawValue.trim() === "") {
    return { value: null, error: "Enter a coordinate." }
  }
  const value = Number(rawValue)
  if (!Number.isFinite(value)) {
    return { value: null, error: "Enter a finite number." }
  }
  const limit = guideAxisLimit(axis, pageSize)
  if (value < 0 || value > limit) {
    return {
      value: null,
      error: `Enter a coordinate from 0 to ${formatCoordinate(limit)}.`,
    }
  }
  return { value, error: null }
}

function ExistingGuideRow({
  guide,
  pageSize,
  onMoveGuide,
  onRemoveGuide,
  onAnnounce,
}: Readonly<{
  guide: PageGuide
  pageSize: PageSize
  onMoveGuide: GuideManagerDialogProps["onMoveGuide"]
  onRemoveGuide: GuideManagerDialogProps["onRemoveGuide"]
  onAnnounce: (message: string) => void
}>) {
  const inputId = useId()
  const errorId = `${inputId}-error`
  const [value, setValue] = useState(String(guide.position))
  const [error, setError] = useState<string | null>(null)
  const axisLabel = guideAxisLabel(guide.axis)
  const limit = guideAxisLimit(guide.axis, pageSize)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const result = validateGuidePosition(value, guide.axis, pageSize)
    if (result.value === null) {
      setError(result.error)
      return
    }
    setError(null)
    if (result.value === guide.position) {
      onAnnounce(
        `${axisLabel} guide is already at ${formatCoordinate(result.value)}.`
      )
      return
    }
    onMoveGuide(guide.id, result.value)
    onAnnounce(`${axisLabel} guide moved to ${formatCoordinate(result.value)}.`)
  }

  return (
    <li className="border-b last:border-b-0">
      <form
        className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 py-3"
        onSubmit={submit}
      >
        <Field data-invalid={Boolean(error)}>
          <div className="flex items-baseline justify-between gap-3">
            <FieldLabel htmlFor={inputId}>{axisLabel} guide</FieldLabel>
            <span className="font-mono text-[10px] text-muted-foreground">
              0–{formatCoordinate(limit)} px
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Input
              id={inputId}
              aria-describedby={error ? errorId : undefined}
              aria-invalid={Boolean(error)}
              inputMode="decimal"
              max={limit}
              min={0}
              step="any"
              type="number"
              value={value}
              onChange={(event) => {
                setValue(event.currentTarget.value)
                if (error) setError(null)
              }}
            />
            <span
              className="shrink-0 text-xs text-muted-foreground"
              aria-hidden="true"
            >
              px
            </span>
          </div>
          {error ? <FieldError id={errorId}>{error}</FieldError> : null}
        </Field>
        <div className="flex items-center gap-1 pb-px">
          <Button size="sm" type="submit" variant="outline">
            Update
          </Button>
          <Button
            aria-label={`Remove ${axisLabel.toLowerCase()} guide at ${formatCoordinate(guide.position)}`}
            size="icon-sm"
            type="button"
            variant="ghost"
            onClick={() => {
              onRemoveGuide(guide.id)
              onAnnounce(`${axisLabel} guide removed.`)
            }}
          >
            <Trash2 className="text-destructive" />
          </Button>
        </div>
      </form>
    </li>
  )
}

export function GuideManagerDialog({
  open,
  onOpenChange,
  pageName,
  pageSize,
  guides,
  onAddGuide,
  onMoveGuide,
  onRemoveGuide,
  returnFocusRef,
}: GuideManagerDialogProps) {
  const axisId = useId()
  const positionId = useId()
  const positionErrorId = `${positionId}-error`
  const capturedFocusRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)
  const [axis, setAxis] = useState<GuideAxis>("x")
  const [position, setPosition] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState("")

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      capturedFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
      setAxis("x")
      setPosition("")
      setError(null)
      setAnnouncement("")
    }
    wasOpenRef.current = open
  }, [open])

  useLayoutEffect(() => {
    if (open || !wasOpenRef.current) return
    const target = returnFocusRef?.current ?? capturedFocusRef.current
    if (!target?.isConnected) return
    target.focus()
    queueMicrotask(() => {
      if (target.isConnected) target.focus()
    })
  }, [open, returnFocusRef])

  const addGuide = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const result = validateGuidePosition(position, axis, pageSize)
    if (result.value === null) {
      setError(result.error)
      return
    }
    setError(null)
    onAddGuide({ axis, position: result.value })
    setPosition("")
    setAnnouncement(
      `${guideAxisLabel(axis)} guide added at ${formatCoordinate(result.value)}.`
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="grid max-h-[min(42rem,calc(100dvh-2rem))] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-lg"
        onCloseAutoFocus={(event) => {
          const target = returnFocusRef?.current ?? capturedFocusRef.current
          if (!target?.isConnected) return
          event.preventDefault()
          target.focus()
          queueMicrotask(() => {
            if (target.isConnected) target.focus()
          })
        }}
      >
        <DialogHeader className="border-b px-5 py-4 pr-14">
          <DialogTitle>Manage guides</DialogTitle>
          <DialogDescription>
            Add exact page coordinates for {pageName}. Guides stay in the editor
            and do not appear in exports.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto">
          <form className="border-b bg-muted/25 px-5 py-4" onSubmit={addGuide}>
            <FieldGroup className="gap-3">
              <Field>
                <FieldLabel id={axisId}>Direction</FieldLabel>
                <ToggleGroup
                  aria-labelledby={axisId}
                  className="w-full"
                  spacing={0}
                  type="single"
                  value={axis}
                  variant="outline"
                  onValueChange={(value) => {
                    if (value === "x" || value === "y") {
                      setAxis(value)
                      setError(null)
                    }
                  }}
                >
                  <ToggleGroupItem className="flex-1" value="x">
                    Vertical
                  </ToggleGroupItem>
                  <ToggleGroupItem className="flex-1" value="y">
                    Horizontal
                  </ToggleGroupItem>
                </ToggleGroup>
              </Field>
              <Field data-invalid={Boolean(error)}>
                <FieldLabel htmlFor={positionId}>Position on page</FieldLabel>
                <div className="flex items-center gap-2">
                  <Input
                    id={positionId}
                    aria-describedby={error ? positionErrorId : undefined}
                    aria-invalid={Boolean(error)}
                    inputMode="decimal"
                    max={guideAxisLimit(axis, pageSize)}
                    min={0}
                    placeholder={`0–${formatCoordinate(guideAxisLimit(axis, pageSize))}`}
                    step="any"
                    type="number"
                    value={position}
                    onChange={(event) => {
                      setPosition(event.currentTarget.value)
                      if (error) setError(null)
                    }}
                  />
                  <span
                    className="shrink-0 text-xs text-muted-foreground"
                    aria-hidden="true"
                  >
                    px
                  </span>
                  <Button
                    disabled={guides.length >= PAGE_GUIDE_LIMIT}
                    type="submit"
                  >
                    <Plus data-icon="inline-start" />
                    Add guide
                  </Button>
                </div>
                {error ? (
                  <FieldError id={positionErrorId}>{error}</FieldError>
                ) : null}
              </Field>
            </FieldGroup>
          </form>

          <section aria-labelledby="page-guides-heading" className="px-5 py-4">
            <div className="flex items-baseline justify-between gap-4">
              <h3 id="page-guides-heading" className="text-xs font-medium">
                Guides on this page
              </h3>
              <span className="font-mono text-[10px] text-muted-foreground">
                {guides.length} / {PAGE_GUIDE_LIMIT}
              </span>
            </div>

            {guides.length === 0 ? (
              <Empty className="mt-3 min-h-40 border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Crosshair />
                  </EmptyMedia>
                  <EmptyTitle>No guides on this page</EmptyTitle>
                  <EmptyDescription>
                    Add an exact coordinate above, or drag from a ruler on the
                    canvas.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ul className="mt-2" aria-label={`Guides on ${pageName}`}>
                {guides.map((guide) => (
                  <ExistingGuideRow
                    key={`${guide.id}:${guide.position}`}
                    guide={guide}
                    pageSize={pageSize}
                    onAnnounce={setAnnouncement}
                    onMoveGuide={onMoveGuide}
                    onRemoveGuide={onRemoveGuide}
                  />
                ))}
              </ul>
            )}

            <p
              className="sr-only"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {announcement}
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
