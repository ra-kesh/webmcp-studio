import { FilePlus2, ImagePlus, LayoutTemplate, Type } from "lucide-react"
import { Button } from "@webmcp/ui/components/button"

export function EmptyCanvasActions({
  disabled = false,
  onAddText,
  onAddImage,
  onChooseTemplate,
  onAddPage,
}: {
  disabled?: boolean
  onAddText: () => void
  onAddImage: () => void
  onChooseTemplate: () => void
  onAddPage: () => void
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center p-4">
      <section
        aria-label="Empty page actions"
        data-editor-overlay-control="true"
        className="pointer-events-auto w-full max-w-sm rounded-xl border bg-background/96 p-4 text-center shadow-lg backdrop-blur-sm sm:p-5"
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
          <FilePlus2 className="size-4" />
        </div>
        <h2 className="mt-3 text-sm font-medium">Start this page</h2>
        <p className="mx-auto mt-1 max-w-72 text-xs leading-5 text-muted-foreground">
          Add content directly, or begin with a reusable design template.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
          <Button
            className="min-h-11 sm:min-h-9"
            disabled={disabled}
            onClick={onAddText}
          >
            <Type />
            Add text
          </Button>
          <Button
            className="min-h-11 sm:min-h-9"
            disabled={disabled}
            variant="outline"
            onClick={onAddImage}
          >
            <ImagePlus />
            Add image
          </Button>
          <Button
            className="min-h-11 sm:min-h-9"
            disabled={disabled}
            variant="outline"
            onClick={onChooseTemplate}
          >
            <LayoutTemplate />
            Choose template
          </Button>
          <Button
            className="min-h-11 sm:min-h-9"
            disabled={disabled}
            variant="outline"
            onClick={onAddPage}
          >
            <FilePlus2 />
            Add page
          </Button>
        </div>
        {disabled ? (
          <p className="mt-3 text-xs text-muted-foreground" role="status">
            Resolve the current review or recovery state before editing.
          </p>
        ) : null}
      </section>
    </div>
  )
}
