import { useState } from "react"
import {
  Check,
  ChevronDown,
  Code2,
  Eye,
  Layers3,
  MousePointer2,
  Plus,
  Redo2,
  Send,
  Sparkles,
  Square,
  Type,
  Undo2,
  X,
} from "lucide-react"
import { northstarSeed } from "@webmcp/document"
import { Artboard } from "@webmcp/render-view"
import { toolCatalog } from "@webmcp/webmcp"
import { Badge } from "@webmcp/ui/components/badge"
import { Button } from "@webmcp/ui/components/button"
import { Input } from "@webmcp/ui/components/input"
import { ScrollArea } from "@webmcp/ui/components/scroll-area"
import { Separator } from "@webmcp/ui/components/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@webmcp/ui/components/tooltip"

const toolbar = [
  { label: "Select", icon: MousePointer2 },
  { label: "Text", icon: Type },
  { label: "Shape", icon: Square },
  { label: "Assets", icon: Layers3 },
] as const

const proposedOperations = [
  { id: "op-title", summary: "Update package name across 2 outputs" },
  { id: "op-price", summary: "Set package price to ₹4,10,000" },
  { id: "op-image", summary: "Replace the cover photograph" },
] as const

type Decision = "pending" | "accepted" | "rejected"

function ToolButton({ label, icon: Icon }: (typeof toolbar)[number]) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={label} size="icon-sm" variant="ghost">
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function StudioShell() {
  const [activePageId, setActivePageId] = useState("cover")
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const activePage =
    northstarSeed.pages.find((page) => page.id === activePageId) ??
    northstarSeed.pages[0]
  if (!activePage) return null

  const setDecision = (operationId: string, decision: Decision) => {
    setDecisions((current) => ({ ...current, [operationId]: decision }))
  }

  return (
    <main className="flex h-svh min-w-[1080px] flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
        <div className="flex min-w-56 items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Sparkles className="size-3.5" />
          </div>
          <div className="flex min-w-0 flex-col leading-none">
            <span className="truncate text-sm font-medium">
              Aditi &amp; Kabir proposal pack
            </span>
            <span className="mt-1 text-[10px] text-muted-foreground">
              Draft · Revision {northstarSeed.revision}
            </span>
          </div>
        </div>

        <Separator className="h-5" orientation="vertical" />
        <div className="flex items-center gap-1">
          {toolbar.map((item) => (
            <ToolButton key={item.label} {...item} />
          ))}
        </div>
        <Separator className="h-5" orientation="vertical" />
        <div className="flex items-center gap-1">
          <Button aria-label="Undo" size="icon-sm" variant="ghost">
            <Undo2 />
          </Button>
          <Button aria-label="Redo" size="icon-sm" variant="ghost">
            <Redo2 />
          </Button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Badge variant="outline">
            <Eye data-icon="inline-start" />
            All changes saved
          </Badge>
          <Button size="sm" variant="outline">
            <Code2 data-icon="inline-start" />
            API
          </Button>
          <Button size="sm">
            <Send data-icon="inline-start" />
            Publish template
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(520px,1fr)_320px]">
        <aside className="flex min-h-0 flex-col border-r bg-background">
          <div className="flex h-11 items-center justify-between px-3">
            <span className="text-xs font-medium">Outputs</span>
            <Button aria-label="Add output" size="icon-xs" variant="ghost">
              <Plus />
            </Button>
          </div>
          <Separator />
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-1 p-2">
              {northstarSeed.outputs.map((output) => (
                <div key={output.id} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <span className="text-[11px] font-medium">
                      {output.name}
                    </span>
                    <Badge variant="ghost">{output.pageIds.length}</Badge>
                  </div>
                  {output.pageIds.map((pageId) => {
                    const page = northstarSeed.pages.find(
                      (candidate) => candidate.id === pageId
                    )
                    if (!page) return null
                    const scale = 54 / page.width
                    return (
                      <Button
                        key={page.id}
                        className="h-auto w-full justify-start gap-3 p-2"
                        variant={
                          activePageId === page.id ? "secondary" : "ghost"
                        }
                        onClick={() => setActivePageId(page.id)}
                      >
                        <Artboard
                          className="shrink-0 overflow-hidden rounded-sm border shadow-sm"
                          document={northstarSeed}
                          pageId={page.id}
                          scale={scale}
                        />
                        <span className="min-w-0 truncate text-xs">
                          {page.name}
                        </span>
                      </Button>
                    )
                  })}
                </div>
              ))}
            </div>
          </ScrollArea>
        </aside>

        <section className="relative flex min-h-0 flex-col bg-workspace">
          <div className="flex h-11 items-center justify-center border-b bg-background/90 px-3">
            <span className="text-xs text-muted-foreground">
              {activePage.name} · {activePage.width} × {activePage.height}
            </span>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-10">
            <Artboard
              className="overflow-hidden rounded-sm shadow-2xl ring-1 ring-foreground/10"
              document={northstarSeed}
              pageId={activePage.id}
              scale={0.34}
            />
          </div>
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border bg-background p-1 shadow-sm">
            <Button size="xs" variant="ghost">
              34%
            </Button>
            <ChevronDown className="size-3 text-muted-foreground" />
          </div>
        </section>

        <aside className="flex min-h-0 flex-col border-l bg-background">
          <div className="flex h-11 items-center px-4">
            <span className="text-xs font-medium">Properties</span>
            <Badge className="ml-auto" variant="secondary">
              5 shared fields
            </Badge>
          </div>
          <Separator />
          <ScrollArea className="min-h-0 flex-1">
            <section className="flex flex-col gap-3 p-4">
              <div>
                <h2 className="text-xs font-medium">Template fields</h2>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  One value updates every bound output.
                </p>
              </div>
              {northstarSeed.fields.map((field) => (
                <label key={field.id} className="flex flex-col gap-1.5">
                  <span className="text-[11px] text-muted-foreground">
                    {field.label}
                  </span>
                  <Input
                    readOnly
                    value={String(northstarSeed.fieldValues[field.id] ?? "")}
                  />
                </label>
              ))}
            </section>

            <Separator />
            <section className="flex flex-col gap-3 p-4">
              <div className="flex items-start gap-2">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary">
                  <Sparkles className="size-3.5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-xs font-medium">Agent change set</h2>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    3 proposed operations against revision{" "}
                    {northstarSeed.revision}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                {proposedOperations.map((operation) => {
                  const decision = decisions[operation.id] ?? "pending"
                  return (
                    <div
                      key={operation.id}
                      className="flex items-start gap-2 rounded-lg border p-2.5"
                    >
                      <p className="min-w-0 flex-1 text-[11px] leading-relaxed">
                        {operation.summary}
                      </p>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          aria-label={`Reject ${operation.summary}`}
                          size="icon-xs"
                          variant={
                            decision === "rejected" ? "destructive" : "ghost"
                          }
                          onClick={() => setDecision(operation.id, "rejected")}
                        >
                          <X />
                        </Button>
                        <Button
                          aria-label={`Accept ${operation.summary}`}
                          size="icon-xs"
                          variant={
                            decision === "accepted" ? "default" : "ghost"
                          }
                          onClick={() => setDecision(operation.id, "accepted")}
                        >
                          <Check />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
              <Button size="sm">Apply accepted changes</Button>
            </section>

            <Separator />
            <section className="flex flex-col gap-2 p-4">
              <h2 className="text-xs font-medium">WebMCP on this route</h2>
              <div className="flex flex-wrap gap-1.5">
                {toolCatalog
                  .filter((tool) => tool.routes.includes("editor"))
                  .map((tool) => (
                    <Badge
                      key={tool.name}
                      variant="outline"
                      className="font-mono text-[9px]"
                    >
                      {tool.name}
                    </Badge>
                  ))}
              </div>
            </section>
          </ScrollArea>
        </aside>
      </div>
    </main>
  )
}
