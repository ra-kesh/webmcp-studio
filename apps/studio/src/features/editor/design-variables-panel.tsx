import { useEffect, useMemo, useState } from "react"
import { Braces, Check, Link2, Plus, Trash2, Unlink } from "lucide-react"
import {
  designVariableSchema,
  variableTypeForTarget,
  variableUsage,
} from "@webmcp/document"
import type {
  DesignVariable,
  DesignVariablePatch,
  Document,
  NodeVariableProperty,
  SceneNode,
  TextRangeVariableProperty,
  VariableBinding,
  VariableBindingTarget,
} from "@webmcp/document"
import type { CanvasTextEditingState } from "@webmcp/editor"
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
import { Badge } from "@webmcp/ui/components/badge"
import { Button } from "@webmcp/ui/components/button"
import {
  EditorPanelNotice,
  EditorPanelSectionHeader,
  EditorSelectTrigger,
} from "@webmcp/ui/components/editor-chrome"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@webmcp/ui/components/dialog"
import { Input } from "@webmcp/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@webmcp/ui/components/select"

type VariableType = DesignVariable["type"]

type VariableEditorDraft = Readonly<{
  name: string
  type: VariableType
  value: string
}>

const variableTypeLabels: Record<VariableType, string> = {
  color: "Color",
  number: "Number",
  string: "Text",
  font_family: "Font family",
}

const propertyLabels: Record<NodeVariableProperty, string> = {
  text: "Text",
  color: "Text color",
  fill: "Fill",
  stroke: "Stroke",
  fontFamily: "Font family",
  fontSize: "Font size",
  fontWeight: "Font weight",
  lineHeight: "Line height",
  letterSpacing: "Letter spacing",
  x: "X position",
  y: "Y position",
  width: "Width",
  height: "Height",
  rotation: "Rotation",
  opacity: "Opacity",
  strokeWidth: "Stroke width",
  radius: "Corner radius",
}

const geometryProperties = [
  "x",
  "y",
  "width",
  "height",
  "rotation",
  "opacity",
] as const satisfies readonly NodeVariableProperty[]

const textRangeProperties = [
  "color",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
] as const satisfies readonly TextRangeVariableProperty[]

const propertiesForNode = (
  node: SceneNode,
  range: boolean
): readonly NodeVariableProperty[] => {
  if (range && node.type === "text") return textRangeProperties
  if (node.type === "text") {
    return [
      "text",
      "color",
      "fontFamily",
      "fontSize",
      "fontWeight",
      "lineHeight",
      "letterSpacing",
      ...geometryProperties,
    ]
  }
  if (node.type === "rect" || node.type === "section") {
    return ["fill", "stroke", "strokeWidth", "radius", ...geometryProperties]
  }
  if (
    node.type === "ellipse" ||
    node.type === "icon" ||
    node.type === "polygon" ||
    node.type === "star" ||
    node.type === "vector" ||
    node.type === "boolean_result"
  ) {
    return ["fill", "stroke", "strokeWidth", ...geometryProperties]
  }
  if (node.type === "line") {
    return ["stroke", "strokeWidth", ...geometryProperties]
  }
  return geometryProperties
}

const draftFor = (variable?: DesignVariable): VariableEditorDraft => ({
  name: variable?.name ?? "",
  type: variable?.type ?? "color",
  value:
    variable === undefined
      ? "#111111"
      : variable.type === "number"
        ? String(variable.value)
        : variable.value,
})

const valueForDraft = (draft: VariableEditorDraft) =>
  draft.type === "number" ? Number(draft.value) : draft.value

function VariableEditorDialog({
  open,
  variable,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  variable?: DesignVariable
  onOpenChange: (open: boolean) => void
  onSubmit: (variable: DesignVariable) => boolean
}) {
  const [draft, setDraft] = useState(() => draftFor(variable))
  const candidate = designVariableSchema.safeParse({
    id: variable?.id ?? "variable-preview",
    name: draft.name,
    type: draft.type,
    value: valueForDraft(draft),
  })

  useEffect(() => {
    if (open) setDraft(draftFor(variable))
  }, [open, variable])

  const setType = (type: VariableType) => {
    setDraft((current) => ({
      ...current,
      type,
      value:
        type === "number"
          ? "0"
          : type === "color"
            ? "#111111"
            : type === "font_family"
              ? "Geist Variable"
              : "",
    }))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {variable ? "Edit variable" : "New variable"}
          </DialogTitle>
          <DialogDescription>
            Variables keep one controlled value consistent across layers and
            styles.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <label className="grid gap-1.5 text-xs font-medium">
            Name
            <Input
              autoFocus
              value={draft.name}
              placeholder="Brand / Primary"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            Type
            <Select
              disabled={Boolean(variable)}
              value={draft.type}
              onValueChange={(value) => setType(value as VariableType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(variableTypeLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            Value
            <Input
              type={draft.type === "number" ? "number" : "text"}
              value={draft.value}
              placeholder={
                draft.type === "font_family" ? "Geist Variable" : undefined
              }
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  value: event.target.value,
                }))
              }
            />
          </label>
          {!candidate.success ? (
            <p className="text-xs text-destructive" role="alert">
              {candidate.error.issues[0]?.message ?? "Review this variable."}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!candidate.success}
            onClick={() => {
              if (!candidate.success || !onSubmit(candidate.data)) return
              onOpenChange(false)
            }}
          >
            <Check data-icon="inline-start" />
            {variable ? "Save variable" : "Create variable"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const bindingTargetsNode = (binding: VariableBinding, nodeId: string) => {
  const target = binding.target
  return (
    (target.kind === "node" || target.kind === "text_range") &&
    target.nodeId === nodeId
  )
}

const bindingLabel = (binding: VariableBinding) => {
  const target = binding.target
  if (target.kind === "node") return propertyLabels[target.property]
  if (target.kind === "text_range") {
    return `${propertyLabels[target.property]} · characters ${target.range.start}–${target.range.end}`
  }
  return target.kind === "typography_style"
    ? `Text style · ${propertyLabels[target.property]}`
    : `Paint style · ${propertyLabels[target.property]}`
}

type StyleBindingOption = Readonly<{
  key: string
  label: string
  target: Extract<
    VariableBindingTarget,
    { kind: "typography_style" | "paint_style" }
  >
  type: VariableType
}>

const styleBindingOptions = (document: Document): StyleBindingOption[] => [
  ...document.typographyStyles.flatMap((style) =>
    (
      [
        "fontFamily",
        "fontSize",
        "fontWeight",
        "lineHeight",
        "letterSpacing",
      ] as const
    ).map((property) => {
      const target = {
        kind: "typography_style" as const,
        styleId: style.id,
        property,
      }
      return {
        key: `typography:${style.id}:${property}`,
        label: `${style.name} · ${propertyLabels[property]}`,
        target,
        type: variableTypeForTarget(target),
      }
    })
  ),
  ...document.paintStyles.flatMap((style) =>
    (["color", "opacity"] as const).map((property) => {
      const target = {
        kind: "paint_style" as const,
        styleId: style.id,
        property,
      }
      return {
        key: `paint:${style.id}:${property}`,
        label: `${style.name} · ${propertyLabels[property]}`,
        target,
        type: variableTypeForTarget(target),
      }
    })
  ),
]

function StyleVariableBindingSection({
  document,
  onBind,
  onUnbind,
}: {
  document: Document
  onBind: (variableId: string, target: VariableBindingTarget) => boolean
  onUnbind: (bindingId: string) => boolean
}) {
  const [variableId, setVariableId] = useState("")
  const [optionKey, setOptionKey] = useState("")
  const variable = document.variables.find(
    (candidate) => candidate.id === variableId
  )
  const options = styleBindingOptions(document).filter(
    (option) =>
      option.type === variable?.type &&
      !document.variableBindings.some((binding) => {
        const target = binding.target
        return (
          target.kind === option.target.kind &&
          "styleId" in target &&
          target.styleId === option.target.styleId &&
          target.property === option.target.property
        )
      })
  )
  const option = options.find((candidate) => candidate.key === optionKey)
  const bindings = document.variableBindings.filter(
    (binding) =>
      binding.target.kind === "typography_style" ||
      binding.target.kind === "paint_style"
  )

  useEffect(() => {
    if (!document.variables.some((candidate) => candidate.id === variableId)) {
      setVariableId(document.variables[0]?.id ?? "")
    }
  }, [document.variables, variableId])

  useEffect(() => {
    if (!options.some((candidate) => candidate.key === optionKey)) {
      setOptionKey(options[0]?.key ?? "")
    }
  }, [optionKey, options])

  if (!document.typographyStyles.length && !document.paintStyles.length) {
    return null
  }

  return (
    <section className="border-b">
      <div className="flex min-h-8 items-center px-3 text-[11px] font-semibold">
        Reusable style bindings
      </div>
      <div className="grid gap-2 px-3 pb-3">
        <Select value={variableId} onValueChange={setVariableId}>
          <EditorSelectTrigger aria-label="Style variable">
            <SelectValue placeholder="Choose variable" />
          </EditorSelectTrigger>
          <SelectContent>
            {document.variables.map((candidate) => (
              <SelectItem key={candidate.id} value={candidate.id}>
                {candidate.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={optionKey}
          disabled={!options.length}
          onValueChange={setOptionKey}
        >
          <EditorSelectTrigger aria-label="Reusable style property">
            <SelectValue placeholder="Choose style property" />
          </EditorSelectTrigger>
          <SelectContent>
            {options.map((candidate) => (
              <SelectItem key={candidate.key} value={candidate.key}>
                {candidate.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          className="h-7 text-[11px]"
          size="sm"
          variant="outline"
          disabled={!variable || !option}
          onClick={() =>
            variable && option && onBind(variable.id, option.target)
          }
        >
          <Link2 data-icon="inline-start" /> Bind style property
        </Button>
        {variable && !options.length ? (
          <p className="text-[11px] leading-4 text-muted-foreground">
            No unbound {variableTypeLabels[variable.type].toLowerCase()} style
            properties are available.
          </p>
        ) : null}
        {bindings.length ? (
          <div className="mt-1 border-y">
            {bindings.map((binding, index) => {
              const boundVariable = document.variables.find(
                (candidate) => candidate.id === binding.variableId
              )
              return (
                <div
                  key={binding.id}
                  className={
                    index < bindings.length - 1
                      ? "flex min-h-8 items-center gap-2 border-b px-2 text-[11px]"
                      : "flex min-h-8 items-center gap-2 px-2 text-[11px]"
                  }
                >
                  <Braces
                    className="size-3.5 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {bindingLabel(binding)} ·{" "}
                    {boundVariable?.name ?? "Missing variable"}
                  </span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Unbind ${boundVariable?.name ?? "variable"}`}
                    onClick={() => onUnbind(binding.id)}
                  >
                    <Unlink />
                  </Button>
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
    </section>
  )
}

export function DesignVariablesPanel({
  document,
  selectedNode,
  textEditingState,
  onCreate,
  onUpdate,
  onDelete,
  onBind,
  onUnbind,
  onFocusNode,
}: {
  document: Document
  selectedNode?: SceneNode
  textEditingState?: CanvasTextEditingState | null
  onCreate: (variable: DesignVariable) => boolean
  onUpdate: (variableId: string, patch: DesignVariablePatch) => boolean
  onDelete: (variableId: string) => boolean
  onBind: (variableId: string, target: VariableBindingTarget) => boolean
  onUnbind: (bindingId: string) => boolean
  onFocusNode: (nodeId: string) => void
}) {
  const [createOpen, setCreateOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const range =
    selectedNode?.type === "text" &&
    textEditingState?.nodeId === selectedNode.id &&
    textEditingState.selection.anchor !== textEditingState.selection.focus
      ? {
          start: Math.min(
            textEditingState.selection.anchor,
            textEditingState.selection.focus
          ),
          end: Math.max(
            textEditingState.selection.anchor,
            textEditingState.selection.focus
          ),
        }
      : null
  const properties = selectedNode
    ? propertiesForNode(selectedNode, Boolean(range))
    : []
  const [property, setProperty] = useState<NodeVariableProperty | null>(
    properties[0] ?? null
  )

  useEffect(() => {
    setProperty(properties[0] ?? null)
  }, [selectedNode?.id, range?.start, range?.end])

  const target = useMemo<VariableBindingTarget | null>(() => {
    if (!selectedNode || !property) return null
    if (
      range &&
      textRangeProperties.includes(property as TextRangeVariableProperty)
    ) {
      return {
        kind: "text_range",
        nodeId: selectedNode.id,
        range,
        property: property as TextRangeVariableProperty,
      }
    }
    return { kind: "node", nodeId: selectedNode.id, property }
  }, [property, range, selectedNode])
  const expectedType = target ? variableTypeForTarget(target) : null
  const compatibleVariables = expectedType
    ? document.variables.filter((variable) => variable.type === expectedType)
    : []
  const [selectedVariableId, setSelectedVariableId] = useState("")

  useEffect(() => {
    setSelectedVariableId(compatibleVariables[0]?.id ?? "")
  }, [expectedType, property, selectedNode?.id, document.variables.length])

  const existingBinding = target
    ? document.variableBindings.find((binding) => {
        const candidate = binding.target
        if (candidate.kind !== target.kind) return false
        if (candidate.kind === "node" && target.kind === "node") {
          return (
            candidate.nodeId === target.nodeId &&
            candidate.property === target.property
          )
        }
        if (candidate.kind === "text_range" && target.kind === "text_range") {
          return (
            candidate.nodeId === target.nodeId &&
            candidate.property === target.property &&
            candidate.range.start === target.range.start &&
            candidate.range.end === target.range.end
          )
        }
        return false
      })
    : undefined
  const fieldConflict =
    target?.kind === "node"
      ? document.bindings.find(
          (binding) =>
            binding.nodeId === target.nodeId &&
            binding.property === target.property
        )
      : undefined
  const selectedNodeBindings = selectedNode
    ? document.variableBindings.filter((binding) =>
        bindingTargetsNode(binding, selectedNode.id)
      )
    : []
  const editingVariable = document.variables.find(
    (variable) => variable.id === editingId
  )

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col overflow-x-hidden">
      <EditorPanelSectionHeader>
        <span>Design variables</span>
        <span className="font-normal text-muted-foreground">Advanced</span>
        <span className="ml-auto font-normal text-muted-foreground">
          {document.variables.length}
        </span>
        <Button size="xs" variant="ghost" onClick={() => setCreateOpen(true)}>
          <Plus data-icon="inline-start" /> New
        </Button>
      </EditorPanelSectionHeader>

      {selectedNode ? (
        <section className="border-b px-3 py-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-[11px] font-semibold">Bind selection</h3>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {selectedNode.name}
                {range
                  ? ` · characters ${range.start}–${range.end}`
                  : " · whole layer"}
              </p>
            </div>
            {range ? <Badge variant="secondary">Text range</Badge> : null}
          </div>
          <div className="grid gap-2">
            <Select
              value={property ?? undefined}
              onValueChange={(value) =>
                setProperty(value as NodeVariableProperty)
              }
            >
              <EditorSelectTrigger aria-label="Variable property">
                <SelectValue />
              </EditorSelectTrigger>
              <SelectContent>
                {properties.map((candidate) => (
                  <SelectItem key={candidate} value={candidate}>
                    {propertyLabels[candidate]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={selectedVariableId}
              disabled={
                compatibleVariables.length === 0 || Boolean(existingBinding)
              }
              onValueChange={setSelectedVariableId}
            >
              <EditorSelectTrigger aria-label="Variable">
                <SelectValue
                  placeholder={`Choose ${expectedType ? variableTypeLabels[expectedType] : "variable"}`}
                />
              </EditorSelectTrigger>
              <SelectContent>
                {compatibleVariables.map((variable) => (
                  <SelectItem key={variable.id} value={variable.id}>
                    {variable.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldConflict ? (
              <p className="text-[11px] leading-4 text-muted-foreground">
                This property is controlled by a content field. Unbind it in
                Data first.
              </p>
            ) : selectedNode.locked ? (
              <p className="text-[11px] leading-4 text-muted-foreground">
                Unlock this layer before changing its variable bindings.
              </p>
            ) : compatibleVariables.length === 0 ? (
              <p className="text-[11px] leading-4 text-muted-foreground">
                Create a{" "}
                {expectedType
                  ? variableTypeLabels[expectedType].toLowerCase()
                  : "matching"}{" "}
                variable first.
              </p>
            ) : null}
            {existingBinding ? (
              <Button
                className="h-7 text-[11px]"
                size="sm"
                variant="outline"
                disabled={selectedNode.locked}
                onClick={() => onUnbind(existingBinding.id)}
              >
                <Unlink data-icon="inline-start" /> Unbind{" "}
                {property ? propertyLabels[property] : "variable"}
              </Button>
            ) : (
              <Button
                className="h-7 text-[11px]"
                size="sm"
                disabled={
                  selectedNode.locked ||
                  !target ||
                  !selectedVariableId ||
                  Boolean(fieldConflict)
                }
                onClick={() => target && onBind(selectedVariableId, target)}
              >
                <Link2 data-icon="inline-start" /> Bind variable
              </Button>
            )}
          </div>
          {selectedNodeBindings.length > 0 ? (
            <div className="mt-3 grid gap-1.5">
              {selectedNodeBindings.map((binding) => {
                const variable = document.variables.find(
                  (candidate) => candidate.id === binding.variableId
                )
                return (
                  <div
                    key={binding.id}
                    className="flex items-center gap-2 rounded-md border px-2.5 py-2 text-[11px]"
                  >
                    <Braces
                      className="size-3.5 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {bindingLabel(binding)} ·{" "}
                      {variable?.name ?? "Missing variable"}
                    </span>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Unbind ${variable?.name ?? "variable"}`}
                      disabled={selectedNode.locked}
                      onClick={() => onUnbind(binding.id)}
                    >
                      <Unlink />
                    </Button>
                  </div>
                )
              })}
            </div>
          ) : null}
        </section>
      ) : null}

      <StyleVariableBindingSection
        document={document}
        onBind={onBind}
        onUnbind={onUnbind}
      />

      <section className="grid">
        <div className="flex min-h-8 items-center px-3 text-[11px] font-semibold">
          Document variables
        </div>
        {document.variables.length === 0 ? (
          <EditorPanelNotice
            className="mx-3 mb-3"
            icon={<Braces />}
            title="No variables"
            description="Create a color, number, phrase, or font family."
          />
        ) : (
          <div className="border-y">
            {document.variables.map((variable, index) => {
              const usage = variableUsage(document, variable.id)
              return (
                <article
                  key={variable.id}
                  className={
                    index < document.variables.length - 1
                      ? "border-b px-3 py-2.5"
                      : "px-3 py-2.5"
                  }
                >
                  <div className="flex items-start gap-2">
                    <span
                      className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-sm bg-editor-field"
                      style={
                        variable.type === "color"
                          ? { backgroundColor: variable.value }
                          : undefined
                      }
                    >
                      {variable.type === "color" ? null : (
                        <Braces className="size-3.5" aria-hidden="true" />
                      )}
                    </span>
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setEditingId(variable.id)}
                    >
                      <span className="block truncate text-xs font-medium">
                        {variable.name}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {variableTypeLabels[variable.type]} ·{" "}
                        {String(variable.value)}
                      </span>
                    </button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Delete ${variable.name}`}
                          disabled={usage.totalBindingCount > 0}
                        >
                          <Trash2 />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Delete {variable.name}?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            The resolved values stay on the design. This removes
                            only the reusable variable.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => onDelete(variable.id)}
                          >
                            Delete variable
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span>
                      {usage.totalBindingCount}{" "}
                      {usage.totalBindingCount === 1 ? "binding" : "bindings"}
                    </span>
                    {usage.nodeIds[0] ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => onFocusNode(usage.nodeIds[0])}
                      >
                        Show layer
                      </Button>
                    ) : null}
                  </div>
                  {usage.totalBindingCount > 0 ? (
                    <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
                      Unbind every use before deleting this variable.
                    </p>
                  ) : null}
                </article>
              )
            })}
          </div>
        )}
      </section>

      <VariableEditorDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={(variable) =>
          onCreate({ ...variable, id: `variable-${crypto.randomUUID()}` })
        }
      />
      <VariableEditorDialog
        open={Boolean(editingVariable)}
        variable={editingVariable}
        onOpenChange={(open) => {
          if (!open) setEditingId(null)
        }}
        onSubmit={(next) =>
          editingVariable
            ? onUpdate(editingVariable.id, {
                name: next.name,
                value: next.value,
              })
            : false
        }
      />
    </div>
  )
}
