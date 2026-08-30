import type { StudioCommandPaletteItem } from "./command-palette"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@webmcp/ui/components/dialog"

export const CANVAS_TRANSFORM_SHORTCUTS = Object.freeze([
  { label: "Preserve proportions while resizing", shortcut: "Shift" },
  { label: "Snap rotation to 15°", shortcut: "Shift" },
  { label: "Resize from the center", shortcut: "Alt / Option" },
])

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
  items,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: readonly StudioCommandPaletteItem[]
}) {
  const categories = new Map<string, StudioCommandPaletteItem[]>()
  for (const item of items) {
    if (!item.shortcut) continue
    const category = categories.get(item.category)
    if (category) category.push(item)
    else categories.set(item.category, [item])
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(44rem,calc(100vh-2rem))] overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Commands use the shortcuts shown for this computer. Canvas modifiers
            apply while you drag a transform handle.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 grid-cols-1 gap-x-8 gap-y-6 overflow-y-auto px-5 py-5 sm:grid-cols-2">
          <section aria-labelledby="shortcut-canvas-modifiers">
            <h3
              id="shortcut-canvas-modifiers"
              className="mb-2 text-xs font-medium text-muted-foreground"
            >
              Canvas modifiers
            </h3>
            <dl className="space-y-1">
              {CANVAS_TRANSFORM_SHORTCUTS.map((item) => (
                <div
                  key={item.label}
                  className="flex min-h-8 items-center justify-between gap-4 rounded-md px-2 text-sm hover:bg-muted/60"
                >
                  <dt className="min-w-0 truncate">{item.label}</dt>
                  <dd>
                    <kbd className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground shadow-xs">
                      {item.shortcut}
                    </kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          {[...categories.entries()].map(([category, commands]) => (
            <section key={category} aria-labelledby={`shortcut-${category}`}>
              <h3
                id={`shortcut-${category}`}
                className="mb-2 text-xs font-medium text-muted-foreground"
              >
                {category}
              </h3>
              <dl className="space-y-1">
                {commands.map((item) => (
                  <div
                    key={item.id}
                    className="flex min-h-8 items-center justify-between gap-4 rounded-md px-2 text-sm hover:bg-muted/60"
                  >
                    <dt className="min-w-0 truncate">{item.label}</dt>
                    <dd>
                      <kbd className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground shadow-xs">
                        {item.shortcut}
                      </kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
