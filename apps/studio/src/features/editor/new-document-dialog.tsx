import {
  FileText,
  LayoutTemplate,
  RectangleHorizontal,
  Square,
} from "lucide-react"
import { Button } from "@webmcp/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@webmcp/ui/components/dialog"

const presets = [
  {
    id: "portrait",
    name: "Portrait document",
    dimensions: "1240 × 1754",
    width: 1240,
    height: 1754,
    Icon: FileText,
  },
  {
    id: "square",
    name: "Square social",
    dimensions: "1080 × 1080",
    width: 1080,
    height: 1080,
    Icon: Square,
  },
  {
    id: "story",
    name: "Social story",
    dimensions: "1080 × 1920",
    width: 1080,
    height: 1920,
    Icon: RectangleHorizontal,
  },
] as const

export function NewDocumentDialog({
  open,
  onOpenChange,
  onCreateBlank,
  onRestoreDemo,
}: {
  open: boolean
  onOpenChange(open: boolean): void
  onCreateBlank(options: { name: string; width: number; height: number }): void
  onRestoreDemo(): void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 py-4 pr-14">
          <DialogTitle>Start a document</DialogTitle>
          <DialogDescription className="text-xs">
            Choose a clean canvas or reopen the complete proposal starter.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 p-5">
          <section>
            <p className="mb-2 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              Blank formats
            </p>
            <div className="grid grid-cols-3 gap-2">
              {presets.map(({ id, name, dimensions, width, height, Icon }) => (
                <button
                  key={id}
                  type="button"
                  className="group flex min-h-32 flex-col justify-between rounded-lg border bg-background p-3 text-left transition-colors hover:border-foreground/25 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                  onClick={() => {
                    onCreateBlank({ name, width, height })
                    onOpenChange(false)
                  }}
                >
                  <span className="flex size-8 items-center justify-center rounded-md bg-muted group-hover:bg-background">
                    <Icon className="size-4" />
                  </span>
                  <span>
                    <span className="block text-xs font-medium">{name}</span>
                    <span className="mt-1 block font-mono text-[10px] text-muted-foreground">
                      {dimensions}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
          <section>
            <p className="mb-2 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              Starter gallery
            </p>
            <div className="flex items-center gap-4 rounded-lg border bg-[#f4efe5] p-3 text-[#1e2622]">
              <div className="grid h-24 w-17 shrink-0 grid-cols-2 overflow-hidden rounded border border-black/10 bg-[#f7f2e8] shadow-sm">
                <div />
                <div className="bg-[#233128]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <LayoutTemplate className="size-4" />
                  <p className="text-sm font-medium">Northstar proposal pack</p>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-[#5f6f66]">
                  Five proposal pages plus WhatsApp and follow-up outputs,
                  fields, bindings, and production-ready structure.
                </p>
              </div>
              <Button
                className="shrink-0"
                size="sm"
                onClick={() => {
                  onRestoreDemo()
                  onOpenChange(false)
                }}
              >
                Use starter
              </Button>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
