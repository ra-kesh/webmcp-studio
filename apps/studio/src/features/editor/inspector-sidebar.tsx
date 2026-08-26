import { useEffect, useState, type ComponentProps } from "react"
import {
  AlignCenter,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignHorizontalSpaceBetween,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalSpaceBetween,
  BringToFront,
  Check,
  CopyPlus,
  Eye,
  EyeOff,
  ImageUp,
  Lock,
  SendToBack,
  Sparkles,
  Square,
  Trash2,
  Unlock,
  X,
} from "lucide-react"
import type { Document, SceneNode } from "@webmcp/document"
import type { Alignment } from "@webmcp/editor/geometry"
import { toolCatalog } from "@webmcp/webmcp"
import { Badge } from "@webmcp/ui/components/badge"
import { Button } from "@webmcp/ui/components/button"
import { EditorPanelTabsList } from "@webmcp/ui/components/editor-chrome"
import { Input } from "@webmcp/ui/components/input"
import { ScrollArea } from "@webmcp/ui/components/scroll-area"
import { Separator } from "@webmcp/ui/components/separator"
import { Slider } from "@webmcp/ui/components/slider"
import { Tabs, TabsContent, TabsTrigger } from "@webmcp/ui/components/tabs"
import { Textarea } from "@webmcp/ui/components/textarea"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@webmcp/ui/components/toggle-group"
import { cn } from "@webmcp/ui/lib/utils"

type Decision = "pending" | "accepted" | "rejected" | "applied"

const proposals = [
  {
    id: "proposal-name",
    fieldId: "package_name",
    value: "The Saffron Weekend",
    summary: "Rename the package across proposal and WhatsApp card",
  },
  {
    id: "proposal-price",
    fieldId: "package_price",
    value: "₹4,10,000",
    summary: "Update package price across both bound outputs",
  },
] as const

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </span>
  )
}

function CommitInput({
  value,
  onCommit,
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange"> & {
  value: string | number
  onCommit(value: string): void
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    if (draft !== String(value)) onCommit(draft)
  }
  return (
    <Input
      {...props}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur()
        if (event.key === "Escape") {
          setDraft(String(value))
          event.currentTarget.blur()
        }
      }}
    />
  )
}

function CommitTextarea({
  value,
  onCommit,
}: {
  value: string
  onCommit(value: string): void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <Textarea
      className="min-h-24 resize-y text-xs leading-relaxed"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
    />
  )
}

function NumberField({
  label,
  value,
  onCommit,
}: {
  label: string
  value: number
  onCommit(value: number): void
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <CommitInput
        inputMode="decimal"
        value={Math.round(value * 10) / 10}
        onCommit={(next) => {
          const parsed = Number(next)
          if (Number.isFinite(parsed)) onCommit(parsed)
        }}
      />
    </label>
  )
}

function ColorField({
  label,
  value,
  onCommit,
}: {
  label: string
  value: string
  onCommit(value: string): void
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <div className="flex h-8 items-center gap-2 rounded-lg border px-2">
        <input
          aria-label={`${label} color picker`}
          type="color"
          className="size-4 cursor-pointer appearance-none overflow-hidden rounded-sm border-0 bg-transparent p-0"
          value={value}
          onChange={(event) => onCommit(event.target.value)}
        />
        <span className="font-mono text-[11px] text-muted-foreground">
          {value.toUpperCase()}
        </span>
      </div>
    </label>
  )
}

const alignmentActions = [
  ["Align left", "left", AlignHorizontalJustifyStart],
  [
    "Align horizontal centers",
    "horizontal-center",
    AlignHorizontalJustifyCenter,
  ],
  ["Align right", "right", AlignHorizontalJustifyEnd],
  ["Align top", "top", AlignVerticalJustifyStart],
  ["Align vertical centers", "vertical-center", AlignVerticalJustifyCenter],
  ["Align bottom", "bottom", AlignVerticalJustifyEnd],
] as const

function AlignmentGrid({
  onAlign,
  disabled = false,
}: {
  onAlign(alignment: Alignment): void
  disabled?: boolean
}) {
  return (
    <div className="grid grid-cols-6 gap-1">
      {alignmentActions.map(([label, alignment, Icon]) => (
        <Button
          key={alignment}
          aria-label={label}
          title={label}
          disabled={disabled}
          size="icon"
          variant="outline"
          onClick={() => onAlign(alignment)}
        >
          <Icon />
        </Button>
      ))}
    </div>
  )
}

function NodeInspector({
  node,
  onUpdate,
  onAlignToPage,
  onReplaceImage,
}: {
  node: SceneNode
  onUpdate(patch: Partial<SceneNode>): void
  onAlignToPage(alignment: Alignment): void
  onReplaceImage(nodeId: string): void
}) {
  return (
    <div className="flex flex-col">
      <section className="flex flex-col gap-3 p-4">
        <div className="flex items-end gap-2">
          <label className="min-w-0 flex-1 space-y-1.5">
            <FieldLabel>Layer name</FieldLabel>
            <CommitInput
              value={node.name}
              onCommit={(name) => name.trim() && onUpdate({ name })}
            />
          </label>
          <Button
            aria-label={node.visible ? "Hide layer" : "Show layer"}
            size="icon"
            variant="outline"
            onClick={() => onUpdate({ visible: !node.visible })}
          >
            {node.visible ? <Eye /> : <EyeOff />}
          </Button>
          <Button
            aria-label={node.locked ? "Unlock layer" : "Lock layer"}
            size="icon"
            variant="outline"
            onClick={() => onUpdate({ locked: !node.locked })}
          >
            {node.locked ? <Lock /> : <Unlock />}
          </Button>
        </div>
      </section>

      <Separator />
      <section className="flex flex-col gap-3 p-4">
        <FieldLabel>Align to page</FieldLabel>
        <AlignmentGrid onAlign={onAlignToPage} disabled={node.locked} />
      </section>

      <Separator />
      <section className="flex flex-col gap-3 p-4">
        <FieldLabel>Position &amp; size</FieldLabel>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="X"
            value={node.x}
            onCommit={(x) => onUpdate({ x })}
          />
          <NumberField
            label="Y"
            value={node.y}
            onCommit={(y) => onUpdate({ y })}
          />
          <NumberField
            label="Width"
            value={node.width}
            onCommit={(width) => width > 0 && onUpdate({ width })}
          />
          <NumberField
            label="Height"
            value={node.height}
            onCommit={(height) => height > 0 && onUpdate({ height })}
          />
        </div>
        <NumberField
          label="Rotation"
          value={node.rotation}
          onCommit={(rotation) => onUpdate({ rotation })}
        />
      </section>

      <Separator />
      <section className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <FieldLabel>Opacity</FieldLabel>
          <span className="font-mono text-[10px] text-muted-foreground">
            {Math.round(node.opacity * 100)}%
          </span>
        </div>
        <Slider
          value={[node.opacity * 100]}
          max={100}
          step={1}
          onValueCommit={([value]) =>
            value !== undefined && onUpdate({ opacity: value / 100 })
          }
        />
      </section>

      {node.type === "text" ? (
        <>
          <Separator />
          <section className="flex flex-col gap-3 p-4">
            <FieldLabel>Text</FieldLabel>
            <CommitTextarea
              value={node.text}
              onCommit={(text) => onUpdate({ text })}
            />
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="Font size"
                value={node.fontSize}
                onCommit={(fontSize) => fontSize > 0 && onUpdate({ fontSize })}
              />
              <NumberField
                label="Weight"
                value={node.fontWeight}
                onCommit={(fontWeight) =>
                  onUpdate({
                    fontWeight: Math.min(
                      900,
                      Math.max(100, Math.round(fontWeight / 100) * 100)
                    ),
                  })
                }
              />
            </div>
            <ColorField
              label="Text color"
              value={node.color}
              onCommit={(color) => onUpdate({ color })}
            />
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
              {[
                ["left", AlignLeft],
                ["center", AlignCenter],
                ["right", AlignRight],
              ].map(([align, Icon]) => (
                <Button
                  key={align as string}
                  aria-label={`Align ${align as string}`}
                  size="sm"
                  variant={node.align === align ? "secondary" : "ghost"}
                  onClick={() =>
                    onUpdate({ align: align as "left" | "center" | "right" })
                  }
                >
                  <Icon />
                </Button>
              ))}
            </div>
          </section>
        </>
      ) : null}

      {node.type === "rect" ? (
        <>
          <Separator />
          <section className="flex flex-col gap-3 p-4">
            <ColorField
              label="Fill"
              value={node.fill}
              onCommit={(fill) => onUpdate({ fill })}
            />
            <NumberField
              label="Corner radius"
              value={node.radius}
              onCommit={(radius) => onUpdate({ radius: Math.max(0, radius) })}
            />
          </section>
        </>
      ) : null}

      {node.type === "ellipse" || node.type === "icon" ? (
        <>
          <Separator />
          <section className="flex flex-col gap-3 p-4">
            <ColorField
              label="Fill"
              value={node.fill}
              onCommit={(fill) => onUpdate({ fill })}
            />
            <ColorField
              label="Stroke"
              value={node.stroke ?? "#1e2622"}
              onCommit={(stroke) => onUpdate({ stroke })}
            />
            <NumberField
              label="Stroke width"
              value={node.strokeWidth}
              onCommit={(strokeWidth) =>
                onUpdate({ strokeWidth: Math.max(0, strokeWidth) })
              }
            />
          </section>
        </>
      ) : null}

      {node.type === "line" ? (
        <>
          <Separator />
          <section className="flex flex-col gap-3 p-4">
            <ColorField
              label="Stroke"
              value={node.stroke}
              onCommit={(stroke) => onUpdate({ stroke })}
            />
            <NumberField
              label="Stroke width"
              value={node.strokeWidth}
              onCommit={(strokeWidth) =>
                strokeWidth > 0 && onUpdate({ strokeWidth })
              }
            />
          </section>
        </>
      ) : null}

      {node.type === "image" ? (
        <>
          <Separator />
          <section className="flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between gap-3">
              <FieldLabel>Image fit</FieldLabel>
              <ToggleGroup
                type="single"
                size="sm"
                spacing={0}
                variant="outline"
                value={node.fit}
                onValueChange={(fit) =>
                  fit && onUpdate({ fit: fit as "cover" | "contain" })
                }
              >
                <ToggleGroupItem value="cover">Cover</ToggleGroupItem>
                <ToggleGroupItem value="contain">Contain</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <label className="flex flex-col gap-2">
              <span className="flex items-center justify-between">
                <FieldLabel>Horizontal focus</FieldLabel>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {Math.round(node.cropX * 100)}%
                </span>
              </span>
              <Slider
                value={[node.cropX * 100]}
                max={100}
                step={1}
                onValueCommit={([value]) =>
                  value !== undefined && onUpdate({ cropX: value / 100 })
                }
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="flex items-center justify-between">
                <FieldLabel>Vertical focus</FieldLabel>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {Math.round(node.cropY * 100)}%
                </span>
              </span>
              <Slider
                value={[node.cropY * 100]}
                max={100}
                step={1}
                onValueCommit={([value]) =>
                  value !== undefined && onUpdate({ cropY: value / 100 })
                }
              />
            </label>
            <label className="space-y-1.5">
              <FieldLabel>Alternative text</FieldLabel>
              <CommitInput
                placeholder="Describe the image"
                value={node.alt}
                onCommit={(alt) => onUpdate({ alt })}
              />
            </label>
            {node.src.startsWith("asset:local/") ||
            node.assetId.startsWith("library-") ? (
              <div className="space-y-1.5">
                <FieldLabel>Source</FieldLabel>
                <div className="rounded-lg border bg-muted/40 px-2.5 py-2">
                  <p className="text-xs font-medium">
                    {node.assetId.startsWith("library-")
                      ? "Studio library asset"
                      : "Uploaded image"}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                    {node.assetId}
                  </p>
                </div>
              </div>
            ) : (
              <label className="space-y-1.5">
                <FieldLabel>Image URL</FieldLabel>
                <CommitInput
                  value={node.src}
                  onCommit={(src) => onUpdate({ src })}
                />
              </label>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => onReplaceImage(node.id)}
            >
              <ImageUp data-icon="inline-start" />
              Replace image…
            </Button>
          </section>
        </>
      ) : null}
    </div>
  )
}

function MultiSelectionInspector({
  nodes,
  onAlign,
  onAlignToPage,
  onDistribute,
  onSetLocked,
  onSetVisible,
  onReorder,
  onDuplicate,
  onDelete,
}: {
  nodes: SceneNode[]
  onAlign(alignment: Alignment): void
  onAlignToPage(alignment: Alignment): void
  onDistribute(distribution: "horizontal" | "vertical"): void
  onSetLocked(locked: boolean): void
  onSetVisible(visible: boolean): void
  onReorder(edge: "front" | "back"): void
  onDuplicate(): void
  onDelete(): void
}) {
  const movableCount = nodes.filter((node) => !node.locked).length
  const allLocked = nodes.every((node) => node.locked)
  return (
    <div className="flex flex-col">
      <section className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xs font-medium">{nodes.length} layers</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Transform and arrange as one selection.
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              aria-label="Hide selected layers"
              title="Hide selected layers"
              size="icon-sm"
              variant="outline"
              onClick={() => onSetVisible(false)}
            >
              <EyeOff />
            </Button>
            <Button
              aria-label={
                allLocked ? "Unlock selected layers" : "Lock selected layers"
              }
              title={
                allLocked ? "Unlock selected layers" : "Lock selected layers"
              }
              size="icon-sm"
              variant="outline"
              onClick={() => onSetLocked(!allLocked)}
            >
              {allLocked ? <Unlock /> : <Lock />}
            </Button>
          </div>
        </div>
      </section>

      <Separator />
      <section className="flex flex-col gap-3 p-4">
        <FieldLabel>Align</FieldLabel>
        <AlignmentGrid onAlign={onAlign} disabled={movableCount < 2} />
        <div className="grid grid-cols-2 gap-2">
          <Button
            disabled={movableCount < 3}
            size="sm"
            variant="outline"
            onClick={() => onDistribute("horizontal")}
          >
            <AlignHorizontalSpaceBetween data-icon="inline-start" />
            Space across
          </Button>
          <Button
            disabled={movableCount < 3}
            size="sm"
            variant="outline"
            onClick={() => onDistribute("vertical")}
          >
            <AlignVerticalSpaceBetween data-icon="inline-start" />
            Space down
          </Button>
        </div>
        <FieldLabel>Align selection to page</FieldLabel>
        <AlignmentGrid onAlign={onAlignToPage} disabled={!movableCount} />
      </section>

      <Separator />
      <section className="flex flex-col gap-3 p-4">
        <FieldLabel>Layer order</FieldLabel>
        <div className="grid grid-cols-2 gap-2">
          <Button
            disabled={!movableCount}
            size="sm"
            variant="outline"
            onClick={() => onReorder("front")}
          >
            <BringToFront data-icon="inline-start" />
            To front
          </Button>
          <Button
            disabled={!movableCount}
            size="sm"
            variant="outline"
            onClick={() => onReorder("back")}
          >
            <SendToBack data-icon="inline-start" />
            To back
          </Button>
        </div>
      </section>

      <Separator />
      <section className="grid grid-cols-2 gap-2 p-4">
        <Button size="sm" variant="outline" onClick={onDuplicate}>
          <CopyPlus data-icon="inline-start" />
          Duplicate
        </Button>
        <Button size="sm" variant="destructive" onClick={onDelete}>
          <Trash2 data-icon="inline-start" />
          Delete
        </Button>
      </section>
    </div>
  )
}

function FieldsPanel({
  document,
  onUpdateField,
}: {
  document: Document
  onUpdateField(fieldId: string, value: string | number | boolean): void
}) {
  return (
    <section className="flex flex-col gap-4 p-4">
      <div>
        <h2 className="text-xs font-medium">Template fields</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          Change one value and every bound output stays in sync.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {document.fields.map((field) => (
          <label key={field.id} className="flex flex-col gap-1.5">
            <FieldLabel>{field.label}</FieldLabel>
            <CommitInput
              value={String(document.fieldValues[field.id] ?? "")}
              onCommit={(value) => onUpdateField(field.id, value)}
            />
          </label>
        ))}
      </div>
    </section>
  )
}

function ReviewPanel({
  revision,
  onUpdateField,
}: {
  revision: number
  onUpdateField(fieldId: string, value: string): void
}) {
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const accepted = proposals.filter(
    (proposal) => decisions[proposal.id] === "accepted"
  )
  const applyAccepted = () => {
    for (const proposal of accepted) {
      onUpdateField(proposal.fieldId, proposal.value)
    }
    setDecisions((current) => ({
      ...current,
      ...Object.fromEntries(
        accepted.map((proposal) => [proposal.id, "applied"])
      ),
    }))
  }

  return (
    <div className="flex flex-col">
      <section className="flex flex-col gap-3 p-4">
        <div className="flex items-start gap-2.5">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-secondary">
            <Sparkles className="size-3.5" />
          </div>
          <div>
            <h2 className="text-xs font-medium">Agent change set</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Review changes against revision {revision} before they touch the
              document.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          {proposals.map((proposal) => {
            const decision = decisions[proposal.id] ?? "pending"
            return (
              <div key={proposal.id} className="rounded-lg border p-2.5">
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 text-[11px] leading-relaxed">
                    {proposal.summary}
                  </p>
                  {decision === "applied" ? (
                    <Badge variant="secondary">Applied</Badge>
                  ) : (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        aria-label={`Reject ${proposal.summary}`}
                        size="icon-xs"
                        variant={
                          decision === "rejected" ? "destructive" : "ghost"
                        }
                        onClick={() =>
                          setDecisions((current) => ({
                            ...current,
                            [proposal.id]: "rejected",
                          }))
                        }
                      >
                        <X />
                      </Button>
                      <Button
                        aria-label={`Accept ${proposal.summary}`}
                        size="icon-xs"
                        variant={decision === "accepted" ? "default" : "ghost"}
                        onClick={() =>
                          setDecisions((current) => ({
                            ...current,
                            [proposal.id]: "accepted",
                          }))
                        }
                      >
                        <Check />
                      </Button>
                    </div>
                  )}
                </div>
                <div className="mt-2 rounded-md bg-muted px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
                  {proposal.value}
                </div>
              </div>
            )
          })}
        </div>
        <Button size="sm" disabled={!accepted.length} onClick={applyAccepted}>
          Apply {accepted.length || "accepted"} change
          {accepted.length === 1 ? "" : "s"}
        </Button>
      </section>
      <Separator />
      <section className="flex flex-col gap-2.5 p-4">
        <div>
          <h2 className="text-xs font-medium">WebMCP tools on this route</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            The same document commands are exposed to browser agents.
          </p>
        </div>
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
    </div>
  )
}

export function InspectorSidebar({
  document,
  selectedNodes,
  onUpdateNode,
  onUpdateField,
  onAlignSelection,
  onAlignSelectionToPage,
  onDistributeSelection,
  onSetSelectionLocked,
  onSetSelectionVisible,
  onReorderSelection,
  onDuplicateSelection,
  onDeleteSelection,
  onReplaceImage,
  className,
}: {
  document: Document
  selectedNodes: SceneNode[]
  onUpdateNode(nodeId: string, patch: Partial<SceneNode>): void
  onUpdateField(fieldId: string, value: string | number | boolean): void
  onAlignSelection(alignment: Alignment): void
  onAlignSelectionToPage(alignment: Alignment): void
  onDistributeSelection(distribution: "horizontal" | "vertical"): void
  onSetSelectionLocked(locked: boolean): void
  onSetSelectionVisible(visible: boolean): void
  onReorderSelection(edge: "front" | "back"): void
  onDuplicateSelection(): void
  onDeleteSelection(): void
  onReplaceImage(nodeId: string): void
  className?: string
}) {
  const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : undefined
  return (
    <aside
      className={cn("flex min-h-0 flex-col border-l bg-background", className)}
    >
      <Tabs defaultValue="design" className="min-h-0 flex-1 gap-0">
        <EditorPanelTabsList aria-label="Inspector panels">
          <TabsTrigger value="design" className="flex-none px-2.5 text-xs">
            Design
          </TabsTrigger>
          <TabsTrigger value="fields" className="flex-none px-2.5 text-xs">
            Fields
          </TabsTrigger>
          <TabsTrigger value="review" className="flex-none px-2.5 text-xs">
            Review
          </TabsTrigger>
        </EditorPanelTabsList>
        <TabsContent value="design" className="min-h-0">
          <ScrollArea className="h-full">
            {selectedNode ? (
              <NodeInspector
                node={selectedNode}
                onUpdate={(patch) => onUpdateNode(selectedNode.id, patch)}
                onAlignToPage={onAlignSelectionToPage}
                onReplaceImage={onReplaceImage}
              />
            ) : selectedNodes.length > 1 ? (
              <MultiSelectionInspector
                nodes={selectedNodes}
                onAlign={onAlignSelection}
                onAlignToPage={onAlignSelectionToPage}
                onDistribute={onDistributeSelection}
                onSetLocked={onSetSelectionLocked}
                onSetVisible={onSetSelectionVisible}
                onReorder={onReorderSelection}
                onDuplicate={onDuplicateSelection}
                onDelete={onDeleteSelection}
              />
            ) : (
              <div className="flex min-h-56 flex-col items-center justify-center px-8 text-center">
                <div className="mb-3 flex size-9 items-center justify-center rounded-lg border bg-muted/40">
                  <Square className="size-4 text-muted-foreground" />
                </div>
                <p className="text-xs font-medium">Nothing selected</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  Select an object on the canvas or in Layers to edit its
                  properties.
                </p>
              </div>
            )}
          </ScrollArea>
        </TabsContent>
        <TabsContent value="fields" className="min-h-0">
          <ScrollArea className="h-full">
            <FieldsPanel document={document} onUpdateField={onUpdateField} />
          </ScrollArea>
        </TabsContent>
        <TabsContent value="review" className="min-h-0">
          <ScrollArea className="h-full">
            <ReviewPanel
              revision={document.revision}
              onUpdateField={onUpdateField}
            />
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </aside>
  )
}
