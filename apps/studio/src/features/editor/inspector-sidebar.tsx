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
  Database,
  Eye,
  EyeOff,
  ImageUp,
  Lock,
  Link2,
  Plus,
  SendToBack,
  Sparkles,
  Square,
  Settings2,
  Trash2,
  Unlock,
  Unlink,
  X,
} from "lucide-react"
import {
  bindingPropertiesForNode,
  fieldCanBindToProperty,
  type BindableProperty,
  type ChangeOperation,
  type ChangeSet,
  type Document,
  type FieldDefinition,
  type SceneNode,
} from "@webmcp/document"
import type { Alignment } from "@webmcp/editor/geometry"
import { toolCatalog } from "@webmcp/webmcp"
import { Badge } from "@webmcp/ui/components/badge"
import { Button } from "@webmcp/ui/components/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@webmcp/ui/components/alert-dialog"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@webmcp/ui/components/dialog"
import { EditorPanelTabsList } from "@webmcp/ui/components/editor-chrome"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@webmcp/ui/components/empty"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel as FormFieldLabel,
} from "@webmcp/ui/components/field"
import { Input } from "@webmcp/ui/components/input"
import { ScrollArea } from "@webmcp/ui/components/scroll-area"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@webmcp/ui/components/select"
import { Separator } from "@webmcp/ui/components/separator"
import { Slider } from "@webmcp/ui/components/slider"
import { Tabs, TabsContent, TabsTrigger } from "@webmcp/ui/components/tabs"
import { Textarea } from "@webmcp/ui/components/textarea"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@webmcp/ui/components/toggle-group"
import { cn } from "@webmcp/ui/lib/utils"

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
            <label className="space-y-1.5">
              <FieldLabel>Font family</FieldLabel>
              <CommitInput
                value={node.fontFamily}
                onCommit={(fontFamily) =>
                  fontFamily.trim() &&
                  onUpdate({ fontFamily: fontFamily.trim() })
                }
              />
            </label>
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
              <NumberField
                label="Line height"
                value={node.lineHeight}
                onCommit={(lineHeight) =>
                  onUpdate({
                    lineHeight: Math.min(3, Math.max(0.5, lineHeight)),
                  })
                }
              />
              <NumberField
                label="Letter spacing"
                value={node.letterSpacing}
                onCommit={(letterSpacing) =>
                  onUpdate({
                    letterSpacing: Math.min(200, Math.max(-20, letterSpacing)),
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

const fieldTypes: Array<{
  value: FieldDefinition["type"]
  label: string
}> = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "currency", label: "Currency" },
  { value: "date", label: "Date" },
  { value: "asset", label: "Image asset" },
  { value: "boolean", label: "Boolean" },
]

const bindingPropertyLabels: Record<BindableProperty, string> = {
  text: "Text content",
  src: "Image source",
  visible: "Visibility",
  fill: "Fill color",
}

const fieldKeyFromLabel = (label: string) =>
  label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[^a-z]+/, "")

const defaultValueForType = (
  type: FieldDefinition["type"]
): string | number | boolean => {
  if (type === "boolean") return true
  if (type === "number") return 0
  return ""
}

const parseFieldDraft = (
  type: FieldDefinition["type"],
  value: string
): string | number | boolean => {
  if (type === "boolean") return value === "true"
  if (type === "number") return Number(value)
  return value
}

function FieldDefinitionDialog({
  field,
  fields,
  trigger,
  onSave,
}: {
  field?: FieldDefinition
  fields: FieldDefinition[]
  trigger: React.ReactNode
  onSave(field: Omit<FieldDefinition, "id">): void
}) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState("")
  const [key, setKey] = useState("")
  const [keyEdited, setKeyEdited] = useState(false)
  const [type, setType] = useState<FieldDefinition["type"]>("text")
  const [required, setRequired] = useState(false)
  const [defaultDraft, setDefaultDraft] = useState("")

  useEffect(() => {
    if (!open) return
    setLabel(field?.label ?? "")
    setKey(field?.key ?? "")
    setKeyEdited(Boolean(field))
    setType(field?.type ?? "text")
    setRequired(field?.required ?? false)
    setDefaultDraft(String(field?.defaultValue ?? ""))
  }, [field, open])

  const parsedDefault = parseFieldDraft(type, defaultDraft)
  const keyMalformed = Boolean(key) && !/^[a-z][a-z0-9_]*$/.test(key)
  const keyDuplicate = fields.some(
    (candidate) => candidate.id !== field?.id && candidate.key === key
  )
  const keyInvalid = keyMalformed || keyDuplicate
  const valid =
    label.trim().length > 0 &&
    /^[a-z][a-z0-9_]*$/.test(key) &&
    !keyDuplicate &&
    !(type === "number" && !Number.isFinite(parsedDefault))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{field ? "Edit field" : "Create field"}</DialogTitle>
          <DialogDescription>
            Shared values keep repeated content synchronized across outputs.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!valid) return
            onSave({
              key,
              label: label.trim(),
              type,
              required,
              defaultValue: parsedDefault,
            })
            setOpen(false)
          }}
        >
          <FieldGroup className="gap-4">
            <Field>
              <FormFieldLabel htmlFor={`${field?.id ?? "new"}-field-label`}>
                Label
              </FormFieldLabel>
              <Input
                id={`${field?.id ?? "new"}-field-label`}
                value={label}
                placeholder="Package name"
                onChange={(event) => {
                  const nextLabel = event.target.value
                  setLabel(nextLabel)
                  if (!keyEdited) setKey(fieldKeyFromLabel(nextLabel))
                }}
              />
            </Field>
            <Field data-invalid={keyInvalid}>
              <FormFieldLabel htmlFor={`${field?.id ?? "new"}-field-key`}>
                API key
              </FormFieldLabel>
              <Input
                id={`${field?.id ?? "new"}-field-key`}
                aria-invalid={keyInvalid}
                value={key}
                placeholder="package_name"
                onChange={(event) => {
                  setKey(event.target.value.toLowerCase())
                  setKeyEdited(true)
                }}
              />
              {keyDuplicate ? (
                <FieldError>That API key is already in use.</FieldError>
              ) : (
                <FieldDescription>
                  Lowercase letters, numbers, and underscores.
                </FieldDescription>
              )}
            </Field>
            <Field>
              <FormFieldLabel>Value type</FormFieldLabel>
              <Select
                value={type}
                onValueChange={(nextType: FieldDefinition["type"]) => {
                  setType(nextType)
                  setDefaultDraft(String(defaultValueForType(nextType)))
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectGroup>
                    {fieldTypes.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FormFieldLabel>Default value</FormFieldLabel>
              {type === "boolean" ? (
                <ToggleGroup
                  type="single"
                  value={defaultDraft || "true"}
                  variant="outline"
                  spacing={1}
                  onValueChange={(value) => value && setDefaultDraft(value)}
                >
                  <ToggleGroupItem className="flex-1" value="true">
                    True
                  </ToggleGroupItem>
                  <ToggleGroupItem className="flex-1" value="false">
                    False
                  </ToggleGroupItem>
                </ToggleGroup>
              ) : (
                <Input
                  value={defaultDraft}
                  type={type === "number" ? "number" : "text"}
                  placeholder={type === "asset" ? "https://…" : "Value"}
                  onChange={(event) => setDefaultDraft(event.target.value)}
                />
              )}
            </Field>
            <Field>
              <FormFieldLabel>Requirement</FormFieldLabel>
              <ToggleGroup
                type="single"
                value={required ? "required" : "optional"}
                variant="outline"
                spacing={1}
                onValueChange={(value) =>
                  value && setRequired(value === "required")
                }
              >
                <ToggleGroupItem className="flex-1" value="optional">
                  Optional
                </ToggleGroupItem>
                <ToggleGroupItem className="flex-1" value="required">
                  Required
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!valid}>
              {field ? "Save changes" : "Create field"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function FieldValueEditor({
  field,
  value,
  onCommit,
}: {
  field: FieldDefinition
  value: string | number | boolean
  onCommit(value: string | number | boolean): void
}) {
  if (field.type === "boolean") {
    return (
      <ToggleGroup
        type="single"
        value={value ? "true" : "false"}
        variant="outline"
        spacing={1}
        onValueChange={(next) => next && onCommit(next === "true")}
      >
        <ToggleGroupItem className="flex-1" value="true">
          True
        </ToggleGroupItem>
        <ToggleGroupItem className="flex-1" value="false">
          False
        </ToggleGroupItem>
      </ToggleGroup>
    )
  }
  return (
    <CommitInput
      value={String(value)}
      inputMode={field.type === "number" ? "decimal" : undefined}
      onCommit={(next) => {
        if (field.type !== "number") return onCommit(next)
        const parsed = Number(next)
        if (Number.isFinite(parsed)) onCommit(parsed)
      }}
    />
  )
}

function FieldsPanel({
  document,
  selectedNodes,
  onUpdateField,
  onCreateField,
  onUpdateFieldDefinition,
  onRemoveField,
  onBindField,
  onUnbindField,
}: {
  document: Document
  selectedNodes: SceneNode[]
  onUpdateField(fieldId: string, value: string | number | boolean): void
  onCreateField(field: Omit<FieldDefinition, "id">): void
  onUpdateFieldDefinition(
    fieldId: string,
    patch: Partial<Omit<FieldDefinition, "id">>
  ): void
  onRemoveField(fieldId: string): void
  onBindField(fieldId: string, nodeId: string, property: BindableProperty): void
  onUnbindField(bindingId: string): void
}) {
  const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : undefined
  const properties = selectedNode
    ? bindingPropertiesForNode(selectedNode)
    : ([] as BindableProperty[])
  const [property, setProperty] = useState<BindableProperty>(
    properties[0] ?? "text"
  )
  const compatibleFields = selectedNode
    ? document.fields.filter((field) =>
        fieldCanBindToProperty(field, selectedNode, property)
      )
    : []
  const [bindingFieldId, setBindingFieldId] = useState("")

  useEffect(() => {
    const nextProperty = selectedNode
      ? bindingPropertiesForNode(selectedNode)[0]
      : undefined
    if (nextProperty) setProperty(nextProperty)
    setBindingFieldId("")
  }, [selectedNode?.id])

  useEffect(() => {
    if (
      bindingFieldId &&
      !compatibleFields.some((field) => field.id === bindingFieldId)
    ) {
      setBindingFieldId("")
    }
  }, [bindingFieldId, compatibleFields])

  const selectedBindings = selectedNode
    ? document.bindings.filter((binding) => binding.nodeId === selectedNode.id)
    : []
  const boundProperties = new Set(
    selectedBindings.map((binding) => binding.property)
  )
  const outputByNode = new Map(
    document.pages.flatMap((page) =>
      page.nodeIds.map((nodeId) => [nodeId, page.outputId] as const)
    )
  )

  return (
    <div className="flex flex-col">
      <section className="flex flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xs font-medium">Shared fields</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Change one value and every bound output stays in sync.
            </p>
          </div>
          <FieldDefinitionDialog
            fields={document.fields}
            trigger={
              <Button size="sm" variant="outline">
                <Plus data-icon="inline-start" />
                New
              </Button>
            }
            onSave={onCreateField}
          />
        </div>

        {document.fields.length ? (
          <div className="flex flex-col gap-2">
            {document.fields.map((field) => {
              const bindings = document.bindings.filter(
                (binding) => binding.fieldId === field.id
              )
              const outputCount = new Set(
                bindings.flatMap((binding) => {
                  const outputId = outputByNode.get(binding.nodeId)
                  return outputId ? [outputId] : []
                })
              ).size
              return (
                <div key={field.id} className="rounded-lg border">
                  <div className="flex items-start gap-2 p-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-xs font-medium">
                          {field.label}
                        </p>
                        {field.required ? (
                          <Badge variant="secondary">Required</Badge>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground">
                        {field.key} · {field.type}
                      </p>
                    </div>
                    <FieldDefinitionDialog
                      field={field}
                      fields={document.fields}
                      trigger={
                        <Button
                          aria-label={`Edit ${field.label}`}
                          size="icon-xs"
                          variant="ghost"
                        >
                          <Settings2 />
                        </Button>
                      }
                      onSave={(updated) =>
                        onUpdateFieldDefinition(field.id, updated)
                      }
                    />
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          aria-label={`Delete ${field.label}`}
                          size="icon-xs"
                          variant="ghost"
                        >
                          <Trash2 />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Delete {field.label}?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            This removes the field and its {bindings.length}{" "}
                            layer
                            {bindings.length === 1 ? " binding" : " bindings"}.
                            Existing layer content stays in place.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            variant="destructive"
                            onClick={() => onRemoveField(field.id)}
                          >
                            Delete field
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                  <Separator />
                  <div className="flex flex-col gap-2 p-2.5">
                    <FieldValueEditor
                      field={field}
                      value={
                        document.fieldValues[field.id] ?? field.defaultValue
                      }
                      onCommit={(value) => onUpdateField(field.id, value)}
                    />
                    <p className="text-[9px] text-muted-foreground">
                      {bindings.length} layer{bindings.length === 1 ? "" : "s"}
                      {outputCount
                        ? ` across ${outputCount} output${outputCount === 1 ? "" : "s"}`
                        : ""}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Database />
              </EmptyMedia>
              <EmptyTitle>No shared fields</EmptyTitle>
              <EmptyDescription>
                Create a field for content that repeats across outputs.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <FieldDefinitionDialog
                fields={document.fields}
                trigger={
                  <Button size="sm">
                    <Plus data-icon="inline-start" />
                    Create field
                  </Button>
                }
                onSave={onCreateField}
              />
            </EmptyContent>
          </Empty>
        )}
      </section>

      <Separator />

      <section className="flex flex-col gap-3 p-4">
        <div>
          <h2 className="text-xs font-medium">Selected layer bindings</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {selectedNode
              ? `Connect ${selectedNode.name} to a shared value.`
              : "Select one layer to manage its field connections."}
          </p>
        </div>

        {selectedNode ? (
          <>
            {selectedBindings.length ? (
              <div className="flex flex-col gap-1.5">
                {selectedBindings.map((binding) => {
                  const field = document.fields.find(
                    (candidate) => candidate.id === binding.fieldId
                  )
                  return (
                    <div
                      key={binding.id}
                      className="flex items-center gap-2 rounded-lg border p-2"
                    >
                      <Link2 className="size-3.5 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11px] font-medium">
                          {field?.label ?? "Missing field"}
                        </p>
                        <p className="text-[9px] text-muted-foreground">
                          {bindingPropertyLabels[binding.property]}
                        </p>
                      </div>
                      <Button
                        aria-label={`Unbind ${field?.label ?? "field"}`}
                        size="icon-xs"
                        variant="ghost"
                        onClick={() => onUnbindField(binding.id)}
                      >
                        <Unlink />
                      </Button>
                    </div>
                  )
                })}
              </div>
            ) : null}

            <FieldGroup className="gap-3">
              <Field>
                <FormFieldLabel>Layer property</FormFieldLabel>
                <Select
                  value={property}
                  onValueChange={(next: BindableProperty) => setProperty(next)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectGroup>
                      {properties.map((candidate) => (
                        <SelectItem
                          key={candidate}
                          value={candidate}
                          disabled={boundProperties.has(candidate)}
                        >
                          {bindingPropertyLabels[candidate]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field data-disabled={!compatibleFields.length}>
                <FormFieldLabel>Shared field</FormFieldLabel>
                <Select
                  value={bindingFieldId}
                  onValueChange={setBindingFieldId}
                  disabled={!compatibleFields.length}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose a compatible field" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectGroup>
                      {compatibleFields.map((field) => (
                        <SelectItem key={field.id} value={field.id}>
                          {field.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {!compatibleFields.length ? (
                  <FieldDescription>
                    Create a compatible{" "}
                    {property === "visible" ? "boolean" : "value"} field first.
                  </FieldDescription>
                ) : null}
              </Field>
            </FieldGroup>
            <Button
              size="sm"
              variant="outline"
              disabled={!bindingFieldId || boundProperties.has(property)}
              onClick={() => {
                if (!bindingFieldId) return
                onBindField(bindingFieldId, selectedNode.id, property)
                setBindingFieldId("")
              }}
            >
              <Link2 data-icon="inline-start" />
              Bind property
            </Button>
          </>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Link2 />
              </EmptyMedia>
              <EmptyTitle>No layer selected</EmptyTitle>
              <EmptyDescription>
                Select one layer on the canvas or in Layers.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </section>
    </div>
  )
}

const displayChangeValue = (value: unknown) => {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  return JSON.stringify(value)
}

function operationDetails(document: Document, operation: ChangeOperation) {
  const command = operation.command
  if (command.type === "set_field") {
    const field = document.fields.find(
      (candidate) => candidate.id === command.fieldId
    )
    const bindings = document.bindings.filter(
      (binding) => binding.fieldId === command.fieldId
    )
    const pageByNode = new Map(
      document.pages.flatMap((page) =>
        page.nodeIds.map((nodeId) => [nodeId, page] as const)
      )
    )
    const outputCount = new Set(
      bindings.flatMap((binding) => {
        const page = pageByNode.get(binding.nodeId)
        return page ? [page.outputId] : []
      })
    ).size
    return {
      label: field?.label ?? command.fieldId,
      context: `${bindings.length} layer${bindings.length === 1 ? "" : "s"} across ${outputCount} output${outputCount === 1 ? "" : "s"}`,
      before: displayChangeValue(document.fieldValues[command.fieldId]),
      after: displayChangeValue(command.value),
    }
  }
  if (command.type === "update_node") {
    const node = document.nodes.find(
      (candidate) => candidate.id === command.nodeId
    )
    const keys = Object.keys(command.patch)
    return {
      label: node?.name ?? command.nodeId,
      context: `${keys.length} layer propert${keys.length === 1 ? "y" : "ies"}`,
      before: keys
        .map(
          (key) =>
            `${key}: ${displayChangeValue(node?.[key as keyof typeof node])}`
        )
        .join(" · "),
      after: keys
        .map((key) => `${key}: ${displayChangeValue(command.patch[key])}`)
        .join(" · "),
    }
  }
  return {
    label: command.type.replaceAll("_", " "),
    context: "Canonical document command",
    before: "Current document",
    after: operation.summary,
  }
}

function ReviewPanel({
  document,
  pendingChangeSet,
  lastResolvedChangeSet,
  conflict,
  error,
  webMcpStatus,
  webMcpError,
  onDecideOperation,
  onDecideAll,
  onApply,
  onDiscard,
}: {
  document: Document
  pendingChangeSet: ChangeSet | null
  lastResolvedChangeSet: ChangeSet | null
  conflict: { message: string } | null
  error: string | null
  webMcpStatus: "unavailable" | "registering" | "ready" | "error"
  webMcpError: string | null
  onDecideOperation(
    operationId: string,
    status: ChangeOperation["status"]
  ): void
  onDecideAll(status: "accepted" | "rejected"): void
  onApply(): void
  onDiscard(): void
}) {
  const registeredToolNames = new Set([
    "inspect_design",
    "validate_design",
    "propose_field_updates",
  ])
  const acceptedCount =
    pendingChangeSet?.operations.filter(
      (operation) => operation.status === "accepted"
    ).length ?? 0
  const decidedCount =
    pendingChangeSet?.operations.filter(
      (operation) => operation.status !== "pending"
    ).length ?? 0

  return (
    <div className="flex w-full min-w-0 flex-col overflow-hidden">
      <section className="flex min-w-0 flex-col gap-3 overflow-hidden p-4">
        <div className="flex items-start gap-2.5">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-secondary">
            <Sparkles className="size-3.5" />
          </div>
          <div>
            <h2 className="text-xs font-medium">Agent change set</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Proposals preview on canvas but never change the saved document
              until you apply them.
            </p>
          </div>
        </div>
        {pendingChangeSet ? (
          <>
            <div className="min-w-0 rounded-lg border bg-muted/30 p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs leading-relaxed font-medium break-words">
                    {pendingChangeSet.title}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Revision {pendingChangeSet.baseRevision} · {decidedCount} of{" "}
                    {pendingChangeSet.operations.length} reviewed
                  </p>
                </div>
                <Badge variant="secondary">Previewing</Badge>
              </div>
            </div>

            {conflict || error ? (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-[11px] leading-relaxed text-destructive"
              >
                {error ?? conflict?.message}
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-1.5">
              <Button
                className="flex-1"
                size="sm"
                variant="outline"
                onClick={() => onDecideAll("rejected")}
              >
                Reject all
              </Button>
              <Button
                className="flex-1"
                size="sm"
                variant="outline"
                onClick={() => onDecideAll("accepted")}
              >
                Accept all
              </Button>
            </div>

            <div className="flex flex-col gap-2">
              {pendingChangeSet.operations.map((operation) => {
                const details = operationDetails(document, operation)
                return (
                  <div
                    key={operation.id}
                    className={cn(
                      "min-w-0 overflow-hidden rounded-lg border p-2.5",
                      operation.status === "rejected" &&
                        "bg-muted/30 opacity-70"
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate text-[11px] font-medium">
                            {details.label}
                          </p>
                          {operation.status !== "pending" ? (
                            <Badge
                              variant={
                                operation.status === "accepted"
                                  ? "secondary"
                                  : "outline"
                              }
                            >
                              {operation.status}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 text-[10px] leading-relaxed break-words text-muted-foreground">
                          {operation.summary}
                        </p>
                        <p className="mt-1 text-[9px] text-muted-foreground">
                          {details.context}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <Button
                          aria-label={`Reject ${operation.summary}`}
                          size="icon-xs"
                          variant={
                            operation.status === "rejected"
                              ? "destructive"
                              : "ghost"
                          }
                          onClick={() =>
                            onDecideOperation(operation.id, "rejected")
                          }
                        >
                          <X />
                        </Button>
                        <Button
                          aria-label={`Accept ${operation.summary}`}
                          size="icon-xs"
                          variant={
                            operation.status === "accepted"
                              ? "default"
                              : "ghost"
                          }
                          onClick={() =>
                            onDecideOperation(operation.id, "accepted")
                          }
                        >
                          <Check />
                        </Button>
                      </div>
                    </div>
                    <div className="mt-2 grid min-w-0 gap-1 overflow-hidden rounded-md bg-muted/70 p-2 font-mono text-[9px] leading-relaxed">
                      <p className="break-words line-through opacity-60">
                        − {details.before}
                      </p>
                      <p className="break-words">+ {details.after}</p>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-1.5">
              <Button size="sm" variant="outline" onClick={onDiscard}>
                Discard
              </Button>
              <Button
                className="flex-1"
                size="sm"
                disabled={!acceptedCount || Boolean(conflict)}
                onClick={onApply}
              >
                Apply {acceptedCount || "accepted"} change
                {acceptedCount === 1 ? "" : "s"}
              </Button>
            </div>
          </>
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Sparkles />
              </EmptyMedia>
              <EmptyTitle>No changes waiting</EmptyTitle>
              <EmptyDescription>
                Ask a browser agent to inspect the design and propose field or
                canvas updates.
              </EmptyDescription>
            </EmptyHeader>
            {lastResolvedChangeSet ? (
              <EmptyContent>
                <Badge variant="outline">
                  Last review: {lastResolvedChangeSet.status.replace("_", " ")}
                </Badge>
              </EmptyContent>
            ) : null}
          </Empty>
        )}
      </section>
      <Separator />
      <section className="flex min-w-0 flex-col gap-2.5 overflow-hidden p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-xs font-medium">WebMCP tools on this route</h2>
            <p className="mt-1 text-[11px] text-muted-foreground">
              The tools call the same product services as this editor.
            </p>
          </div>
          <Badge variant={webMcpStatus === "ready" ? "secondary" : "outline"}>
            {webMcpStatus === "ready"
              ? "3 live"
              : webMcpStatus === "registering"
                ? "Starting"
                : webMcpStatus === "error"
                  ? "Error"
                  : "Unavailable"}
          </Badge>
        </div>
        {webMcpError ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {webMcpError}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-1.5">
          {toolCatalog
            .filter((tool) => registeredToolNames.has(tool.name))
            .map((tool) => (
              <Badge
                key={tool.name}
                variant="outline"
                className="max-w-full font-mono text-[9px] break-all"
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
  pendingChangeSet,
  lastResolvedChangeSet,
  changeSetConflict,
  changeSetError,
  webMcpStatus,
  webMcpError,
  onUpdateNode,
  onUpdateField,
  onCreateField,
  onUpdateFieldDefinition,
  onRemoveField,
  onBindField,
  onUnbindField,
  onDecideChangeOperation,
  onDecideAllChangeOperations,
  onApplyChangeSet,
  onDiscardChangeSet,
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
  pendingChangeSet: ChangeSet | null
  lastResolvedChangeSet: ChangeSet | null
  changeSetConflict: { message: string } | null
  changeSetError: string | null
  webMcpStatus: "unavailable" | "registering" | "ready" | "error"
  webMcpError: string | null
  onUpdateNode(nodeId: string, patch: Partial<SceneNode>): void
  onUpdateField(fieldId: string, value: string | number | boolean): void
  onCreateField(field: Omit<FieldDefinition, "id">): void
  onUpdateFieldDefinition(
    fieldId: string,
    patch: Partial<Omit<FieldDefinition, "id">>
  ): void
  onRemoveField(fieldId: string): void
  onBindField(fieldId: string, nodeId: string, property: BindableProperty): void
  onUnbindField(bindingId: string): void
  onDecideChangeOperation(
    operationId: string,
    status: ChangeOperation["status"]
  ): void
  onDecideAllChangeOperations(status: "accepted" | "rejected"): void
  onApplyChangeSet(): void
  onDiscardChangeSet(): void
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
            <FieldsPanel
              document={document}
              selectedNodes={selectedNodes}
              onUpdateField={onUpdateField}
              onCreateField={onCreateField}
              onUpdateFieldDefinition={onUpdateFieldDefinition}
              onRemoveField={onRemoveField}
              onBindField={onBindField}
              onUnbindField={onUnbindField}
            />
          </ScrollArea>
        </TabsContent>
        <TabsContent value="review" className="min-h-0">
          <ScrollArea className="h-full">
            <ReviewPanel
              document={document}
              pendingChangeSet={pendingChangeSet}
              lastResolvedChangeSet={lastResolvedChangeSet}
              conflict={changeSetConflict}
              error={changeSetError}
              webMcpStatus={webMcpStatus}
              webMcpError={webMcpError}
              onDecideOperation={onDecideChangeOperation}
              onDecideAll={onDecideAllChangeOperations}
              onApply={onApplyChangeSet}
              onDiscard={onDiscardChangeSet}
            />
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </aside>
  )
}
