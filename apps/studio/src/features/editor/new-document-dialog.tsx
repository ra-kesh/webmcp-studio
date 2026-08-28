import {
  FileText,
  LayoutTemplate,
  RectangleHorizontal,
  Square,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { FormEvent } from "react"
import { Button } from "@webmcp/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@webmcp/ui/components/dialog"
import { Field, FieldError, FieldLabel } from "@webmcp/ui/components/field"
import { Input } from "@webmcp/ui/components/input"
import type { StarterDocumentMetadata } from "./quotation-starter"
import {
  draftForNewDocumentPreset,
  newDocumentPresets,
  presetIdForDraftDimensions,
  validateNewDocumentDraft,
} from "./new-document-model"
import type {
  NewDocumentDraft,
  NewDocumentDraftErrors,
  NewDocumentOptions,
  NewDocumentPresetId,
} from "./new-document-model"

type NewDocumentActionResult = boolean | "queued"

const presetIcons = {
  portrait: FileText,
  square: Square,
  story: RectangleHorizontal,
} satisfies Record<NewDocumentPresetId, typeof FileText>

export function NewDocumentDialog({
  open,
  onOpenChange,
  onCreateBlank,
  onRestoreDemo,
  onCreated,
  starterMetadata,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreateBlank: (
    options: NewDocumentOptions
  ) => NewDocumentActionResult | Promise<NewDocumentActionResult>
  onRestoreDemo: () =>
    NewDocumentActionResult | Promise<NewDocumentActionResult>
  onCreated?: () => void
  starterMetadata: StarterDocumentMetadata
}) {
  const [draft, setDraft] = useState<NewDocumentDraft>(() =>
    draftForNewDocumentPreset("portrait")
  )
  const [selectedPreset, setSelectedPreset] =
    useState<NewDocumentPresetId | null>("portrait")
  const [errors, setErrors] = useState<NewDocumentDraftErrors>({})
  const [restoringSample, setRestoringSample] = useState(false)
  const [creatingBlank, setCreatingBlank] = useState(false)
  const [sampleError, setSampleError] = useState<string | null>(null)
  const [creationError, setCreationError] = useState<string | null>(null)
  const [nameEdited, setNameEdited] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const widthInputRef = useRef<HTMLInputElement>(null)
  const heightInputRef = useRef<HTMLInputElement>(null)
  const createdDocumentRef = useRef(false)

  useEffect(() => {
    if (!open) return
    setDraft(draftForNewDocumentPreset("portrait"))
    setSelectedPreset("portrait")
    setErrors({})
    setRestoringSample(false)
    setCreatingBlank(false)
    setSampleError(null)
    setCreationError(null)
    setNameEdited(false)
  }, [open])

  const updateName = (name: string) => {
    setDraft((current) => ({ ...current, name }))
    setNameEdited(true)
    setErrors({})
    setCreationError(null)
  }

  const updateDimensions = (
    patch: Partial<Pick<NewDocumentDraft, "width" | "height">>
  ) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    setSelectedPreset(presetIdForDraftDimensions(next))
    setErrors({})
    setCreationError(null)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (restoringSample || creatingBlank) return
    const result = validateNewDocumentDraft(draft)
    if (!result.ok) {
      setErrors(result.errors)
      window.requestAnimationFrame(() => {
        const target = result.errors.name
          ? nameInputRef.current
          : result.errors.width || result.errors.dimensions
            ? widthInputRef.current
            : heightInputRef.current
        target?.focus()
      })
      return
    }
    setCreationError(null)
    setCreatingBlank(true)
    try {
      const outcome = await onCreateBlank(result.options)
      if (outcome === true) {
        createdDocumentRef.current = true
        onOpenChange(false)
      } else if (outcome === "queued") {
        onOpenChange(false)
      } else {
        setCreationError(
          "The document cannot be created while editing is unavailable."
        )
      }
    } catch (error) {
      setCreationError(
        error instanceof Error
          ? error.message
          : "The document could not be created. Try again."
      )
    } finally {
      setCreatingBlank(false)
    }
  }

  const restoreSample = async () => {
    if (creatingBlank || restoringSample) return
    setRestoringSample(true)
    setSampleError(null)
    try {
      const outcome = await onRestoreDemo()
      if (outcome === true) {
        createdDocumentRef.current = true
        onOpenChange(false)
      } else if (outcome === "queued") {
        onOpenChange(false)
      } else {
        setSampleError(
          "The sample cannot be opened while editing is unavailable."
        )
      }
    } catch (error) {
      setSampleError(
        error instanceof Error
          ? error.message
          : "The sample could not be opened. Try again."
      )
    } finally {
      setRestoringSample(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-0 overflow-hidden p-0 sm:max-w-2xl"
        onCloseAutoFocus={(event) => {
          if (!createdDocumentRef.current) return
          event.preventDefault()
          createdDocumentRef.current = false
          onCreated?.()
        }}
      >
        <DialogHeader className="border-b px-5 py-4 pr-14">
          <DialogTitle>Start a document</DialogTitle>
          <DialogDescription className="text-xs">
            Choose a clean canvas or reopen the complete proposal starter.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          aria-label="New document settings"
          autoComplete="off"
          className="grid max-h-[min(78vh,44rem)] gap-5 overflow-y-auto p-4 sm:p-5"
          onSubmit={submit}
        >
          <section>
            <p className="mb-2 text-xs font-medium">Blank formats</p>
            <p className="mb-3 text-xs text-muted-foreground">
              Pick a starting size, then rename or customize it below.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {newDocumentPresets.map(({ id, name, width, height }) => {
                const Icon = presetIcons[id]
                const selected = selectedPreset === id
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={restoringSample || creatingBlank}
                    aria-pressed={selected}
                    className="group flex min-h-24 flex-row items-center gap-3 rounded-lg border bg-background p-3 text-left transition-colors hover:border-foreground/25 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none aria-pressed:border-foreground aria-pressed:bg-muted sm:min-h-28 sm:flex-col sm:items-start sm:justify-between"
                    onClick={() => {
                      const preset = draftForNewDocumentPreset(id)
                      setDraft((current) => ({
                        ...preset,
                        name: nameEdited ? current.name : preset.name,
                      }))
                      setSelectedPreset(id)
                      setErrors({})
                      setCreationError(null)
                    }}
                  >
                    <span className="flex size-8 items-center justify-center rounded-md bg-muted group-hover:bg-background">
                      <Icon className="size-4" />
                    </span>
                    <span>
                      <span className="block text-xs font-medium">{name}</span>
                      <span className="mt-1 block font-mono text-[11px] text-muted-foreground">
                        {width} × {height} px
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
          <section className="rounded-lg border bg-muted/25 p-3 sm:p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                className="sm:col-span-2"
                data-invalid={Boolean(errors.name)}
              >
                <FieldLabel htmlFor="new-document-name">
                  Document name
                </FieldLabel>
                <Input
                  ref={nameInputRef}
                  id="new-document-name"
                  name="documentName"
                  autoComplete="off"
                  disabled={restoringSample || creatingBlank}
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={
                    errors.name ? "new-document-name-error" : undefined
                  }
                  maxLength={80}
                  value={draft.name}
                  onChange={(event) => updateName(event.target.value)}
                />
                {errors.name ? (
                  <FieldError id="new-document-name-error">
                    {errors.name}
                  </FieldError>
                ) : null}
              </Field>
              <Field data-invalid={Boolean(errors.width || errors.dimensions)}>
                <FieldLabel htmlFor="new-document-width">Width</FieldLabel>
                <div className="relative">
                  <Input
                    ref={widthInputRef}
                    id="new-document-width"
                    name="documentWidth"
                    autoComplete="off"
                    disabled={restoringSample || creatingBlank}
                    aria-invalid={Boolean(errors.width || errors.dimensions)}
                    aria-describedby={
                      errors.width
                        ? "new-document-width-error"
                        : errors.dimensions
                          ? "new-document-dimensions-error"
                          : undefined
                    }
                    className="pr-9"
                    inputMode="numeric"
                    value={draft.width}
                    onChange={(event) =>
                      updateDimensions({ width: event.target.value })
                    }
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted-foreground">
                    px
                  </span>
                </div>
                {errors.width ? (
                  <FieldError id="new-document-width-error">
                    {errors.width}
                  </FieldError>
                ) : null}
              </Field>
              <Field data-invalid={Boolean(errors.height || errors.dimensions)}>
                <FieldLabel htmlFor="new-document-height">Height</FieldLabel>
                <div className="relative">
                  <Input
                    ref={heightInputRef}
                    id="new-document-height"
                    name="documentHeight"
                    autoComplete="off"
                    disabled={restoringSample || creatingBlank}
                    aria-invalid={Boolean(errors.height || errors.dimensions)}
                    aria-describedby={
                      errors.height
                        ? "new-document-height-error"
                        : errors.dimensions
                          ? "new-document-dimensions-error"
                          : undefined
                    }
                    className="pr-9"
                    inputMode="numeric"
                    value={draft.height}
                    onChange={(event) =>
                      updateDimensions({ height: event.target.value })
                    }
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted-foreground">
                    px
                  </span>
                </div>
                {errors.height ? (
                  <FieldError id="new-document-height-error">
                    {errors.height}
                  </FieldError>
                ) : null}
              </Field>
            </div>
            {errors.dimensions ? (
              <FieldError id="new-document-dimensions-error" className="mt-3">
                {errors.dimensions}
              </FieldError>
            ) : null}
            {creationError ? (
              <p className="mt-3 text-xs text-destructive" role="alert">
                {creationError}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                className="min-h-11 sm:min-h-9"
                disabled={creatingBlank || restoringSample}
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                className="min-h-11 sm:min-h-9"
                type="submit"
                disabled={restoringSample || creatingBlank}
              >
                {creatingBlank ? "Creating…" : "Create document"}
              </Button>
            </div>
          </section>
          <section>
            <p className="mb-2 text-xs font-medium">Sample proposal</p>
            <p className="mb-3 text-xs text-muted-foreground">
              Optional sample data for exploring the quotation and API workflow.
            </p>
            <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-[#f4efe5] p-3 text-[#1e2622]">
              <div className="grid h-24 w-17 shrink-0 grid-cols-2 overflow-hidden rounded border border-black/10 bg-[#f7f2e8] shadow-sm">
                <div />
                <div className="bg-[#233128]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <LayoutTemplate className="size-4" />
                  <p
                    className="truncate text-sm font-medium"
                    data-testid="starter-document-name"
                  >
                    {starterMetadata.name}
                  </p>
                </div>
                <p
                  className="mt-1 text-xs text-[#5f6f66]"
                  aria-label="Starter document summary"
                >
                  <span data-testid="starter-page-count">
                    {starterMetadata.pageCount}{" "}
                    {starterMetadata.pageCount === 1 ? "page" : "pages"}
                  </span>
                  {" in "}
                  <span data-testid="starter-output-count">
                    {starterMetadata.outputCount}{" "}
                    {starterMetadata.outputCount === 1 ? "output" : "outputs"}
                  </span>
                </p>
                <ul
                  className="mt-1 space-y-0.5 text-xs leading-relaxed text-[#5f6f66]"
                  aria-label="Starter outputs"
                >
                  {starterMetadata.outputs.map((output) => (
                    <li
                      key={output.id}
                      data-output-id={output.id}
                      data-output-name={output.name}
                      data-output-page-count={output.pageCount}
                      data-output-formats={output.exportFormats.join(",")}
                    >
                      <span className="font-medium text-[#34443b]">
                        {output.name}
                      </span>
                      {" · "}
                      {output.pageCount}{" "}
                      {output.pageCount === 1 ? "page" : "pages"}
                      {" · "}
                      {output.exportFormats
                        .map((format) => format.toUpperCase())
                        .join(" + ")}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[11px] leading-relaxed text-[#5f6f66]">
                  {starterMetadata.fieldCount}{" "}
                  {starterMetadata.fieldCount === 1 ? "field" : "fields"},{" "}
                  {starterMetadata.bindingCount}{" "}
                  {starterMetadata.bindingCount === 1 ? "binding" : "bindings"}.
                  Resets the demo API session and clears local render history.
                </p>
              </div>
              <Button
                type="button"
                className="min-h-11 w-full shrink-0 min-[480px]:min-h-9 min-[480px]:w-auto"
                disabled={restoringSample || creatingBlank}
                size="sm"
                onClick={() => void restoreSample()}
              >
                {restoringSample ? "Opening…" : "Open sample"}
              </Button>
            </div>
            {sampleError ? (
              <p className="mt-2 text-xs text-destructive" role="alert">
                {sampleError}
              </p>
            ) : null}
          </section>
        </form>
      </DialogContent>
    </Dialog>
  )
}
