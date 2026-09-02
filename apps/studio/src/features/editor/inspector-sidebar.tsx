import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
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
  AlertTriangle,
  BringToFront,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  Component as ComponentIcon,
  CopyPlus,
  Crop,
  Crosshair,
  Database,
  Eye,
  EyeOff,
  ImageUp,
  Lock,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  LoaderCircleIcon,
  Plus,
  RefreshCw,
  SendToBack,
  Square,
  Settings2,
  TextAlignJustify,
  Trash2,
  Unlock,
  Unlink,
  X,
} from "lucide-react"
import {
  analyzeFieldDeletion,
  applyTextParagraphStyleToRange,
  bindingPropertiesForNode,
  defaultFieldValue,
  designStyleUsage,
  fieldDefinitionSchema,
  fieldDefinitionValidationMessage,
  isManagedRendererFont,
  managedRendererFonts,
  fieldCanBindToProperty,
  parseCurrencyValue,
  projectTextLayout,
  repairTextOverflowPatch,
  resolveTextSelectionParagraphState,
} from "@webmcp/document"
import type {
  BindableProperty,
  BlendMode,
  ChangeOperation,
  ChangeSet,
  Document,
  DesignVariable,
  DesignVariablePatch,
  FieldDefinition,
  FieldBindingImpact,
  FieldValue,
  FillPaint,
  GeneratedDocumentPlan,
  ImageFrameMask,
  ImagePlacement,
  LayerEffect,
  LayerExportSetting,
  NodeConstraints,
  PaintStyle,
  PaintStylePatch,
  SceneNode,
  StrokePaint,
  TextParagraphStylePatch,
  TextRunStylePatch,
  TypographyStyle,
  TypographyStylePatch,
  VariableBindingTarget,
} from "@webmcp/document"
import { Artboard } from "@webmcp/render-view"
import type { Alignment } from "@webmcp/editor/geometry"
import type { CanvasTextEditingState, NodeGeometryPatch } from "@webmcp/editor"
import type {
  EditorImageCommandId,
  EditorImageFrameCommandId,
} from "@webmcp/editor/commands"
import type { ImageCropPreviewStore } from "@webmcp/editor/image-crop-preview-store"
import { BackgroundRemovalControl } from "./background-removal-control"
import type { BackgroundRemovalModel } from "./use-background-removal"
import {
  createInspectorSelectionModel,
  deriveInspectorMaskCapabilities,
} from "@webmcp/editor/inspector"
import type {
  InspectorCapabilityContext,
  InspectorMaskCapabilities,
  InspectorSharedValue,
} from "@webmcp/editor/inspector"
import type { ProductCommandRuntimeContext } from "@webmcp/editor/product-commands"
import { toolCatalog } from "@webmcp/webmcp"
import type { ReviewAffectedTarget, ReviewJournal } from "./review-journal"
import { createEmptyReviewJournal } from "./review-journal"
import { Badge } from "@webmcp/ui/components/badge"
import { Button } from "@webmcp/ui/components/button"
import { Checkbox } from "@webmcp/ui/components/checkbox"
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
import {
  EditorPanelNotice,
  EditorPanelState,
  EditorPanelTabsList,
} from "@webmcp/ui/components/editor-chrome"
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
import { Tabs, TabsContent, TabsTrigger } from "@webmcp/ui/components/tabs"
import { Textarea } from "@webmcp/ui/components/textarea"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@webmcp/ui/components/toggle-group"
import { cn } from "@webmcp/ui/lib/utils"
import {
  CommitInput,
  CommitPercentSlider,
  CommitTextarea,
  InspectorColorField,
  InspectorNumberField,
  InspectorSectionLabel,
} from "./inspector-controls"
import {
  applyStudioTextListStyle,
  detectStudioTextListStyle,
} from "./text-lists"
import {
  fieldDraftValue,
  TypedFieldValueControl,
} from "./typed-field-value-control"
import {
  analyzeFieldDefinitionChange,
  fieldDefinitionsEqual,
  validateFieldBoundDrafts,
} from "./field-definition-change-model"
import { operationDetails } from "./review-operation-details"
import { assetValueDisplay } from "./field-review-display"
import { projectMissingImageRecoveryActions } from "./missing-image-recovery"
import { projectComponentSelection } from "./component-selection-model"
import type { ComponentSelectionContext } from "./component-selection-model"
import {
  sharedTextSelectionValue,
  textColorChoices,
  textFormattingTogglePatch,
} from "./text-formatting-model"
import { ReusableStyleField } from "./reusable-style-field"
import { DesignVariablesPanel } from "./design-variables-panel"
import type { ProductCommandMenuRuntime } from "./product-command-menu"
import { PositionTransformControls } from "./position-transform-controls"
import {
  positionTransformPatch,
  type PositionTransformAction,
} from "./position-transform"

const DEMO_AGENT_BRIEF =
  "Inspect and validate the open design. Adapt it for Mira & Dev, 14 February 2027 in Udaipur, using The Moonlit Weekend package at ₹4,25,000, valid until 30 November 2026. Search the approved asset library for warm sandstone architecture. Then create one coordinated human-reviewed proposal that updates those shared fields and inserts the best asset on the Cover at x 620, y 120, width 540, height 900 with cover fit. Do not apply or publish anything. Summarize the affected outputs and wait for my review."

const BLEND_MODE_OPTIONS: readonly Readonly<{
  value: BlendMode
  label: string
}>[] = [
  { value: "normal", label: "Normal" },
  { value: "darken", label: "Darken" },
  { value: "multiply", label: "Multiply" },
  { value: "color-burn", label: "Color burn" },
  { value: "lighten", label: "Lighten" },
  { value: "screen", label: "Screen" },
  { value: "color-dodge", label: "Color dodge" },
  { value: "overlay", label: "Overlay" },
  { value: "soft-light", label: "Soft light" },
  { value: "hard-light", label: "Hard light" },
  { value: "difference", label: "Difference" },
  { value: "exclusion", label: "Exclusion" },
  { value: "hue", label: "Hue" },
  { value: "saturation", label: "Saturation" },
  { value: "color", label: "Color" },
  { value: "luminosity", label: "Luminosity" },
]

const EMPTY_REVIEW_JOURNAL = createEmptyReviewJournal()
const ignoreReviewTarget = () => undefined
const ignoreNodeId = (_nodeId: string) => undefined
const ignoreNodePatch = (_nodeId: string, _patch: Partial<SceneNode>) =>
  undefined
const ignoreNodePreviewCancel = (_nodeId: string) => undefined
const ignorePositionTransform = (_action: PositionTransformAction) => undefined
const ignoreTextStylePatch = (_patch: TextRunStylePatch) => undefined
const ignoreTextParagraphStylePatch = (_patch: TextParagraphStylePatch) =>
  undefined
const ignoreCreateTypographyStyle = (
  _style: Omit<TypographyStyle, "id">,
  _nodeId?: string
) => null
const ignoreCreatePaintStyle = (
  _style: Omit<PaintStyle, "id">,
  _nodeId?: string
) => null
const ignoreTypographyStyleUpdate = (
  _styleId: string,
  _patch: TypographyStylePatch
) => false
const ignorePaintStyleUpdate = (_styleId: string, _patch: PaintStylePatch) =>
  false
const ignoreStyleMutation = (_styleId: string, _nodeId?: string) => false
const ignoreNodeStyleDetach = (_nodeId: string) => false
const ignoreCreateVariable = (_variable: DesignVariable) => false
const ignoreUpdateVariable = (
  _variableId: string,
  _patch: DesignVariablePatch
) => false
const ignoreVariableMutation = (_variableId: string) => false
const ignoreBindVariable = (
  _variableId: string,
  _target: VariableBindingTarget
) => false
const ignoreUpdateComponent = (
  _componentId: string,
  _patch: {
    name?: string
    description?: string
    defaultVariantId?: string
  }
) => false
const ignoreComponentVariant = (_instanceId: string, _variantId: string) =>
  false
const ignoreComponentLayerOverrides = (
  _instanceId: string,
  _sourceNodeId: string
) => false
const ignoreComponentInstance = (_instanceId: string) => false
const ignoreComponentSource = (_componentId: string) => undefined
const reviewTargetKindLabel: Record<ReviewAffectedTarget["kind"], string> = {
  node: "Layer",
  group: "Group",
  page: "Page",
  field: "Field",
  output: "Output",
  component: "Component",
  component_instance: "Instance",
}

export function reviewTargetExists(
  document: Document,
  target: ReviewAffectedTarget
) {
  if (target.kind === "node")
    return document.nodes.some((node) => node.id === target.id)
  if (target.kind === "group")
    return document.groups.some((group) => group.id === target.id)
  if (target.kind === "page")
    return document.pages.some((page) => page.id === target.id)
  if (target.kind === "output")
    return document.outputs.some((output) => output.id === target.id)
  if (target.kind === "component")
    return document.components.some((component) => component.id === target.id)
  if (target.kind === "component_instance")
    return document.componentInstances.some(
      (instance) => instance.id === target.id
    )
  return document.fields.some((field) => field.id === target.id)
}

const FieldLabel = InspectorSectionLabel

const constraintAxisValues = [
  "min",
  "center",
  "max",
  "stretch",
  "scale",
] as const

function ConstraintAxisControl({
  axis,
  value,
  disabled,
  onChange,
}: {
  axis: "horizontal" | "vertical"
  value: NodeConstraints["horizontal"]
  disabled: boolean
  onChange: (value: NodeConstraints["horizontal"]) => void
}) {
  const labels =
    axis === "horizontal"
      ? {
          min: "Left",
          center: "Center",
          max: "Right",
          stretch: "Left and right",
          scale: "Scale",
        }
      : {
          min: "Top",
          center: "Center",
          max: "Bottom",
          stretch: "Top and bottom",
          scale: "Scale",
        }
  return (
    <div className="space-y-1">
      <FieldLabel>
        {axis === "horizontal" ? "Horizontal" : "Vertical"}
      </FieldLabel>
      <Select
        value={value}
        disabled={disabled}
        onValueChange={(next) =>
          onChange(next as NodeConstraints["horizontal"])
        }
      >
        <SelectTrigger
          aria-label={`${axis === "horizontal" ? "Horizontal" : "Vertical"} constraint`}
          className="h-8 text-[11px]"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {constraintAxisValues.map((option) => (
              <SelectItem key={option} value={option}>
                {labels[option]}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}

function InspectorSection({
  title,
  children,
  className,
  ...props
}: React.ComponentProps<"section"> & { title: string }) {
  return (
    <section
      data-slot="inspector-section"
      className={cn(
        "border-b border-border px-3 pb-3 text-foreground transition-colors outline-none [&_[data-slot=select-trigger]]:h-6 [&_[data-slot=select-trigger]]:rounded-sm [&_[data-slot=select-trigger]]:border-transparent [&_[data-slot=select-trigger]]:bg-editor-field [&_[data-slot=select-trigger]]:px-2 [&_[data-slot=select-trigger]]:text-[11px] [&_[data-slot=select-trigger]]:hover:bg-editor-field-hover [&_[data-slot=select-trigger]]:focus-visible:border-studio-accent [&_[data-slot=select-trigger]]:focus-visible:bg-background [&_[data-slot=select-trigger]]:focus-visible:ring-2 [&_[data-slot=select-trigger]]:focus-visible:ring-studio-accent/20",
        className
      )}
      {...props}
    >
      <div className="flex h-8 min-w-0 items-center">
        <h3 className="truncate text-[11px] leading-4 font-semibold tracking-[-0.01em]">
          {title}
        </h3>
      </div>
      <div className="flex min-w-0 flex-col gap-2">{children}</div>
    </section>
  )
}

function MaskInspectorSection({
  document,
  capabilities,
  commandContext,
  commandRuntime,
}: {
  document: Document
  capabilities: InspectorMaskCapabilities
  commandContext?: ProductCommandRuntimeContext
  commandRuntime?: ProductCommandMenuRuntime
}) {
  const group = capabilities.groupId
    ? document.groups.find((candidate) => candidate.id === capabilities.groupId)
    : undefined
  const groupNodeOptions =
    group?.role === "mask"
      ? group.nodeIds.flatMap((nodeId) => {
          const node = document.nodes.find(
            (candidate) => candidate.id === nodeId
          )
          if (!node) return []
          return [node]
        })
      : []
  const nodeById = new Map(groupNodeOptions.map((node) => [node.id, node]))
  const selectedSourceOptions = capabilities.sourceNodeIds.flatMap(
    (sourceNodeId) => {
      const node = nodeById.get(sourceNodeId)
      return node ? [node] : []
    }
  )
  const availableSourceOptions = groupNodeOptions.filter(
    (node) => !capabilities.sourceNodeIds.includes(node.id)
  )
  const identity = commandContext
    ? {
        documentId: commandContext.documentId,
        snapshotId: commandContext.snapshotId,
        pageId: commandContext.activePageId,
      }
    : null
  const runCreate = () => {
    const sourceNodeId = capabilities.createSourceNodeIds[0]
    const selection = commandContext?.selection
    if (!identity || !selection || !sourceNodeId) return
    commandRuntime?.run({
      commandId: "mask.create",
      target: {
        ...identity,
        kind: "selection",
        displayName: `${selection.nodeIds.length} selected layers`,
        nodeIds: selection.nodeIds,
        groupId: selection.groupId ?? null,
      },
      arguments: {
        kind: "mask-create",
        sourceNodeIds: [sourceNodeId],
        parentGroupId: capabilities.createParentGroupId,
      },
    })
  }
  const groupTarget =
    identity && capabilities.groupId
      ? {
          ...identity,
          kind: "group" as const,
          displayName: group?.name ?? "Selected mask",
          groupId: capabilities.groupId,
        }
      : null
  const runGroupCommand = (
    commandId:
      | "mask.release"
      | "mask.type.vector"
      | "mask.type.alpha"
      | "mask.type.luminance"
  ) => {
    if (groupTarget) commandRuntime?.run({ commandId, target: groupTarget })
  }
  const setOrderedSources = (sourceNodeIds: string[]) => {
    if (!groupTarget || sourceNodeIds.length < 1 || sourceNodeIds.length > 4)
      return
    commandRuntime?.run({
      commandId: "mask.sources.set",
      target: groupTarget,
      arguments: {
        kind: "mask-sources",
        sourceNodeIds: sourceNodeIds as [string, ...string[]],
      },
    })
  }

  if (!group && (commandContext?.selection?.nodeIds.length ?? 0) < 2)
    return null
  return (
    <InspectorSection title="Mask" data-mask-inspector="true">
      {!group ? (
        <div className="flex flex-col gap-1.5">
          <Button
            variant="outline"
            className="justify-start"
            disabled={!capabilities.create.enabled}
            onClick={runCreate}
          >
            Use as mask
          </Button>
          {!capabilities.create.enabled &&
          capabilities.create.disabledReason ? (
            <p className="text-[11px] leading-4 text-muted-foreground">
              {capabilities.create.disabledReason}
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <Field className="gap-1.5">
            <FieldLabel>Type</FieldLabel>
            <ToggleGroup
              type="single"
              value={capabilities.type ?? undefined}
              aria-label="Mask type"
              className="grid grid-cols-3"
            >
              <ToggleGroupItem
                value="vector"
                aria-label="Vector mask"
                aria-pressed={capabilities.type === "vector"}
                onClick={() => runGroupCommand("mask.type.vector")}
              >
                Vector
              </ToggleGroupItem>
              <ToggleGroupItem
                value="alpha"
                aria-label="Alpha mask"
                disabled={!capabilities.setAlpha.enabled}
                title={capabilities.setAlpha.disabledReason ?? undefined}
                onClick={() => runGroupCommand("mask.type.alpha")}
              >
                Alpha
              </ToggleGroupItem>
              <ToggleGroupItem
                value="luminance"
                aria-label="Luminance mask"
                disabled={!capabilities.setLuminance.enabled}
                title={capabilities.setLuminance.disabledReason ?? undefined}
                onClick={() => runGroupCommand("mask.type.luminance")}
              >
                Luma
              </ToggleGroupItem>
            </ToggleGroup>
            <FieldDescription>
              {capabilities.setAlpha.disabledReason
                ? `${capabilities.setAlpha.disabledReason} `
                : null}
              {capabilities.setLuminance.disabledReason}
            </FieldDescription>
          </Field>
          <Field className="gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <FieldLabel>Source layers</FieldLabel>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {capabilities.sourceNodeIds.length}/4
              </span>
            </div>
            <div
              className="overflow-hidden rounded-[5px] border border-border/80"
              aria-label="Mask source layers"
            >
              {selectedSourceOptions.map((node) => {
                const sourceIndex = capabilities.sourceNodeIds.indexOf(node.id)
                return (
                  <div
                    key={node.id}
                    className="flex h-8 min-w-0 items-center gap-1 border-b border-border/70 px-1.5 last:border-b-0"
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="shrink-0"
                      aria-label={`Remove source ${sourceIndex + 1}, ${node.name}, from mask sources`}
                      aria-pressed="true"
                      disabled={
                        !groupTarget || capabilities.sourceNodeIds.length === 1
                      }
                      onClick={() => {
                        setOrderedSources(
                          capabilities.sourceNodeIds.filter(
                            (sourceNodeId) => sourceNodeId !== node.id
                          )
                        )
                      }}
                    >
                      <Check className="size-3.5" />
                    </Button>
                    <span
                      className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-muted text-[11px] font-medium text-muted-foreground tabular-nums"
                      aria-label={`Mask source ${sourceIndex + 1} of ${capabilities.sourceNodeIds.length}`}
                    >
                      {sourceIndex + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px]">
                      {node.name}
                    </span>
                    <div className="flex shrink-0 items-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Move ${node.name} earlier in mask sources`}
                        disabled={sourceIndex === 0}
                        onClick={() => {
                          const next = [...capabilities.sourceNodeIds]
                          ;[next[sourceIndex - 1], next[sourceIndex]] = [
                            next[sourceIndex]!,
                            next[sourceIndex - 1]!,
                          ]
                          setOrderedSources(next)
                        }}
                      >
                        <ChevronUp className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Move ${node.name} later in mask sources`}
                        disabled={
                          sourceIndex === capabilities.sourceNodeIds.length - 1
                        }
                        onClick={() => {
                          const next = [...capabilities.sourceNodeIds]
                          ;[next[sourceIndex], next[sourceIndex + 1]] = [
                            next[sourceIndex + 1]!,
                            next[sourceIndex]!,
                          ]
                          setOrderedSources(next)
                        }}
                      >
                        <ChevronDown className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
            {availableSourceOptions.length ? (
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">
                  Available to add
                </span>
                <div className="overflow-hidden rounded-[5px] border border-border/80">
                  {availableSourceOptions.map((node) => {
                    const eligible =
                      capabilities.eligibleSourceNodeIds.includes(node.id)
                    const cannotAdd =
                      capabilities.sourceNodeIds.length >= 4 ||
                      capabilities.sourceNodeIds.length + 1 >=
                        (group?.nodeIds.length ?? 0)
                    return (
                      <div
                        key={node.id}
                        className="flex h-8 min-w-0 items-center gap-1.5 border-b border-border/70 px-1.5 last:border-b-0"
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="shrink-0"
                          aria-label={`Add ${node.name} as mask source`}
                          disabled={!groupTarget || !eligible || cannotAdd}
                          onClick={() =>
                            setOrderedSources([
                              ...capabilities.sourceNodeIds,
                              node.id,
                            ])
                          }
                        >
                          <Plus className="size-3.5" />
                        </Button>
                        <span className="min-w-0 flex-1 truncate text-[11px]">
                          {node.name}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}
            <FieldDescription>
              Sources combine in this order. Keep at least one layer as masked
              content.
            </FieldDescription>
          </Field>
          <Button
            variant="outline"
            className="justify-start"
            disabled={!capabilities.release.enabled}
            onClick={() => runGroupCommand("mask.release")}
          >
            Release mask
          </Button>
        </>
      )}
    </InspectorSection>
  )
}

function ComponentInspectorSection({
  context,
  reviewPending,
  onUpdateComponent,
  onSwitchVariant,
  onResetLayerOverrides,
  onResetAllOverrides,
  onDetach,
  onFocusSource,
}: {
  context: ComponentSelectionContext
  reviewPending: boolean
  onUpdateComponent: (
    componentId: string,
    patch: {
      name?: string
      description?: string
      defaultVariantId?: string
    }
  ) => boolean
  onSwitchVariant: (instanceId: string, variantId: string) => boolean
  onResetLayerOverrides: (instanceId: string, sourceNodeId: string) => boolean
  onResetAllOverrides: (instanceId: string) => boolean
  onDetach: (instanceId: string) => boolean
  onFocusSource: (componentId: string) => void
}) {
  const instance = context.kind === "instance" ? context.instance : null
  const selectedVariantId =
    instance?.variantId ?? context.component.defaultVariantId
  const totalOverrideCount = context.totalOverrideProperties.length
  const layerOverrideCount = context.selectedOverrideProperties.length
  return (
    <InspectorSection
      title={
        context.kind === "instance" ? "Component instance" : "Main component"
      }
      data-component-inspector-kind={context.kind}
      className="bg-studio-accent/[0.025]"
    >
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-studio-accent/10 text-studio-accent">
          <ComponentIcon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold">
            {context.component.name}
          </p>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
            {context.kind === "instance"
              ? `${context.instance.name} · ${totalOverrideCount} override${totalOverrideCount === 1 ? "" : "s"}`
              : `${context.instanceCount} linked instance${context.instanceCount === 1 ? "" : "s"}`}
          </p>
        </div>
        {context.kind === "instance" && totalOverrideCount ? (
          <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">
            {totalOverrideCount}
          </Badge>
        ) : null}
      </div>

      {context.kind === "source" ? (
        <Field className="gap-1.5">
          <FieldLabel>Component name</FieldLabel>
          <CommitInput
            value={context.component.name}
            disabled={reviewPending}
            aria-label="Component name"
            className="h-8 text-xs"
            onCommit={(value) => {
              const name = value.trim()
              if (name && name !== context.component.name) {
                onUpdateComponent(context.component.id, { name })
              }
            }}
          />
          <FieldDescription>
            Names the reusable component. Layer names remain separate.
          </FieldDescription>
        </Field>
      ) : null}

      <Field className="gap-1.5">
        <FieldLabel>
          {context.kind === "instance" ? "Variant" : "Default variant"}
        </FieldLabel>
        <Select
          value={selectedVariantId}
          disabled={reviewPending}
          onValueChange={(variantId) => {
            if (context.kind === "instance") {
              onSwitchVariant(context.instance.id, variantId)
            } else {
              onUpdateComponent(context.component.id, {
                defaultVariantId: variantId,
              })
            }
          }}
        >
          <SelectTrigger className="h-8 text-xs" aria-label="Component variant">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {context.component.variants.map((variant) => (
                <SelectItem key={variant.id} value={variant.id}>
                  {variant.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>

      {instance ? (
        <>
          {context.selectedSourceNodeId ? (
            <div className="flex items-center justify-between gap-2 rounded-[4px] border border-border/70 bg-background px-2 py-1.5">
              <div className="min-w-0">
                <p className="text-[11px] font-medium">Selected layer</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {layerOverrideCount
                    ? context.selectedOverrideProperties.join(", ")
                    : "Uses main component values"}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 shrink-0 px-2 text-[11px]"
                disabled={!layerOverrideCount || reviewPending}
                onClick={() =>
                  onResetLayerOverrides(
                    instance.id,
                    context.selectedSourceNodeId!
                  )
                }
              >
                <RefreshCw /> Reset
              </Button>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 justify-start px-2 text-[11px]"
              disabled={reviewPending}
              onClick={() => onFocusSource(context.component.id)}
            >
              <Crosshair /> Main component
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 justify-start px-2 text-[11px]"
              disabled={!totalOverrideCount || reviewPending}
              onClick={() => onResetAllOverrides(instance.id)}
            >
              <RefreshCw /> Reset all
            </Button>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 justify-start px-2 text-[11px] text-muted-foreground"
            disabled={reviewPending}
            onClick={() => onDetach(instance.id)}
          >
            <Unlink /> Detach instance
          </Button>
        </>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 justify-start px-2 text-[11px]"
          disabled={reviewPending}
          onClick={() => onFocusSource(context.component.id)}
        >
          <Crosshair /> Focus main component
        </Button>
      )}
    </InspectorSection>
  )
}

const inspectorValue = (value: number): InspectorSharedValue<number> => ({
  kind: "value",
  value,
})

const mapInspectorValue = <TFrom, TTo>(
  value: InspectorSharedValue<TFrom>,
  map: (value: TFrom) => TTo
): InspectorSharedValue<TTo> =>
  value.kind === "value" ? { kind: "value", value: map(value.value) } : value

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
  onAlign: (alignment: Alignment) => void
  disabled?: boolean
}) {
  return (
    <div
      aria-label="Align selection to page"
      className="flex items-center justify-between"
      role="toolbar"
    >
      {[alignmentActions.slice(0, 3), alignmentActions.slice(3)].map(
        (group, groupIndex) => (
          <div className="flex items-center gap-0.5" key={groupIndex}>
            {group.map(([label, alignment, Icon]) => (
              <Button
                key={alignment}
                aria-label={label}
                title={label}
                disabled={disabled}
                size="icon-xs"
                variant="ghost"
                onClick={() => onAlign(alignment)}
              >
                <Icon />
              </Button>
            ))}
          </div>
        )
      )}
    </div>
  )
}

function TextSelectionMetric({
  label,
  value,
  mixed = false,
  className,
}: {
  label: string
  value: string
  mixed?: boolean
  className?: string
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p
        className="mt-0.5 truncate text-[11px] font-medium"
        data-mixed={mixed || undefined}
      >
        {value}
      </p>
    </div>
  )
}

function TextSelectionInspector({
  state,
  disabled,
  onApply,
  onEditLink,
}: {
  state: CanvasTextEditingState
  disabled: boolean
  onApply: (patch: TextRunStylePatch) => void
  onEditLink: () => void
}) {
  const fontFamily = sharedTextSelectionValue(state.style.fontFamily)
  const fontSize = sharedTextSelectionValue(state.style.fontSize)
  const fontWeight = sharedTextSelectionValue(state.style.fontWeight)
  const italic = sharedTextSelectionValue(state.style.italic)
  const decoration = sharedTextSelectionValue(state.style.decoration)
  const color = sharedTextSelectionValue(state.style.color)
  const lineHeight = sharedTextSelectionValue(state.style.lineHeight)
  const letterSpacing = sharedTextSelectionValue(state.style.letterSpacing)
  const start = Math.min(state.selection.anchor, state.selection.focus)
  const end = Math.max(state.selection.anchor, state.selection.focus)
  const collapsed = start === end
  const characterCount = Array.from(state.text.slice(start, end)).length
  const valueLabel = (value: number | null) =>
    value === null ? "Mixed" : String(Math.round(value * 100) / 100)
  const linkLabel =
    state.link.kind === "value"
      ? "Linked"
      : state.link.kind === "mixed"
        ? "Mixed links"
        : "No link"
  const keepCanvasFocus = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
  }

  return (
    <div
      className="rounded-lg border bg-muted/25 p-2.5"
      data-text-selection-inspector="true"
      onMouseDown={keepCanvasFocus}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold">Text selection</p>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
            {collapsed
              ? "Formatting for text typed at this insertion point."
              : `${characterCount} character${characterCount === 1 ? "" : "s"} selected.`}
          </p>
        </div>
        <Badge variant="secondary" className="shrink-0 font-normal">
          {collapsed ? "Caret" : "Selection"}
        </Badge>
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 border-t pt-2.5">
        <TextSelectionMetric
          label="Font"
          value={fontFamily ?? "Mixed"}
          mixed={fontFamily === null}
        />
        <TextSelectionMetric
          label="Color"
          value={color ?? "Mixed"}
          mixed={color === null}
        />
        <TextSelectionMetric
          label="Line height"
          value={valueLabel(lineHeight)}
          mixed={lineHeight === null}
        />
        <TextSelectionMetric
          label="Tracking"
          value={valueLabel(letterSpacing)}
          mixed={letterSpacing === null}
        />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1 border-t pt-2.5">
        <div
          aria-label="Selected text font size"
          className="flex h-8 items-center rounded-md border bg-background"
          role="group"
        >
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Decrease selected text font size"
            className="size-8 rounded-md text-xs"
            disabled={disabled}
            onClick={() =>
              onApply({ fontSize: Math.max(1, (fontSize ?? 16) - 1) })
            }
          >
            −
          </Button>
          <span
            aria-label={fontSize === null ? "Mixed font sizes" : undefined}
            className="w-8 text-center text-[11px] font-medium tabular-nums"
          >
            {fontSize === null ? "—" : Math.round(fontSize)}
          </span>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Increase selected text font size"
            className="size-8 rounded-md text-xs"
            disabled={disabled}
            onClick={() => onApply({ fontSize: (fontSize ?? 16) + 1 })}
          >
            +
          </Button>
        </div>
        {[
          [
            "Bold selected text",
            "B",
            fontWeight !== null && fontWeight >= 700,
            fontWeight === null,
            "bold",
          ],
          [
            "Italicize selected text",
            "I",
            italic === true,
            italic === null,
            "italic",
          ],
          [
            "Underline selected text",
            "U",
            decoration === "underline",
            decoration === null,
            "underline",
          ],
          [
            "Strike selected text",
            "S",
            decoration === "line_through",
            decoration === null,
            "strikethrough",
          ],
        ].map(([label, glyph, active, mixed, command]) => (
          <Button
            key={command as string}
            type="button"
            size="icon"
            variant="outline"
            aria-label={label as string}
            aria-pressed={active as boolean}
            className="size-8 rounded-md text-[11px] aria-pressed:bg-foreground aria-pressed:text-background data-[mixed=true]:bg-muted"
            data-mixed={mixed ? "true" : "false"}
            disabled={disabled}
            onClick={() =>
              onApply(
                textFormattingTogglePatch(
                  state,
                  command as "bold" | "italic" | "underline" | "strikethrough"
                )
              )
            }
          >
            <span
              className={cn(
                command === "bold" && "font-bold",
                command === "italic" && "italic",
                command === "underline" && "underline",
                command === "strikethrough" && "line-through"
              )}
            >
              {glyph as string}
            </span>
          </Button>
        ))}
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label={
            state.link.kind === "value"
              ? "Edit link for selected text"
              : state.link.kind === "mixed"
                ? "Replace links for selected text"
                : "Add link to selected text"
          }
          aria-pressed={state.link.kind === "value"}
          className="size-8 rounded-md aria-pressed:bg-foreground aria-pressed:text-background data-[mixed=true]:bg-muted"
          data-mixed={state.link.kind === "mixed" ? "true" : "false"}
          disabled={disabled || (collapsed && state.link.kind === "none")}
          title={linkLabel}
          onClick={onEditLink}
        >
          <Link2 />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={
            fontWeight === null
              ? "Mixed selected text font weights"
              : `Selected text font weight ${fontWeight}`
          }
          className="h-8 min-w-[72px] gap-1 rounded-[5px] px-2 text-[11px] tabular-nums"
          data-font-weight-cycle="true"
          disabled={disabled}
          onClick={() => {
            const weights = [400, 500, 600, 700, 800]
            const currentIndex = weights.indexOf(fontWeight ?? 400)
            onApply({
              fontWeight: weights[(currentIndex + 1) % weights.length],
            })
          }}
        >
          <span className="text-muted-foreground">Weight</span>
          <span className="font-mono">
            {fontWeight === null ? "Mix" : fontWeight}
          </span>
        </Button>
      </div>

      <div
        aria-label="Selected text color"
        className="mt-2 flex items-center gap-1"
        role="group"
      >
        {textColorChoices.map((choice) => (
          <button
            key={choice}
            type="button"
            aria-label={`Set selected text color ${choice}`}
            aria-pressed={color === choice}
            className="relative grid size-7 place-items-center rounded-md hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            disabled={disabled}
            onClick={() => onApply({ color: choice })}
          >
            <span
              className="size-3.5 rounded-full border border-black/15 shadow-xs"
              style={{ backgroundColor: choice }}
            />
            {color === choice ? (
              <span className="absolute right-0.5 bottom-0.5 size-1.5 rounded-full bg-primary ring-1 ring-background" />
            ) : null}
          </button>
        ))}
      </div>
    </div>
  )
}

type InspectorPaintNode = Extract<
  SceneNode,
  { type: "rect" | "frame" | "ellipse" | "line" | "icon" }
>

const nextPaintId = (prefix: "fill" | "stroke", ids: readonly string[]) => {
  let index = ids.length + 1
  while (ids.includes(`${prefix}-${index}`)) index += 1
  return `${prefix}-${index}`
}

function StrokeAdvancedControls({
  node,
  paint,
  onChange,
}: {
  node: InspectorPaintNode
  paint: StrokePaint
  onChange: (paint: StrokePaint) => void
}) {
  const openPath = node.type === "line" || node.type === "icon"
  const sides = paint.sides ?? {
    top: true,
    right: true,
    bottom: true,
    left: true,
  }
  return (
    <div className="mt-2 space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <Select
          value={paint.alignment ?? (openPath ? "center" : "inside")}
          disabled={node.locked || openPath}
          onValueChange={(alignment: "inside" | "center" | "outside") =>
            onChange({ ...paint, alignment })
          }
        >
          <SelectTrigger aria-label="Stroke alignment">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="inside">Inside</SelectItem>
            <SelectItem value="center">Center</SelectItem>
            <SelectItem value="outside">Outside</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={paint.cap ?? "butt"}
          disabled={node.locked}
          onValueChange={(cap: "butt" | "round" | "square") =>
            onChange({ ...paint, cap })
          }
        >
          <SelectTrigger aria-label="Stroke cap">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="butt">Butt</SelectItem>
            <SelectItem value="round">Round</SelectItem>
            <SelectItem value="square">Square</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={paint.join ?? "miter"}
          disabled={node.locked}
          onValueChange={(join: "miter" | "round" | "bevel") =>
            onChange({ ...paint, join })
          }
        >
          <SelectTrigger aria-label="Stroke join">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="miter">Miter</SelectItem>
            <SelectItem value="round">Round</SelectItem>
            <SelectItem value="bevel">Bevel</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <CommitInput
          aria-label="Stroke dash pattern"
          disabled={node.locked}
          placeholder="Solid"
          value={(paint.dash ?? []).join(" ")}
          onCommit={(value) => {
            const dash = value
              .trim()
              .split(/[\s,]+/)
              .filter(Boolean)
              .map(Number)
              .filter((segment) => Number.isFinite(segment) && segment >= 0)
              .slice(0, 16)
            if (dash.length === 0 || dash.some((segment) => segment > 0)) {
              onChange({ ...paint, dash })
            }
          }}
        />
        <InspectorNumberField
          label="Miter"
          value={inspectorValue(paint.miterLimit ?? 4)}
          min={1}
          max={100}
          disabled={node.locked || (paint.join ?? "miter") !== "miter"}
          onCommit={(miterLimit) => onChange({ ...paint, miterLimit })}
        />
      </div>
      {node.type === "rect" || node.type === "frame" ? (
        <div className="grid grid-cols-4 gap-1" aria-label="Stroke sides">
          {(["top", "right", "bottom", "left"] as const).map((side) => (
            <label
              className="flex items-center gap-1 text-[10px] text-muted-foreground"
              key={side}
            >
              <Checkbox
                aria-label={`${side} stroke side`}
                checked={sides[side]}
                disabled={node.locked}
                onCheckedChange={(checked) =>
                  onChange({
                    ...paint,
                    sides: { ...sides, [side]: checked === true },
                  })
                }
              />
              {side[0]?.toUpperCase()}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function PaintStackControls({
  node,
  onUpdate,
}: {
  node: InspectorPaintNode
  onUpdate: (patch: Partial<SceneNode>) => void
}) {
  const fills: FillPaint[] =
    node.type === "line"
      ? []
      : (node.fills ?? [
          {
            id: "legacy-fill",
            color: node.fill,
            opacity: 1,
            visible: true,
          },
        ])
  const strokes: StrokePaint[] =
    node.strokes ??
    (node.stroke && node.strokeWidth > 0
      ? [
          {
            id: "legacy-stroke",
            color: node.stroke,
            width: node.strokeWidth,
            opacity: 1,
            visible: true,
          },
        ]
      : [])
  const updateList = (
    kind: "fills" | "strokes",
    paints: FillPaint[] | StrokePaint[]
  ) => onUpdate({ [kind]: paints } as Partial<SceneNode>)
  const renderList = (
    kind: "fills" | "strokes",
    paints: FillPaint[] | StrokePaint[]
  ) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <FieldLabel>{kind === "fills" ? "Fills" : "Strokes"}</FieldLabel>
        <Button
          aria-label={`Add ${kind === "fills" ? "fill" : "stroke"}`}
          disabled={node.locked || paints.length >= 8}
          size="icon-xs"
          variant="ghost"
          onClick={() => {
            const id = nextPaintId(
              kind === "fills" ? "fill" : "stroke",
              paints.map((paint) => paint.id)
            )
            updateList(kind, [
              ...paints,
              kind === "fills"
                ? { id, color: "#d9c9b2", opacity: 1, visible: true }
                : {
                    id,
                    color: "#1e2622",
                    width: 1,
                    opacity: 1,
                    visible: true,
                  },
            ])
          }}
        >
          <Plus />
        </Button>
      </div>
      {paints.map((paint, index) => (
        <div
          className="rounded-md border border-border/70 bg-muted/25 p-2"
          data-paint-id={paint.id}
          key={paint.id}
        >
          <div className="flex items-center gap-1">
            <Checkbox
              aria-label={`${kind} ${index + 1} visible`}
              checked={paint.visible}
              disabled={node.locked}
              onCheckedChange={(checked) =>
                updateList(
                  kind,
                  paints.map((candidate, candidateIndex) =>
                    candidateIndex === index
                      ? { ...candidate, visible: checked === true }
                      : candidate
                  ) as FillPaint[] | StrokePaint[]
                )
              }
            />
            <Input
              aria-label={`${kind} ${index + 1} color`}
              className="h-7 min-w-0 flex-1 font-mono text-[11px]"
              disabled={node.locked}
              value={paint.color}
              onChange={(event) =>
                updateList(
                  kind,
                  paints.map((candidate, candidateIndex) =>
                    candidateIndex === index
                      ? { ...candidate, color: event.target.value }
                      : candidate
                  ) as FillPaint[] | StrokePaint[]
                )
              }
            />
            <Button
              aria-label={`Move ${kind} ${index + 1} up`}
              disabled={node.locked || index === 0}
              size="icon-xs"
              variant="ghost"
              onClick={() => {
                const next = [...paints]
                ;[next[index - 1], next[index]] = [
                  next[index]!,
                  next[index - 1]!,
                ]
                updateList(kind, next as FillPaint[] | StrokePaint[])
              }}
            >
              <ChevronUp />
            </Button>
            <Button
              aria-label={`Move ${kind} ${index + 1} down`}
              disabled={node.locked || index === paints.length - 1}
              size="icon-xs"
              variant="ghost"
              onClick={() => {
                const next = [...paints]
                ;[next[index], next[index + 1]] = [
                  next[index + 1]!,
                  next[index]!,
                ]
                updateList(kind, next as FillPaint[] | StrokePaint[])
              }}
            >
              <ChevronDown />
            </Button>
            <Button
              aria-label={`Remove ${kind} ${index + 1}`}
              disabled={node.locked}
              size="icon-xs"
              variant="ghost"
              onClick={() =>
                updateList(
                  kind,
                  paints.filter(
                    (_, candidateIndex) => candidateIndex !== index
                  ) as FillPaint[] | StrokePaint[]
                )
              }
            >
              <Trash2 />
            </Button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <InspectorNumberField
              label="Opacity"
              value={inspectorValue(paint.opacity * 100)}
              min={0}
              max={100}
              disabled={node.locked}
              onCommit={(opacity) =>
                updateList(
                  kind,
                  paints.map((candidate, candidateIndex) =>
                    candidateIndex === index
                      ? { ...candidate, opacity: opacity / 100 }
                      : candidate
                  ) as FillPaint[] | StrokePaint[]
                )
              }
            />
            {"width" in paint ? (
              <InspectorNumberField
                label="Width"
                value={inspectorValue(paint.width)}
                min={0}
                step={0.1}
                disabled={node.locked}
                onCommit={(width) =>
                  updateList(
                    kind,
                    paints.map((candidate, candidateIndex) =>
                      candidateIndex === index
                        ? { ...candidate, width }
                        : candidate
                    ) as StrokePaint[]
                  )
                }
              />
            ) : null}
          </div>
          {"width" in paint ? (
            <StrokeAdvancedControls
              node={node}
              paint={paint}
              onChange={(nextPaint) =>
                updateList(
                  kind,
                  paints.map((candidate, candidateIndex) =>
                    candidateIndex === index ? nextPaint : candidate
                  ) as StrokePaint[]
                )
              }
            />
          ) : null}
          <Select
            value={paint.blendMode ?? "normal"}
            disabled={node.locked}
            onValueChange={(blendMode: BlendMode) =>
              updateList(
                kind,
                paints.map((candidate, candidateIndex) =>
                  candidateIndex === index
                    ? { ...candidate, blendMode }
                    : candidate
                ) as FillPaint[] | StrokePaint[]
              )
            }
          >
            <SelectTrigger aria-label={`${kind} ${index + 1} blend mode`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BLEND_MODE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
    </div>
  )
  return (
    <div className="space-y-3">
      {node.type === "line" ? null : renderList("fills", fills)}
      {renderList("strokes", strokes)}
    </div>
  )
}

const nextEffectId = (
  prefix: "shadow" | "blur",
  effects: readonly LayerEffect[]
) => {
  let index = effects.length + 1
  while (effects.some((effect) => effect.id === `${prefix}-${index}`))
    index += 1
  return `${prefix}-${index}`
}

function EffectStackControls({
  node,
  onUpdate,
}: {
  node: SceneNode
  onUpdate: (patch: Partial<SceneNode>) => void
}) {
  const effects = node.effects ?? []
  const update = (next: LayerEffect[]) => onUpdate({ effects: next })
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <FieldLabel>Effects</FieldLabel>
        <div className="flex gap-1">
          <Button
            aria-label="Add drop shadow"
            disabled={node.locked || effects.length >= 8}
            size="xs"
            variant="ghost"
            onClick={() =>
              update([
                ...effects,
                {
                  id: nextEffectId("shadow", effects),
                  type: "drop_shadow",
                  color: "#00000040",
                  offsetX: 0,
                  offsetY: 8,
                  blur: 16,
                  visible: true,
                },
              ])
            }
          >
            Shadow
          </Button>
          <Button
            aria-label="Add layer blur"
            disabled={node.locked || effects.length >= 8}
            size="xs"
            variant="ghost"
            onClick={() =>
              update([
                ...effects,
                {
                  id: nextEffectId("blur", effects),
                  type: "layer_blur",
                  radius: 4,
                  visible: true,
                },
              ])
            }
          >
            Blur
          </Button>
        </div>
      </div>
      {effects.map((effect, index) => {
        const replace = (next: LayerEffect) =>
          update(
            effects.map((candidate, candidateIndex) =>
              candidateIndex === index ? next : candidate
            )
          )
        return (
          <div
            className="rounded-md border border-border/70 bg-muted/25 p-2"
            key={effect.id}
          >
            <div className="flex items-center gap-1">
              <Checkbox
                aria-label={`Effect ${index + 1} visible`}
                checked={effect.visible}
                disabled={node.locked}
                onCheckedChange={(checked) =>
                  replace({ ...effect, visible: checked === true })
                }
              />
              <span className="min-w-0 flex-1 text-[11px] text-muted-foreground">
                {effect.type === "drop_shadow" ? "Drop shadow" : "Layer blur"}
              </span>
              <Button
                aria-label={`Move effect ${index + 1} up`}
                disabled={node.locked || index === 0}
                size="icon-xs"
                variant="ghost"
                onClick={() => {
                  const next = [...effects]
                  ;[next[index - 1], next[index]] = [
                    next[index]!,
                    next[index - 1]!,
                  ]
                  update(next)
                }}
              >
                <ChevronUp />
              </Button>
              <Button
                aria-label={`Move effect ${index + 1} down`}
                disabled={node.locked || index === effects.length - 1}
                size="icon-xs"
                variant="ghost"
                onClick={() => {
                  const next = [...effects]
                  ;[next[index], next[index + 1]] = [
                    next[index + 1]!,
                    next[index]!,
                  ]
                  update(next)
                }}
              >
                <ChevronDown />
              </Button>
              <Button
                aria-label={`Remove effect ${index + 1}`}
                disabled={node.locked}
                size="icon-xs"
                variant="ghost"
                onClick={() =>
                  update(effects.filter((_, candidate) => candidate !== index))
                }
              >
                <Trash2 />
              </Button>
            </div>
            {effect.type === "drop_shadow" ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <CommitInput
                  aria-label="Shadow color"
                  disabled={node.locked}
                  value={effect.color}
                  onCommit={(color) => {
                    if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color))
                      replace({ ...effect, color })
                  }}
                />
                <InspectorNumberField
                  label="Blur"
                  value={inspectorValue(effect.blur)}
                  min={0}
                  max={64}
                  disabled={node.locked}
                  onCommit={(blur) => replace({ ...effect, blur })}
                />
                <InspectorNumberField
                  label="X"
                  value={inspectorValue(effect.offsetX)}
                  min={-4096}
                  max={4096}
                  disabled={node.locked}
                  onCommit={(offsetX) => replace({ ...effect, offsetX })}
                />
                <InspectorNumberField
                  label="Y"
                  value={inspectorValue(effect.offsetY)}
                  min={-4096}
                  max={4096}
                  disabled={node.locked}
                  onCommit={(offsetY) => replace({ ...effect, offsetY })}
                />
              </div>
            ) : (
              <div className="mt-2">
                <InspectorNumberField
                  label="Radius"
                  value={inspectorValue(effect.radius)}
                  min={0}
                  max={64}
                  disabled={node.locked}
                  onCommit={(radius) => replace({ ...effect, radius })}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function LayerExportControls({
  node,
  onUpdate,
}: {
  node: SceneNode
  onUpdate: (patch: Partial<SceneNode>) => void
}) {
  const settings = node.exportSettings ?? []
  const update = (next: LayerExportSetting[]) =>
    onUpdate({ exportSettings: next })
  const add = (format: "png" | "pdf") => {
    let index = settings.length + 1
    while (settings.some((setting) => setting.id === `export-${index}`))
      index += 1
    update([
      ...settings,
      { id: `export-${index}`, format, scale: 1, suffix: "" },
    ])
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <FieldLabel>Layer exports</FieldLabel>
        <div className="flex gap-1">
          <Button
            aria-label="Add PNG layer export"
            disabled={node.locked || settings.length >= 4}
            size="xs"
            variant="ghost"
            onClick={() => add("png")}
          >
            PNG
          </Button>
          <Button
            aria-label="Add PDF layer export"
            disabled={node.locked || settings.length >= 4}
            size="xs"
            variant="ghost"
            onClick={() => add("pdf")}
          >
            PDF
          </Button>
        </div>
      </div>
      {settings.map((setting, index) => {
        const replace = (next: LayerExportSetting) =>
          update(
            settings.map((candidate, candidateIndex) =>
              candidateIndex === index ? next : candidate
            )
          )
        return (
          <div
            className="grid grid-cols-[5rem_1fr_1fr_auto] gap-1 rounded-md border border-border/70 bg-muted/25 p-2"
            key={setting.id}
          >
            <Select
              value={setting.format}
              disabled={node.locked}
              onValueChange={(format: "png" | "pdf") =>
                replace({ ...setting, format })
              }
            >
              <SelectTrigger aria-label={`Layer export ${index + 1} format`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="png">PNG</SelectItem>
                <SelectItem value="pdf">PDF</SelectItem>
              </SelectContent>
            </Select>
            <InspectorNumberField
              label="Scale"
              value={inspectorValue(setting.scale)}
              min={0.25}
              max={4}
              step={0.25}
              disabled={node.locked}
              onCommit={(scale) => replace({ ...setting, scale })}
            />
            <CommitInput
              aria-label={`Layer export ${index + 1} suffix`}
              placeholder="Suffix"
              value={setting.suffix}
              disabled={node.locked}
              onCommit={(suffix) => {
                if (/^[A-Za-z0-9._-]{0,40}$/.test(suffix))
                  replace({ ...setting, suffix })
              }}
            />
            <Button
              aria-label={`Remove layer export ${index + 1}`}
              disabled={node.locked}
              size="icon-xs"
              variant="ghost"
              onClick={() =>
                update(settings.filter((_, candidate) => candidate !== index))
              }
            >
              <Trash2 />
            </Button>
          </div>
        )
      })}
      {settings.length ? (
        <p className="text-[10px] leading-4 text-muted-foreground">
          Use Export layer from the layer menu. Published manifests retain the
          same page/output route.
        </p>
      ) : null}
    </div>
  )
}

function NodeInspector({
  document,
  node,
  textEditingState,
  focusedProperty,
  onUpdate,
  onUpdateRelatedNode,
  onPreview,
  onCancelPreview,
  onAlignToPage,
  onUpdateImageFrameGeometry,
  onSetImagePlacement,
  onSetImageFrameMask,
  onRunImageCommand,
  isImageCommandEnabled,
  onRetryImageSource,
  onRemoveImageLayer,
  onReviewDocumentImage = () => undefined,
  backgroundRemoval,
  capabilityContext,
  onApplyTextEditingStyle = ignoreTextStylePatch,
  onApplyTextEditingParagraphStyle = ignoreTextParagraphStylePatch,
  onEditTextLink = ignoreReviewTarget,
  onCreateTypographyStyle = ignoreCreateTypographyStyle,
  onUpdateTypographyStyle = ignoreTypographyStyleUpdate,
  onDeleteTypographyStyle = ignoreStyleMutation,
  onApplyTypographyStyle = ignoreStyleMutation,
  onDetachTypographyStyle = ignoreNodeStyleDetach,
  onCreatePaintStyle = ignoreCreatePaintStyle,
  onUpdatePaintStyle = ignorePaintStyleUpdate,
  onDeletePaintStyle = ignoreStyleMutation,
  onApplyPaintStyle = ignoreStyleMutation,
  onDetachPaintStyle = ignoreNodeStyleDetach,
  onFocusStyleNode = ignoreNodeId,
}: {
  document: Document
  node: SceneNode
  textEditingState?: CanvasTextEditingState | null
  focusedProperty?: BindableProperty
  onUpdate: (patch: Partial<SceneNode>) => void
  onUpdateRelatedNode: (nodeId: string, patch: Partial<SceneNode>) => void
  onPreview: (patch: Partial<SceneNode>) => void
  onCancelPreview: () => void
  onAlignToPage: (alignment: Alignment) => void
  onUpdateImageFrameGeometry: (
    nodeId: string,
    patch: Partial<NodeGeometryPatch>
  ) => void
  onSetImagePlacement: (nodeId: string, placement: ImagePlacement) => void
  onSetImageFrameMask: (nodeId: string, frameMask: ImageFrameMask) => void
  onRunImageCommand: (commandId: EditorImageCommandId) => void
  isImageCommandEnabled: (commandId: EditorImageCommandId) => boolean
  onRetryImageSource: (nodeId: string) => void
  onRemoveImageLayer: () => void
  onReviewDocumentImage?: (localAssetId: string) => void
  backgroundRemoval?: BackgroundRemovalModel
  capabilityContext?: InspectorCapabilityContext
  onApplyTextEditingStyle?: (patch: TextRunStylePatch) => void
  onApplyTextEditingParagraphStyle?: (patch: TextParagraphStylePatch) => void
  onEditTextLink?: () => void
  onCreateTypographyStyle?: (
    style: Omit<TypographyStyle, "id">,
    nodeId?: string
  ) => string | null
  onUpdateTypographyStyle?: (
    styleId: string,
    patch: TypographyStylePatch
  ) => boolean
  onDeleteTypographyStyle?: (styleId: string) => boolean
  onApplyTypographyStyle?: (styleId: string, nodeId: string) => boolean
  onDetachTypographyStyle?: (nodeId: string) => boolean
  onCreatePaintStyle?: (
    style: Omit<PaintStyle, "id">,
    nodeId?: string
  ) => string | null
  onUpdatePaintStyle?: (styleId: string, patch: PaintStylePatch) => boolean
  onDeletePaintStyle?: (styleId: string) => boolean
  onApplyPaintStyle?: (styleId: string, nodeId: string) => boolean
  onDetachPaintStyle?: (nodeId: string) => boolean
  onFocusStyleNode?: (nodeId: string) => void
}) {
  const inspector = useMemo(
    () => createInspectorSelectionModel([node], capabilityContext),
    [capabilityContext, node]
  )
  const owningFrame = document.nodes.find(
    (candidate): candidate is Extract<SceneNode, { type: "frame" }> =>
      candidate.type === "frame" &&
      candidate.children.some((child) => child.nodeId === node.id)
  )
  const frameChildLayout = owningFrame?.children.find(
    (child) => child.nodeId === node.id
  )
  const updateFrameChildLayout = (
    patch: Partial<NonNullable<typeof frameChildLayout>>
  ) => {
    if (!owningFrame || !frameChildLayout) return
    onUpdateRelatedNode(owningFrame.id, {
      children: owningFrame.children.map((child) =>
        child.nodeId === node.id ? { ...child, ...patch } : child
      ),
    })
  }
  const decorativeCheckboxId = useId()
  const imageReplacementReasonId = useId()
  const nodeTypeLabel =
    node.type === "text"
      ? "Text"
      : node.type === "image"
        ? "Image"
        : node.type === "rect"
          ? "Rectangle"
          : node.type === "frame"
            ? "Frame"
            : node.type === "ellipse"
              ? "Ellipse"
              : node.type === "line"
                ? "Line"
                : "Icon"
  const textLayout = node.type === "text" ? projectTextLayout(node) : null
  const textWidthIsManaged =
    node.type === "text" && node.sizingMode === "auto_width"
  const textHeightIsManaged =
    node.type === "text" && node.sizingMode !== "fixed"
  const liveTextEditingState =
    node.type === "text" && textEditingState?.nodeId === node.id
      ? textEditingState
      : null
  const typographyStyleValue =
    node.type !== "text"
      ? null
      : liveTextEditingState?.typographyStyle.kind === "mixed"
        ? "mixed"
        : (liveTextEditingState?.typographyStyle.value ??
          node.typographyStyleId ??
          null)
  const paintStyleValue =
    node.type === "image"
      ? null
      : node.type === "text" && liveTextEditingState
        ? liveTextEditingState.paintStyle.kind === "mixed"
          ? "mixed"
          : liveTextEditingState.paintStyle.value
        : (node.paintStyleId ?? null)
  const typographyUsage =
    typeof typographyStyleValue === "string" && typographyStyleValue !== "mixed"
      ? designStyleUsage(document, "typography", typographyStyleValue)
      : null
  const paintUsage =
    typeof paintStyleValue === "string" && paintStyleValue !== "mixed"
      ? designStyleUsage(document, "paint", paintStyleValue)
      : null
  const usageNodes = (nodeIds: readonly string[]) =>
    nodeIds.flatMap((nodeId) => {
      const target = document.nodes.find((candidate) => candidate.id === nodeId)
      return target ? [{ id: target.id, name: target.name }] : []
    })
  const captureTypographyStyle = (
    name: string
  ): Omit<TypographyStyle, "id"> | null => {
    if (node.type !== "text") return null
    const fontFamily = liveTextEditingState
      ? sharedTextSelectionValue(liveTextEditingState.style.fontFamily)
      : node.fontFamily
    const fontSize = liveTextEditingState
      ? sharedTextSelectionValue(liveTextEditingState.style.fontSize)
      : node.fontSize
    const fontWeight = liveTextEditingState
      ? sharedTextSelectionValue(liveTextEditingState.style.fontWeight)
      : node.fontWeight
    const italic = liveTextEditingState
      ? sharedTextSelectionValue(liveTextEditingState.style.italic)
      : node.italic
    const decoration = liveTextEditingState
      ? sharedTextSelectionValue(liveTextEditingState.style.decoration)
      : node.decoration
    const lineHeight = liveTextEditingState
      ? sharedTextSelectionValue(liveTextEditingState.style.lineHeight)
      : node.lineHeight
    const letterSpacing = liveTextEditingState
      ? sharedTextSelectionValue(liveTextEditingState.style.letterSpacing)
      : node.letterSpacing
    if (
      fontFamily === null ||
      fontSize === null ||
      fontWeight === null ||
      italic === null ||
      decoration === null ||
      lineHeight === null ||
      letterSpacing === null
    ) {
      return null
    }
    return {
      name,
      fontFamily,
      fontSize,
      fontWeight,
      italic,
      decoration,
      lineHeight,
      letterSpacing,
    }
  }
  const paintColor = () => {
    if (node.type === "text") {
      return liveTextEditingState
        ? sharedTextSelectionValue(liveTextEditingState.style.color)
        : node.color
    }
    if (node.type === "line") return node.stroke
    if (
      node.type === "rect" ||
      node.type === "frame" ||
      node.type === "ellipse" ||
      node.type === "icon"
    ) {
      return node.fill
    }
    return null
  }
  const typographyRunPatch = (style: TypographyStyle): TextRunStylePatch => ({
    typographyStyleId: style.id,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    italic: style.italic,
    decoration: style.decoration,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
  })
  const paintRunPatch = (style: PaintStyle): TextRunStylePatch => ({
    paintStyleId: style.id,
    color: style.color,
  })
  const typographyStyleControl =
    node.type === "text" ? (
      <ReusableStyleField
        label="Text style"
        value={typographyStyleValue}
        styles={document.typographyStyles}
        usageNodes={usageNodes(typographyUsage?.nodeIds ?? [])}
        attachmentCount={typographyUsage?.totalAttachmentCount ?? 0}
        rangeAttachmentCount={typographyUsage?.rangeAttachmentCount ?? 0}
        disabled={node.locked}
        onApply={(styleId) => {
          if (liveTextEditingState) {
            if (!styleId) {
              onApplyTextEditingStyle({ typographyStyleId: null })
              return true
            }
            const style = document.typographyStyles.find(
              (candidate) => candidate.id === styleId
            )
            if (!style) return false
            onApplyTextEditingStyle(typographyRunPatch(style))
            return true
          }
          return styleId
            ? onApplyTypographyStyle(styleId, node.id)
            : onDetachTypographyStyle(node.id)
        }}
        onCreate={(name) => {
          const style = captureTypographyStyle(name)
          if (!style) return null
          const id = onCreateTypographyStyle(
            style,
            liveTextEditingState ? undefined : node.id
          )
          if (id && liveTextEditingState) {
            onApplyTextEditingStyle(typographyRunPatch({ ...style, id }))
          }
          return id
        }}
        onRename={(styleId, name) => onUpdateTypographyStyle(styleId, { name })}
        onUpdateFromSelection={(styleId) => {
          const current = document.typographyStyles.find(
            (style) => style.id === styleId
          )
          const captured = current ? captureTypographyStyle(current.name) : null
          return captured ? onUpdateTypographyStyle(styleId, captured) : false
        }}
        onDelete={onDeleteTypographyStyle}
        onFocusNode={onFocusStyleNode}
      />
    ) : null
  const paintStyleControl =
    node.type !== "image" ? (
      <ReusableStyleField
        label="Paint style"
        value={paintStyleValue}
        styles={document.paintStyles}
        usageNodes={usageNodes(paintUsage?.nodeIds ?? [])}
        attachmentCount={paintUsage?.totalAttachmentCount ?? 0}
        rangeAttachmentCount={paintUsage?.rangeAttachmentCount ?? 0}
        disabled={node.locked}
        onApply={(styleId) => {
          if (liveTextEditingState && node.type === "text") {
            if (!styleId) {
              onApplyTextEditingStyle({ paintStyleId: null })
              return true
            }
            const style = document.paintStyles.find(
              (candidate) => candidate.id === styleId
            )
            if (!style) return false
            onApplyTextEditingStyle(paintRunPatch(style))
            return true
          }
          return styleId
            ? onApplyPaintStyle(styleId, node.id)
            : onDetachPaintStyle(node.id)
        }}
        onCreate={(name) => {
          const color = paintColor()
          if (color === null) return null
          const style = { name, color, opacity: node.opacity }
          const id = onCreatePaintStyle(
            style,
            liveTextEditingState ? undefined : node.id
          )
          if (id && liveTextEditingState && node.type === "text") {
            onApplyTextEditingStyle(paintRunPatch({ ...style, id }))
          }
          return id
        }}
        onRename={(styleId, name) => onUpdatePaintStyle(styleId, { name })}
        onUpdateFromSelection={(styleId) => {
          const color = paintColor()
          return color === null
            ? false
            : onUpdatePaintStyle(styleId, { color, opacity: node.opacity })
        }}
        onDelete={onDeletePaintStyle}
        onFocusNode={onFocusStyleNode}
      />
    ) : null
  const paragraphState =
    node.type === "text"
      ? (liveTextEditingState?.paragraph ??
        resolveTextSelectionParagraphState(
          node.text,
          node.paragraphs,
          { anchor: 0, focus: node.text.length },
          node.align
        ))
      : null
  const paragraphAlign =
    paragraphState?.align.kind === "value" ? paragraphState.align.value : null
  const paragraphList =
    paragraphState?.list.kind === "value" ? paragraphState.list.value : null
  const legacyTextListStyle =
    node.type === "text" && node.paragraphs.length === 0
      ? detectStudioTextListStyle(node.text)
      : "none"
  const textListStyle = paragraphList?.kind ?? legacyTextListStyle
  const imageCropBarOwnsTransforms =
    node.type === "image" &&
    capabilityContext?.activeImageCropNodeId === node.id
  const nodeMutationDisabled = node.locked || imageCropBarOwnsTransforms
  const commitFrameGeometry = (patch: Partial<NodeGeometryPatch>) => {
    if (imageCropBarOwnsTransforms) {
      onUpdateImageFrameGeometry(node.id, patch)
      return
    }
    onUpdate(patch)
  }
  const imageTransformDisabled = !inspector.capabilities.canFlipImage
  const imageFrameDisabled = !inspector.capabilities.canApplyFrameMask
  const imageSourceState =
    node.type === "image"
      ? capabilityContext?.imageSourceStateByNodeId?.[node.id]
      : undefined
  const imageSourceReadiness =
    node.type === "image" && imageSourceState?.src === node.src
      ? imageSourceState.readiness
      : "unknown"
  const imageSourceDisplay =
    node.type === "image" ? assetValueDisplay(node.src) : null
  const localAssetId =
    node.type === "image" && node.src.startsWith("asset:local/")
      ? node.src.slice("asset:local/".length)
      : null
  const missingImageRecovery =
    node.type === "image"
      ? projectMissingImageRecoveryActions({
          readiness: imageSourceReadiness,
          documentEditable: capabilityContext?.documentEditable ?? true,
          imageLocked: node.locked,
          canReplaceImage: inspector.capabilities.canReplaceImage,
          replacementDisabledReason:
            inspector.capabilities.replaceImageDisabledReason,
        })
      : []
  const missingImageRecoveryById = Object.fromEntries(
    missingImageRecovery.map((action) => [action.id, action])
  )

  return (
    <div className="flex flex-col">
      <section
        data-inspector-property="visible"
        tabIndex={-1}
        aria-label={`${nodeTypeLabel} layer`}
        className={cn(
          "scroll-mt-2 border-b border-border px-3 py-2 transition-colors outline-none",
          focusedProperty === "visible" &&
            "bg-accent/70 ring-2 ring-ring ring-inset"
        )}
      >
        <div className="flex min-h-7 min-w-0 items-center gap-1.5">
          <CommitInput
            aria-label="Layer name"
            className="min-w-0 flex-1"
            value={node.name}
            disabled={nodeMutationDisabled}
            onCommit={(name) => name.trim() && onUpdate({ name })}
          />
          <Badge
            variant="secondary"
            aria-label={`Layer type: ${nodeTypeLabel}`}
            className="h-5 shrink-0 rounded-sm px-1.5 text-[11px] font-medium text-muted-foreground"
          >
            {nodeTypeLabel}
          </Badge>
          <Button
            aria-label={node.visible ? "Hide layer" : "Show layer"}
            size="icon-xs"
            variant="ghost"
            className="shrink-0"
            disabled={imageCropBarOwnsTransforms}
            onClick={() => onUpdate({ visible: !node.visible })}
          >
            {node.visible ? <Eye /> : <EyeOff />}
          </Button>
          <Button
            aria-label={node.locked ? "Unlock layer" : "Lock layer"}
            size="icon-xs"
            variant="ghost"
            className="shrink-0"
            disabled={imageCropBarOwnsTransforms}
            onClick={() => onUpdate({ locked: !node.locked })}
          >
            {node.locked ? <Lock /> : <Unlock />}
          </Button>
        </div>
        {node.locked ? (
          <EditorPanelNotice
            icon={<Lock />}
            description="This layer is locked. Visibility and unlock remain available; its content and properties cannot be changed."
            role="status"
          />
        ) : null}
      </section>

      {inspector.capabilities.text && node.type === "text" ? (
        <InspectorSection
          title="Content"
          data-inspector-property="text"
          tabIndex={-1}
          className={cn(
            "scroll-mt-2",
            focusedProperty === "text" &&
              "bg-accent/70 ring-2 ring-ring ring-inset"
          )}
        >
          <CommitTextarea
            key={node.id}
            aria-label="Text content"
            rows={1}
            className="h-8 min-h-8 resize-none overflow-y-auto focus:h-20 focus:min-h-20 focus:resize-y"
            value={node.text}
            disabled={nodeMutationDisabled}
            onPreview={(text) => onPreview({ text })}
            onPreviewCancel={onCancelPreview}
            onCommit={(text) => onUpdate({ text })}
          />
        </InspectorSection>
      ) : null}

      <InspectorSection title="Position">
        <AlignmentGrid
          onAlign={onAlignToPage}
          disabled={nodeMutationDisabled}
        />
        <div className="grid grid-cols-2 gap-2">
          <InspectorNumberField
            label="X"
            compactLabel="X"
            value={inspector.values.x}
            disabled={node.locked}
            onPreview={(x) => onPreview({ x })}
            onPreviewCancel={onCancelPreview}
            onCommit={(x) => commitFrameGeometry({ x })}
          />
          <InspectorNumberField
            label="Y"
            compactLabel="Y"
            value={inspector.values.y}
            disabled={node.locked}
            onPreview={(y) => onPreview({ y })}
            onPreviewCancel={onCancelPreview}
            onCommit={(y) => commitFrameGeometry({ y })}
          />
          <InspectorNumberField
            label="Width"
            compactLabel="W"
            value={inspector.values.width}
            min={1}
            disabled={node.locked || textWidthIsManaged}
            onPreview={(width) => onPreview({ width })}
            onPreviewCancel={onCancelPreview}
            onCommit={(width) => commitFrameGeometry({ width })}
          />
          <InspectorNumberField
            label="Height"
            compactLabel="H"
            value={inspector.values.height}
            min={1}
            disabled={node.locked || textHeightIsManaged}
            onPreview={(height) => onPreview({ height })}
            onPreviewCancel={onCancelPreview}
            onCommit={(height) => commitFrameGeometry({ height })}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <InspectorNumberField
            label="Rotation"
            compactLabel="°"
            value={inspector.values.rotation}
            disabled={node.locked}
            onPreview={(rotation) => onPreview({ rotation })}
            onPreviewCancel={onCancelPreview}
            onCommit={(rotation) => commitFrameGeometry({ rotation })}
          />
          <PositionTransformControls
            disabled={nodeMutationDisabled}
            flipX={node.flipX ?? false}
            flipY={node.flipY ?? false}
            onTransform={(action) =>
              onUpdate(positionTransformPatch(node, action))
            }
          />
        </div>
      </InspectorSection>

      <InspectorSection
        title="Constraints"
        data-inspector-property="constraints"
      >
        <div className="grid grid-cols-2 gap-2">
          <ConstraintAxisControl
            axis="horizontal"
            value={node.constraints.horizontal}
            disabled={nodeMutationDisabled}
            onChange={(horizontal) =>
              onUpdate({
                constraints: { ...node.constraints, horizontal },
              })
            }
          />
          <ConstraintAxisControl
            axis="vertical"
            value={node.constraints.vertical}
            disabled={nodeMutationDisabled}
            onChange={(vertical) =>
              onUpdate({ constraints: { ...node.constraints, vertical } })
            }
          />
        </div>
        <p className="text-[11px] leading-4 text-muted-foreground">
          Controls how this layer responds when its page is resized.
        </p>
      </InspectorSection>

      {owningFrame && frameChildLayout ? (
        <InspectorSection
          title="Frame child"
          data-inspector-property="frameChildLayout"
        >
          <p className="text-[11px] text-muted-foreground">
            Layout inside {owningFrame.name}
          </p>
          <div className="grid grid-cols-3 gap-1">
            <Select
              value={frameChildLayout.positioning}
              disabled={nodeMutationDisabled}
              onValueChange={(positioning) =>
                updateFrameChildLayout({
                  positioning: positioning as "auto" | "absolute",
                })
              }
            >
              <SelectTrigger
                aria-label="Frame child positioning"
                className="h-8 text-[11px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto</SelectItem>
                <SelectItem value="absolute">Absolute</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={frameChildLayout.horizontalSizing}
              disabled={nodeMutationDisabled}
              onValueChange={(horizontalSizing) =>
                updateFrameChildLayout({
                  horizontalSizing: horizontalSizing as "fixed" | "fill",
                })
              }
            >
              <SelectTrigger
                aria-label="Frame child horizontal sizing"
                className="h-8 text-[11px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">Width: fixed</SelectItem>
                <SelectItem value="fill">Width: fill</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={frameChildLayout.verticalSizing}
              disabled={nodeMutationDisabled}
              onValueChange={(verticalSizing) =>
                updateFrameChildLayout({
                  verticalSizing: verticalSizing as "fixed" | "fill",
                })
              }
            >
              <SelectTrigger
                aria-label="Frame child vertical sizing"
                className="h-8 text-[11px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">Height: fixed</SelectItem>
                <SelectItem value="fill">Height: fill</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {frameChildLayout.positioning === "absolute" ? (
            <div className="grid grid-cols-2 gap-2">
              <InspectorNumberField
                label="Frame offset X"
                compactLabel="X"
                value={{ kind: "value", value: frameChildLayout.offsetX }}
                disabled={nodeMutationDisabled}
                onCommit={(offsetX) => updateFrameChildLayout({ offsetX })}
              />
              <InspectorNumberField
                label="Frame offset Y"
                compactLabel="Y"
                value={{ kind: "value", value: frameChildLayout.offsetY }}
                disabled={nodeMutationDisabled}
                onCommit={(offsetY) => updateFrameChildLayout({ offsetY })}
              />
            </div>
          ) : (
            <InspectorNumberField
              label="Frame child grow"
              compactLabel="Grow"
              min={0}
              value={{ kind: "value", value: frameChildLayout.grow }}
              disabled={nodeMutationDisabled}
              onCommit={(grow) => updateFrameChildLayout({ grow })}
            />
          )}
        </InspectorSection>
      ) : null}

      {node.type === "frame" ? (
        <InspectorSection
          title="Auto layout"
          data-inspector-property="autoLayout"
        >
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={node.autoLayout?.direction ?? "none"}
              disabled={nodeMutationDisabled}
              onValueChange={(direction) =>
                onUpdate({
                  autoLayout:
                    direction === "none"
                      ? null
                      : node.autoLayout
                        ? {
                            ...node.autoLayout,
                            direction: direction as "horizontal" | "vertical",
                          }
                        : {
                            direction: direction as "horizontal" | "vertical",
                            horizontalSizing: "fixed",
                            verticalSizing: "fixed",
                            gap: 0,
                            padding: { top: 0, right: 0, bottom: 0, left: 0 },
                            primaryAlign: "start",
                            counterAlign: "start",
                          },
                })
              }
            >
              <SelectTrigger
                aria-label="Frame layout direction"
                className="h-8 text-[11px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Freeform</SelectItem>
                <SelectItem value="horizontal">Horizontal</SelectItem>
                <SelectItem value="vertical">Vertical</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant={node.clipsContent ? "secondary" : "outline"}
              className="h-8 text-[11px]"
              disabled={nodeMutationDisabled}
              aria-pressed={node.clipsContent}
              onClick={() => onUpdate({ clipsContent: !node.clipsContent })}
            >
              Clip content
            </Button>
          </div>
          {node.autoLayout ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Select
                  value={node.autoLayout.horizontalSizing}
                  disabled={nodeMutationDisabled}
                  onValueChange={(horizontalSizing) =>
                    onUpdate({
                      autoLayout: {
                        ...node.autoLayout!,
                        horizontalSizing: horizontalSizing as "fixed" | "hug",
                      },
                    })
                  }
                >
                  <SelectTrigger
                    aria-label="Frame horizontal sizing"
                    className="h-8 text-[11px]"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">Width: fixed</SelectItem>
                    <SelectItem value="hug">Width: hug</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={node.autoLayout.verticalSizing}
                  disabled={nodeMutationDisabled}
                  onValueChange={(verticalSizing) =>
                    onUpdate({
                      autoLayout: {
                        ...node.autoLayout!,
                        verticalSizing: verticalSizing as "fixed" | "hug",
                      },
                    })
                  }
                >
                  <SelectTrigger
                    aria-label="Frame vertical sizing"
                    className="h-8 text-[11px]"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">Height: fixed</SelectItem>
                    <SelectItem value="hug">Height: hug</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Select
                  value={node.autoLayout.primaryAlign}
                  disabled={nodeMutationDisabled}
                  onValueChange={(primaryAlign) =>
                    onUpdate({
                      autoLayout: {
                        ...node.autoLayout!,
                        primaryAlign:
                          primaryAlign as typeof node.autoLayout.primaryAlign,
                      },
                    })
                  }
                >
                  <SelectTrigger
                    aria-label="Frame primary alignment"
                    className="h-8 text-[11px]"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="start">Pack: start</SelectItem>
                    <SelectItem value="center">Pack: center</SelectItem>
                    <SelectItem value="end">Pack: end</SelectItem>
                    <SelectItem value="space_between">Space between</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={node.autoLayout.counterAlign}
                  disabled={nodeMutationDisabled}
                  onValueChange={(counterAlign) =>
                    onUpdate({
                      autoLayout: {
                        ...node.autoLayout!,
                        counterAlign:
                          counterAlign as typeof node.autoLayout.counterAlign,
                      },
                    })
                  }
                >
                  <SelectTrigger
                    aria-label="Frame counter alignment"
                    className="h-8 text-[11px]"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="start">Align: start</SelectItem>
                    <SelectItem value="center">Align: center</SelectItem>
                    <SelectItem value="end">Align: end</SelectItem>
                    <SelectItem value="stretch">Stretch</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <InspectorNumberField
                  label="Gap"
                  compactLabel="Gap"
                  min={0}
                  value={{ kind: "value", value: node.autoLayout.gap }}
                  disabled={nodeMutationDisabled}
                  onCommit={(gap) =>
                    onUpdate({ autoLayout: { ...node.autoLayout!, gap } })
                  }
                />
                <p className="self-center text-[11px] text-muted-foreground">
                  {node.children.length} child
                  {node.children.length === 1 ? "" : "ren"}
                </p>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {(["top", "right", "bottom", "left"] as const).map((side) => (
                  <InspectorNumberField
                    key={side}
                    label={`Padding ${side}`}
                    compactLabel={side[0]!.toUpperCase()}
                    min={0}
                    value={{
                      kind: "value",
                      value: node.autoLayout!.padding[side],
                    }}
                    disabled={nodeMutationDisabled}
                    onCommit={(value) =>
                      onUpdate({
                        autoLayout: {
                          ...node.autoLayout!,
                          padding: {
                            ...node.autoLayout!.padding,
                            [side]: value,
                          },
                        },
                      })
                    }
                  />
                ))}
              </div>
            </div>
          ) : null}
        </InspectorSection>
      ) : null}

      {node.type === "frame" ? (
        <InspectorSection
          title="Layout guides"
          data-inspector-property="layoutGrids"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] leading-4 text-muted-foreground">
              Editor-only columns, rows, and square grids.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={
                nodeMutationDisabled || (node.layoutGrids ?? []).length >= 8
              }
              onClick={() =>
                onUpdate({
                  layoutGrids: [
                    ...(node.layoutGrids ?? []),
                    {
                      id: `grid-${node.id}-${Date.now()}`,
                      pattern: "columns",
                      visible: true,
                      color: "#2563eb",
                      opacity: 0.12,
                      alignment: "stretch",
                      count: 12,
                      offset: 24,
                      sectionSize: 1,
                      gutter: 16,
                    },
                  ],
                })
              }
            >
              <Plus data-icon="inline-start" />
              Add
            </Button>
          </div>
          {(node.layoutGrids ?? []).length === 0 ? (
            <p className="rounded-md border border-dashed px-2 py-3 text-center text-[11px] text-muted-foreground">
              No layout guides on this frame.
            </p>
          ) : null}
          {(node.layoutGrids ?? []).map((grid, gridIndex) => {
            const replaceGrid = (
              next: NonNullable<typeof node.layoutGrids>[number]
            ) =>
              onUpdate({
                layoutGrids: (node.layoutGrids ?? []).map((candidate, index) =>
                  index === gridIndex ? next : candidate
                ),
              })
            return (
              <div
                key={grid.id}
                className="space-y-2 rounded-md border p-2"
                data-layout-grid-inspector-id={grid.id}
              >
                <div className="flex items-center gap-1.5">
                  <Select
                    value={grid.pattern}
                    disabled={nodeMutationDisabled}
                    onValueChange={(pattern) =>
                      replaceGrid(
                        pattern === "grid"
                          ? {
                              id: grid.id,
                              pattern: "grid",
                              visible: grid.visible,
                              color: grid.color,
                              opacity: grid.opacity,
                              offset: grid.offset,
                              size: 8,
                            }
                          : {
                              id: grid.id,
                              pattern: pattern as "columns" | "rows",
                              visible: grid.visible,
                              color: grid.color,
                              opacity: grid.opacity,
                              alignment: "stretch",
                              count: 12,
                              offset: grid.offset,
                              sectionSize: 1,
                              gutter: 16,
                            }
                      )
                    }
                  >
                    <SelectTrigger
                      aria-label={`Layout guide ${gridIndex + 1} pattern`}
                      className="h-8 min-w-0 flex-1 text-[11px]"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="columns">Columns</SelectItem>
                      <SelectItem value="rows">Rows</SelectItem>
                      <SelectItem value="grid">Square grid</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    disabled={nodeMutationDisabled}
                    aria-label={
                      grid.visible ? "Hide layout guide" : "Show layout guide"
                    }
                    onClick={() =>
                      replaceGrid({ ...grid, visible: !grid.visible })
                    }
                  >
                    {grid.visible ? <Eye /> : <EyeOff />}
                  </Button>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    disabled={nodeMutationDisabled}
                    aria-label="Remove layout guide"
                    onClick={() =>
                      onUpdate({
                        layoutGrids: (node.layoutGrids ?? []).filter(
                          (_, index) => index !== gridIndex
                        ),
                      })
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {grid.pattern === "grid" ? (
                    <InspectorNumberField
                      label="Grid size"
                      compactLabel="Size"
                      min={0.1}
                      value={inspectorValue(grid.size)}
                      disabled={nodeMutationDisabled}
                      onCommit={(size) => replaceGrid({ ...grid, size })}
                    />
                  ) : (
                    <>
                      <InspectorNumberField
                        label="Section count"
                        compactLabel="Count"
                        min={1}
                        max={64}
                        integer
                        value={inspectorValue(grid.count)}
                        disabled={nodeMutationDisabled}
                        onCommit={(count) => replaceGrid({ ...grid, count })}
                      />
                      <InspectorNumberField
                        label="Gutter"
                        compactLabel="Gutter"
                        min={0}
                        value={inspectorValue(grid.gutter)}
                        disabled={nodeMutationDisabled}
                        onCommit={(gutter) => replaceGrid({ ...grid, gutter })}
                      />
                      <Select
                        value={grid.alignment}
                        disabled={nodeMutationDisabled}
                        onValueChange={(alignment) =>
                          replaceGrid({
                            ...grid,
                            alignment: alignment as typeof grid.alignment,
                          })
                        }
                      >
                        <SelectTrigger
                          aria-label="Layout guide alignment"
                          className="h-8 text-[11px]"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="min">Start</SelectItem>
                          <SelectItem value="center">Center</SelectItem>
                          <SelectItem value="max">End</SelectItem>
                          <SelectItem value="stretch">Stretch</SelectItem>
                        </SelectContent>
                      </Select>
                      {grid.alignment !== "stretch" ? (
                        <InspectorNumberField
                          label="Section size"
                          compactLabel="Size"
                          min={0.1}
                          value={inspectorValue(grid.sectionSize)}
                          disabled={nodeMutationDisabled}
                          onCommit={(sectionSize) =>
                            replaceGrid({ ...grid, sectionSize })
                          }
                        />
                      ) : null}
                    </>
                  )}
                  <InspectorNumberField
                    label="Guide offset"
                    compactLabel="Offset"
                    min={0}
                    value={inspectorValue(grid.offset)}
                    disabled={nodeMutationDisabled}
                    onCommit={(offset) => replaceGrid({ ...grid, offset })}
                  />
                  <InspectorNumberField
                    label="Guide opacity"
                    compactLabel="Opacity"
                    min={0}
                    max={100}
                    suffix="%"
                    value={inspectorValue(grid.opacity * 100)}
                    disabled={nodeMutationDisabled}
                    onCommit={(opacity) =>
                      replaceGrid({ ...grid, opacity: opacity / 100 })
                    }
                  />
                </div>
                <InspectorColorField
                  label="Guide color"
                  value={grid.color}
                  disabled={nodeMutationDisabled}
                  onCommit={(color) => replaceGrid({ ...grid, color })}
                />
              </div>
            )
          })}
        </InspectorSection>
      ) : null}

      <InspectorSection title="Opacity">
        <CommitPercentSlider
          label="Opacity"
          value={node.opacity * 100}
          disabled={nodeMutationDisabled}
          onCommit={(opacity) => onUpdate({ opacity: opacity / 100 })}
        />
        <Select
          value={node.blendMode ?? "normal"}
          disabled={nodeMutationDisabled}
          onValueChange={(blendMode) =>
            onUpdate({ blendMode: blendMode as BlendMode })
          }
        >
          <SelectTrigger aria-label="Blend mode" className="h-8 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {BLEND_MODE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </InspectorSection>

      {inspector.capabilities.text && node.type === "text" ? (
        <>
          <InspectorSection title="Typography">
            {typographyStyleControl}
            {paintStyleControl}
            {liveTextEditingState ? (
              <TextSelectionInspector
                state={liveTextEditingState}
                disabled={node.locked}
                onApply={onApplyTextEditingStyle}
                onEditLink={onEditTextLink}
              />
            ) : null}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <FieldLabel>Text box</FieldLabel>
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                    {node.sizingMode === "auto_width"
                      ? "Width and height follow the content."
                      : node.sizingMode === "auto_height"
                        ? "Text wraps at the set width; height grows to fit."
                        : "Width and height stay fixed."}
                  </p>
                </div>
              </div>
              <ToggleGroup
                aria-label="Text box resizing"
                className="grid w-full grid-cols-3"
                type="single"
                size="sm"
                spacing={0}
                variant="outline"
                value={node.sizingMode}
                disabled={node.locked}
                onValueChange={(sizingMode) =>
                  sizingMode &&
                  onUpdate({
                    sizingMode: sizingMode as typeof node.sizingMode,
                  })
                }
              >
                <ToggleGroupItem
                  aria-label="Auto width"
                  className="min-h-11 px-2 text-[11px] min-[1280px]:min-h-0"
                  value="auto_width"
                >
                  Auto width
                </ToggleGroupItem>
                <ToggleGroupItem
                  aria-label="Auto height"
                  className="min-h-11 px-2 text-[11px] min-[1280px]:min-h-0"
                  value="auto_height"
                >
                  Auto height
                </ToggleGroupItem>
                <ToggleGroupItem
                  aria-label="Fixed text box"
                  className="min-h-11 px-2 text-[11px] min-[1280px]:min-h-0"
                  value="fixed"
                >
                  Fixed
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            {textLayout?.overflow ? (
              <div
                className="rounded-lg border border-amber-500/35 bg-amber-500/8 p-3"
                data-overflow-x={textLayout.overflowX ? "true" : "false"}
                data-overflow-y={textLayout.overflowY ? "true" : "false"}
                role="status"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-700 dark:text-amber-400" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium">
                      {textLayout.overflowX && textLayout.overflowY
                        ? "Text is clipped horizontally and vertically"
                        : textLayout.overflowX
                          ? "Text is clipped horizontally"
                          : "Text is clipped vertically"}
                    </p>
                    <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                      {textLayout.overflowX
                        ? "The fixed box is too narrow for its content. Let the box follow the text dimensions."
                        : "The fixed box is too short for its content. Let the height grow so every line remains visible."}
                    </p>
                    <Button
                      className="mt-2 min-h-11 px-2 text-[11px] min-[1280px]:min-h-7"
                      size="sm"
                      variant="outline"
                      disabled={node.locked}
                      onClick={() => onUpdate(repairTextOverflowPatch(node))}
                    >
                      {textLayout.overflowX
                        ? "Resize box to fit"
                        : "Resize height to fit"}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
            <label className="space-y-1.5">
              {liveTextEditingState ? (
                <span className="mb-2 block border-t pt-3">
                  <span className="block text-[11px] font-semibold">
                    Layer defaults
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                    Used where this layer has no character-level override.
                  </span>
                </span>
              ) : null}
              <FieldLabel>Font family</FieldLabel>
              <Select
                value={node.fontFamily}
                disabled={node.locked}
                onValueChange={(fontFamily) => {
                  if (isManagedRendererFont(fontFamily)) {
                    onUpdate({ fontFamily })
                  }
                }}
              >
                <SelectTrigger className="min-h-11 min-[1280px]:min-h-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {managedRendererFonts.map((fontFamily) => (
                      <SelectItem key={fontFamily} value={fontFamily}>
                        {fontFamily}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <InspectorNumberField
                label="Font size"
                value={inspectorValue(node.fontSize)}
                min={0.1}
                disabled={node.locked}
                onPreview={(fontSize) => onPreview({ fontSize })}
                onPreviewCancel={onCancelPreview}
                onCommit={(fontSize) => onUpdate({ fontSize })}
              />
              <InspectorNumberField
                label="Weight"
                value={inspectorValue(node.fontWeight)}
                min={100}
                max={900}
                integer
                step={10}
                disabled={node.locked}
                onPreview={(fontWeight) => onPreview({ fontWeight })}
                onPreviewCancel={onCancelPreview}
                onCommit={(fontWeight) => onUpdate({ fontWeight })}
              />
              <InspectorNumberField
                label="Line height"
                value={inspectorValue(node.lineHeight)}
                min={0.5}
                max={3}
                step={0.01}
                disabled={node.locked}
                onPreview={(lineHeight) => onPreview({ lineHeight })}
                onPreviewCancel={onCancelPreview}
                onCommit={(lineHeight) => onUpdate({ lineHeight })}
              />
              <InspectorNumberField
                label="Letter spacing"
                value={inspectorValue(node.letterSpacing)}
                min={-20}
                max={200}
                step={0.1}
                disabled={node.locked}
                onPreview={(letterSpacing) => onPreview({ letterSpacing })}
                onPreviewCancel={onCancelPreview}
                onCommit={(letterSpacing) => onUpdate({ letterSpacing })}
              />
            </div>
            <InspectorColorField
              label="Text color"
              value={node.color}
              disabled={nodeMutationDisabled}
              onPreview={(color) => onPreview({ color })}
              onPreviewCancel={onCancelPreview}
              onCommit={(color) => onUpdate({ color })}
            />
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <FieldLabel>Alignment</FieldLabel>
                <ToggleGroup
                  aria-label="Paragraph alignment"
                  className="shrink-0 bg-muted/55 p-0.5"
                  type="single"
                  size="sm"
                  spacing={0}
                  value={
                    paragraphAlign === "left" ||
                    paragraphAlign === "center" ||
                    paragraphAlign === "right" ||
                    paragraphAlign === "justify"
                      ? paragraphAlign
                      : ""
                  }
                  disabled={node.locked}
                >
                  {[
                    ["left", AlignLeft],
                    ["center", AlignCenter],
                    ["right", AlignRight],
                    ["justify", TextAlignJustify],
                  ].map(([align, Icon]) => (
                    <ToggleGroupItem
                      key={align as string}
                      aria-label={`Align text ${align as string}`}
                      className="min-h-11 min-w-11 border-0 min-[1280px]:min-h-6 min-[1280px]:min-w-7"
                      value={align as string}
                      onClick={() => {
                        const nextAlign = align as
                          "left" | "center" | "right" | "justify"
                        if (liveTextEditingState) {
                          onApplyTextEditingParagraphStyle({ align: nextAlign })
                          return
                        }
                        onUpdate({
                          align: nextAlign,
                          paragraphs: applyTextParagraphStyleToRange(
                            node.text,
                            node.paragraphs,
                            { anchor: 0, focus: node.text.length },
                            { align: nextAlign },
                            nextAlign
                          ),
                        })
                      }}
                    >
                      <Icon />
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1.5">
                  <FieldLabel>Direction</FieldLabel>
                  <Select
                    value={node.direction ?? "auto"}
                    disabled={node.locked}
                    onValueChange={(direction) =>
                      onUpdate({
                        direction: direction as "auto" | "ltr" | "rtl",
                      })
                    }
                  >
                    <SelectTrigger aria-label="Text direction">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto</SelectItem>
                      <SelectItem value="ltr">Left to right</SelectItem>
                      <SelectItem value="rtl">Right to left</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <label className="space-y-1.5">
                  <FieldLabel>Vertical align</FieldLabel>
                  <Select
                    value={node.verticalAlign ?? "top"}
                    disabled={node.locked}
                    onValueChange={(verticalAlign) =>
                      onUpdate({
                        verticalAlign: verticalAlign as
                          "top" | "middle" | "bottom",
                      })
                    }
                  >
                    <SelectTrigger aria-label="Text vertical alignment">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="top">Top</SelectItem>
                      <SelectItem value="middle">Middle</SelectItem>
                      <SelectItem value="bottom">Bottom</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <label className="space-y-1.5">
                  <FieldLabel>Case</FieldLabel>
                  <Select
                    value={node.textCase ?? "original"}
                    disabled={node.locked}
                    onValueChange={(textCase) =>
                      onUpdate({
                        textCase: textCase as
                          "original" | "uppercase" | "lowercase" | "title",
                      })
                    }
                  >
                    <SelectTrigger aria-label="Text case">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="original">Original</SelectItem>
                      <SelectItem value="uppercase">Uppercase</SelectItem>
                      <SelectItem value="lowercase">Lowercase</SelectItem>
                      <SelectItem value="title">Title case</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <label className="space-y-1.5">
                  <FieldLabel>Overflow</FieldLabel>
                  <Select
                    value={node.truncation ?? "clip"}
                    disabled={node.locked}
                    onValueChange={(truncation) =>
                      onUpdate({
                        truncation: truncation as "clip" | "ellipsis",
                      })
                    }
                  >
                    <SelectTrigger aria-label="Text truncation">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="clip">Clip</SelectItem>
                      <SelectItem value="ellipsis">Ellipsis</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              </div>
              <div className="space-y-2 rounded-md border p-2">
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox
                    aria-label="Limit text lines"
                    checked={node.maxLines != null}
                    disabled={node.locked}
                    onCheckedChange={(checked) =>
                      onUpdate({ maxLines: checked === true ? 3 : null })
                    }
                  />
                  Limit lines
                </label>
                {node.maxLines != null ? (
                  <InspectorNumberField
                    label="Maximum lines"
                    value={inspectorValue(node.maxLines)}
                    min={1}
                    max={100}
                    integer
                    disabled={node.locked}
                    onPreview={(maxLines) => onPreview({ maxLines })}
                    onPreviewCancel={onCancelPreview}
                    onCommit={(maxLines) => onUpdate({ maxLines })}
                  />
                ) : null}
              </div>
              <div className="flex items-center justify-between gap-3">
                <FieldLabel>List</FieldLabel>
                <ToggleGroup
                  aria-label="Paragraph list style"
                  className="shrink-0 bg-muted/55 p-0.5"
                  type="single"
                  size="sm"
                  spacing={0}
                  variant="outline"
                  value={
                    textListStyle === "bulleted" || textListStyle === "numbered"
                      ? textListStyle
                      : ""
                  }
                  disabled={node.locked}
                  onValueChange={(value) => {
                    const style =
                      value === "bulleted" || value === "numbered"
                        ? value
                        : "none"
                    if (legacyTextListStyle !== "none") {
                      const text = applyStudioTextListStyle(node.text, style)
                      if (text !== node.text) onUpdate({ text })
                      return
                    }
                    const list =
                      style === "none"
                        ? null
                        : style === "bulleted"
                          ? { kind: "bulleted" as const, level: 0 }
                          : {
                              kind: "numbered" as const,
                              level: 0,
                              start: 1,
                            }
                    if (liveTextEditingState) {
                      onApplyTextEditingParagraphStyle({ list })
                      return
                    }
                    onUpdate({
                      paragraphs: applyTextParagraphStyleToRange(
                        node.text,
                        node.paragraphs,
                        { anchor: 0, focus: node.text.length },
                        { list },
                        node.align
                      ),
                    })
                  }}
                >
                  <ToggleGroupItem
                    aria-label="Bulleted list"
                    className="min-h-11 min-w-11 border-0 min-[1280px]:min-h-6 min-[1280px]:min-w-7"
                    value="bulleted"
                  >
                    <List />
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    aria-label="Numbered list"
                    className="min-h-11 min-w-11 border-0 min-[1280px]:min-h-6 min-[1280px]:min-w-7"
                    value="numbered"
                  >
                    <ListOrdered />
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
              <p className="text-[11px] leading-4 text-muted-foreground">
                {liveTextEditingState
                  ? "Applies to the selected paragraph. Use Tab to indent."
                  : "Applies to every paragraph in this layer."}
              </p>
            </div>
          </InspectorSection>
        </>
      ) : null}

      {inspector.capabilities.cornerRadius &&
      (node.type === "rect" || node.type === "frame") ? (
        <InspectorSection
          title="Appearance"
          data-inspector-property="fill"
          tabIndex={-1}
          className={cn(
            "scroll-mt-2",
            focusedProperty === "fill" &&
              "bg-accent/70 ring-2 ring-ring ring-inset"
          )}
        >
          {paintStyleControl}
          <PaintStackControls node={node} onUpdate={onUpdate} />
          <InspectorNumberField
            label="Corner radius"
            value={inspectorValue(node.radius)}
            min={0}
            disabled={node.locked}
            onPreview={(radius) => onPreview({ radius })}
            onPreviewCancel={onCancelPreview}
            onCommit={(radius) => onUpdate({ radius })}
          />
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Checkbox
              aria-label="Independent corners"
              checked={node.independentCorners ?? false}
              disabled={node.locked}
              onCheckedChange={(checked) =>
                checked === true
                  ? onUpdate({
                      independentCorners: true,
                      cornerRadii: node.cornerRadii ?? {
                        topLeft: node.radius,
                        topRight: node.radius,
                        bottomRight: node.radius,
                        bottomLeft: node.radius,
                      },
                    })
                  : onUpdate({
                      independentCorners: false,
                      radius: node.cornerRadii?.topLeft ?? node.radius,
                    })
              }
            />
            Independent corners
          </label>
          {node.independentCorners ? (
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["Top left", "topLeft"],
                  ["Top right", "topRight"],
                  ["Bottom left", "bottomLeft"],
                  ["Bottom right", "bottomRight"],
                ] as const
              ).map(([label, property]) => (
                <InspectorNumberField
                  key={property}
                  label={label}
                  value={inspectorValue(
                    node.cornerRadii?.[property] ?? node.radius
                  )}
                  min={0}
                  disabled={node.locked}
                  onPreview={(value) =>
                    onPreview({
                      cornerRadii: {
                        topLeft: node.cornerRadii?.topLeft ?? node.radius,
                        topRight: node.cornerRadii?.topRight ?? node.radius,
                        bottomRight:
                          node.cornerRadii?.bottomRight ?? node.radius,
                        bottomLeft: node.cornerRadii?.bottomLeft ?? node.radius,
                        [property]: value,
                      },
                    })
                  }
                  onPreviewCancel={onCancelPreview}
                  onCommit={(value) =>
                    onUpdate({
                      cornerRadii: {
                        topLeft: node.cornerRadii?.topLeft ?? node.radius,
                        topRight: node.cornerRadii?.topRight ?? node.radius,
                        bottomRight:
                          node.cornerRadii?.bottomRight ?? node.radius,
                        bottomLeft: node.cornerRadii?.bottomLeft ?? node.radius,
                        [property]: value,
                      },
                    })
                  }
                />
              ))}
            </div>
          ) : null}
          <CommitPercentSlider
            label="Corner smoothing"
            value={(node.cornerSmoothing ?? 0) * 100}
            disabled={node.locked}
            onCommit={(cornerSmoothing) =>
              onUpdate({ cornerSmoothing: cornerSmoothing / 100 })
            }
          />
        </InspectorSection>
      ) : null}

      {inspector.capabilities.fill &&
      (node.type === "ellipse" || node.type === "icon") ? (
        <InspectorSection
          title="Appearance"
          data-inspector-property="fill"
          tabIndex={-1}
          className={cn(
            "scroll-mt-2",
            focusedProperty === "fill" &&
              "bg-accent/70 ring-2 ring-ring ring-inset"
          )}
        >
          {paintStyleControl}
          <PaintStackControls node={node} onUpdate={onUpdate} />
        </InspectorSection>
      ) : null}

      {inspector.capabilities.stroke && node.type === "line" ? (
        <InspectorSection title="Appearance">
          {paintStyleControl}
          <PaintStackControls node={node} onUpdate={onUpdate} />
        </InspectorSection>
      ) : null}

      <InspectorSection title="Effects">
        <EffectStackControls node={node} onUpdate={onUpdate} />
      </InspectorSection>

      <InspectorSection title="Export">
        <LayerExportControls node={node} onUpdate={onUpdate} />
      </InspectorSection>

      {inspector.capabilities.image && node.type === "image" ? (
        <InspectorSection
          title="Image"
          data-inspector-property="src"
          tabIndex={-1}
          className={cn(
            "scroll-mt-2",
            focusedProperty === "src" &&
              "bg-accent/70 ring-2 ring-ring ring-inset"
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <FieldLabel>Image placement</FieldLabel>
            <ToggleGroup
              type="single"
              size="sm"
              spacing={0}
              variant="outline"
              value={node.placement.mode}
              disabled={imageTransformDisabled}
              onValueChange={(mode) => {
                if (mode === "fill") onRunImageCommand("image.fill")
                if (mode === "fit") onRunImageCommand("image.fit")
              }}
            >
              <ToggleGroupItem
                value="fill"
                disabled={!isImageCommandEnabled("image.fill")}
              >
                Fill
              </ToggleGroupItem>
              <ToggleGroupItem
                value="fit"
                disabled={!isImageCommandEnabled("image.fit")}
              >
                Fit
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <CommitPercentSlider
            label="Horizontal focus"
            value={node.placement.focalX * 100}
            disabled={imageTransformDisabled}
            onCommit={(focalX) =>
              onSetImagePlacement(node.id, {
                ...node.placement,
                focalX: focalX / 100,
              })
            }
          />
          <CommitPercentSlider
            label="Vertical focus"
            value={node.placement.focalY * 100}
            disabled={imageTransformDisabled}
            onCommit={(focalY) =>
              onSetImagePlacement(node.id, {
                ...node.placement,
                focalY: focalY / 100,
              })
            }
          />
          <div className="grid grid-cols-2 gap-2">
            <InspectorNumberField
              label="Image zoom"
              value={inspectorValue(node.placement.zoom * 100)}
              min={5}
              max={6400}
              suffix="%"
              disabled={imageTransformDisabled}
              onCommit={(zoom) =>
                onSetImagePlacement(node.id, {
                  ...node.placement,
                  mode:
                    node.placement.mode === "fill"
                      ? "manual"
                      : node.placement.mode,
                  zoom: zoom / 100,
                })
              }
            />
            <InspectorNumberField
              label="Image rotation"
              value={inspectorValue(node.placement.rotation)}
              min={-180}
              max={180}
              suffix="°"
              disabled={imageTransformDisabled}
              onCommit={(rotation) =>
                onSetImagePlacement(node.id, {
                  ...node.placement,
                  rotation,
                })
              }
            />
          </div>
          <div className="space-y-2 border-t pt-3">
            <ToggleGroup
              aria-label="Image frame shape"
              className="grid w-full grid-cols-3"
              type="single"
              size="sm"
              spacing={0}
              variant="outline"
              value={node.frameMask.shape}
              disabled={imageFrameDisabled}
              onValueChange={(type) => {
                const commandByShape: Partial<
                  Record<string, EditorImageFrameCommandId>
                > = {
                  rectangle: "image.frame.rectangle",
                  rounded_rectangle: "image.frame.rounded-rectangle",
                  ellipse: "image.frame.ellipse",
                }
                const commandId = commandByShape[type]
                if (commandId) onRunImageCommand(commandId)
              }}
            >
              <ToggleGroupItem
                value="rectangle"
                disabled={!isImageCommandEnabled("image.frame.rectangle")}
              >
                Rectangle
              </ToggleGroupItem>
              <ToggleGroupItem
                value="rounded_rectangle"
                disabled={
                  !isImageCommandEnabled("image.frame.rounded-rectangle")
                }
              >
                Rounded
              </ToggleGroupItem>
              <ToggleGroupItem
                value="ellipse"
                disabled={!isImageCommandEnabled("image.frame.ellipse")}
              >
                Ellipse
              </ToggleGroupItem>
            </ToggleGroup>
            {node.frameMask.shape === "rounded_rectangle"
              ? (() => {
                  const roundedMask = node.frameMask
                  return (
                    <div className="space-y-2">
                      <CommitPercentSlider
                        label="Corner radius"
                        value={roundedMask.radius * 200}
                        disabled={imageFrameDisabled}
                        onCommit={(radius) =>
                          onSetImageFrameMask(node.id, {
                            ...roundedMask,
                            radius: radius / 200,
                          })
                        }
                      />
                      <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <Checkbox
                          aria-label="Independent image corners"
                          checked={roundedMask.cornerRadii !== undefined}
                          disabled={imageFrameDisabled}
                          onCheckedChange={(checked) =>
                            onSetImageFrameMask(
                              node.id,
                              checked === true
                                ? {
                                    ...roundedMask,
                                    cornerRadii: {
                                      topLeft: roundedMask.radius,
                                      topRight: roundedMask.radius,
                                      bottomRight: roundedMask.radius,
                                      bottomLeft: roundedMask.radius,
                                    },
                                  }
                                : {
                                    shape: "rounded_rectangle",
                                    radius: roundedMask.radius,
                                    ...(roundedMask.cornerSmoothing !==
                                    undefined
                                      ? {
                                          cornerSmoothing:
                                            roundedMask.cornerSmoothing,
                                        }
                                      : {}),
                                  }
                            )
                          }
                        />
                        Independent corners
                      </label>
                      {roundedMask.cornerRadii
                        ? (() => {
                            const independentRadii = roundedMask.cornerRadii
                            return (
                              <div className="grid grid-cols-2 gap-2">
                                {(
                                  [
                                    ["Top left", "topLeft"],
                                    ["Top right", "topRight"],
                                    ["Bottom left", "bottomLeft"],
                                    ["Bottom right", "bottomRight"],
                                  ] as const
                                ).map(([label, property]) => (
                                  <InspectorNumberField
                                    key={property}
                                    label={label}
                                    value={inspectorValue(
                                      independentRadii[property] * 200
                                    )}
                                    min={0}
                                    max={100}
                                    disabled={imageFrameDisabled}
                                    onCommit={(value) =>
                                      onSetImageFrameMask(node.id, {
                                        ...roundedMask,
                                        cornerRadii: {
                                          ...independentRadii,
                                          [property]: value / 200,
                                        },
                                      })
                                    }
                                  />
                                ))}
                              </div>
                            )
                          })()
                        : null}
                      <CommitPercentSlider
                        label="Corner smoothing"
                        value={(roundedMask.cornerSmoothing ?? 0) * 100}
                        disabled={imageFrameDisabled}
                        onCommit={(cornerSmoothing) =>
                          onSetImageFrameMask(node.id, {
                            ...roundedMask,
                            cornerSmoothing: cornerSmoothing / 100,
                          })
                        }
                      />
                    </div>
                  )
                })()
              : null}
          </div>
          <div className="space-y-2 border-t pt-3">
            <div className="flex items-start gap-2.5 text-xs">
              <Checkbox
                id={decorativeCheckboxId}
                className="mt-0.5"
                checked={node.decorative}
                disabled={nodeMutationDisabled}
                onCheckedChange={(checked) =>
                  onUpdate({
                    decorative: checked === true,
                    ...(checked === true ? { alt: "" } : {}),
                  })
                }
              />
              <label htmlFor={decorativeCheckboxId}>
                <span className="block font-medium">Decorative image</span>
                <span className="mt-0.5 block text-muted-foreground">
                  Screen readers will skip this image.
                </span>
              </label>
            </div>
            {!node.decorative ? (
              <label className="space-y-1.5">
                <FieldLabel>Alternative text</FieldLabel>
                <CommitInput
                  placeholder="Describe the image"
                  value={node.alt}
                  disabled={nodeMutationDisabled}
                  onCommit={(alt) => onUpdate({ alt })}
                />
              </label>
            ) : null}
          </div>
          {imageSourceDisplay ? (
            <div className="space-y-1.5">
              <FieldLabel>Source</FieldLabel>
              <div className="rounded-lg border bg-muted/40 px-2.5 py-2">
                <p className="text-xs font-medium">
                  {imageSourceDisplay.label}
                </p>
                <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                  {imageSourceDisplay.publishRequiresResolution
                    ? "Choose or promote a Studio image before publishing."
                    : "Available to the editor and renderer."}
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Use Replace image to change this source safely.
              </p>
            </div>
          ) : null}
          {imageSourceReadiness !== "ready" ? (
            <div
              className="space-y-2 rounded-lg border bg-muted/40 p-2.5"
              role={imageSourceReadiness === "unavailable" ? "alert" : "status"}
            >
              <div className="flex items-start gap-2">
                {imageSourceReadiness === "unavailable" ? (
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
                ) : (
                  <LoaderCircleIcon className="mt-0.5 size-3.5 shrink-0 animate-spin text-muted-foreground" />
                )}
                <div>
                  <p className="text-[11px] font-medium text-foreground">
                    {imageSourceReadiness === "unavailable"
                      ? "Image unavailable"
                      : imageSourceReadiness === "loading"
                        ? "Preparing image"
                        : "Checking image"}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                    {imageSourceReadiness === "loading"
                      ? "Preparing this image for direct editing…"
                      : imageSourceReadiness === "unavailable"
                        ? "The frame and layer position are preserved. Retry the source, locate a replacement, or remove the layer."
                        : "Image editing becomes available after the canvas verifies this source."}
                  </p>
                </div>
              </div>
              {imageSourceReadiness === "unavailable" && localAssetId ? (
                <Button
                  className="w-full"
                  size="sm"
                  variant="outline"
                  onClick={() => onReviewDocumentImage(localAssetId)}
                >
                  <ImageUp data-icon="inline-start" />
                  Review document image
                </Button>
              ) : imageSourceReadiness === "unavailable" ? (
                <div className="grid grid-cols-3 gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label="Retry image source"
                    disabled={!missingImageRecoveryById.retry.enabled}
                    title={
                      missingImageRecoveryById.retry.disabledReason ?? undefined
                    }
                    onClick={() => onRetryImageSource(node.id)}
                  >
                    <RefreshCw data-icon="inline-start" />
                    Retry
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label="Locate replacement image"
                    aria-describedby={
                      inspector.capabilities.replaceImageDisabledReason
                        ? imageReplacementReasonId
                        : undefined
                    }
                    disabled={!missingImageRecoveryById.locate.enabled}
                    title={
                      missingImageRecoveryById.locate.disabledReason ??
                      undefined
                    }
                    onClick={() => onRunImageCommand("image.replace")}
                  >
                    <ImageUp data-icon="inline-start" />
                    Locate
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label="Remove image layer"
                    disabled={!missingImageRecoveryById.remove.enabled}
                    title={
                      missingImageRecoveryById.remove.disabledReason ??
                      undefined
                    }
                    onClick={onRemoveImageLayer}
                  >
                    <Trash2 data-icon="inline-start" />
                    Remove
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
          {inspector.capabilities.replaceImageDisabledReason ? (
            <p
              id={imageReplacementReasonId}
              className="rounded-lg border bg-muted/40 px-2.5 py-2 text-[11px] leading-4 text-muted-foreground"
              role="status"
            >
              {inspector.capabilities.replaceImageDisabledReason}
            </p>
          ) : null}
          {imageSourceReadiness !== "unavailable" ? (
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!isImageCommandEnabled("image.crop")}
                onClick={() => onRunImageCommand("image.crop")}
              >
                <Crop data-icon="inline-start" />
                Crop image
              </Button>
              <Button
                size="sm"
                variant="outline"
                aria-describedby={
                  inspector.capabilities.replaceImageDisabledReason
                    ? imageReplacementReasonId
                    : undefined
                }
                disabled={!isImageCommandEnabled("image.replace")}
                onClick={() => onRunImageCommand("image.replace")}
              >
                <ImageUp data-icon="inline-start" />
                Replace image…
              </Button>
            </div>
          ) : null}
          {backgroundRemoval ? (
            <BackgroundRemovalControl
              model={backgroundRemoval}
              sourceAssetId={
                node.src.startsWith("asset:managed/") ? node.assetId : null
              }
            />
          ) : null}
        </InspectorSection>
      ) : null}
    </div>
  )
}

function MultiSelectionInspector({
  nodes,
  onUpdateSelection,
  onTransformSelection,
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
  onUpdateSelection: (patch: Partial<SceneNode>) => void
  onTransformSelection: (action: PositionTransformAction) => void
  onAlign: (alignment: Alignment) => void
  onAlignToPage: (alignment: Alignment) => void
  onDistribute: (distribution: "horizontal" | "vertical") => void
  onSetLocked: (locked: boolean) => void
  onSetVisible: (visible: boolean) => void
  onReorder: (edge: "front" | "back") => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const inspector = useMemo(() => createInspectorSelectionModel(nodes), [nodes])
  const movableCount = inspector.editableCount
  const hasManagedWidth = nodes.some(
    (node) =>
      !node.locked && node.type === "text" && node.sizingMode === "auto_width"
  )
  const hasManagedHeight = nodes.some(
    (node) =>
      !node.locked && node.type === "text" && node.sizingMode !== "fixed"
  )
  const allVisible =
    inspector.values.visible.kind === "value" && inspector.values.visible.value
  return (
    <div className="flex flex-col">
      <section className="flex flex-col gap-3 border-b border-border/80 px-3 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xs font-medium">{nodes.length} layers</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Transform and arrange as one selection.
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              aria-label={
                allVisible ? "Hide selected layers" : "Show selected layers"
              }
              title={
                allVisible ? "Hide selected layers" : "Show selected layers"
              }
              size="icon-sm"
              variant="outline"
              onClick={() => onSetVisible(!allVisible)}
            >
              {allVisible ? <EyeOff /> : <Eye />}
            </Button>
            <Button
              aria-label={
                inspector.allLocked
                  ? "Unlock selected layers"
                  : "Lock selected layers"
              }
              title={
                inspector.allLocked
                  ? "Unlock selected layers"
                  : "Lock selected layers"
              }
              size="icon-sm"
              variant="outline"
              onClick={() => onSetLocked(!inspector.allLocked)}
            >
              {inspector.allLocked ? <Unlock /> : <Lock />}
            </Button>
          </div>
        </div>
        {inspector.allLocked ? (
          <EditorPanelNotice
            icon={<Lock />}
            description="Unlock the selection to edit its properties or arrangement."
            role="status"
          />
        ) : inspector.someLocked ? (
          <EditorPanelNotice
            icon={<AlertTriangle />}
            tone="warning"
            description={`${inspector.lockedCount} locked layer${
              inspector.lockedCount === 1 ? "" : "s"
            } will be skipped by property changes. Unlock the complete selection before changing its layer order.`}
            role="status"
          />
        ) : null}
      </section>

      <InspectorSection title="Position & size">
        <div className="grid grid-cols-2 gap-2">
          <InspectorNumberField
            label="X"
            value={inspector.values.x}
            disabled={!movableCount}
            onCommit={(x) => onUpdateSelection({ x })}
          />
          <InspectorNumberField
            label="Y"
            value={inspector.values.y}
            disabled={!movableCount}
            onCommit={(y) => onUpdateSelection({ y })}
          />
          <InspectorNumberField
            label="Width"
            value={inspector.values.width}
            min={1}
            disabled={!movableCount || hasManagedWidth}
            onCommit={(width) => onUpdateSelection({ width })}
          />
          <InspectorNumberField
            label="Height"
            value={inspector.values.height}
            min={1}
            disabled={!movableCount || hasManagedHeight}
            onCommit={(height) => onUpdateSelection({ height })}
          />
          <InspectorNumberField
            label="Rotation"
            value={inspector.values.rotation}
            disabled={!movableCount}
            onCommit={(rotation) => onUpdateSelection({ rotation })}
          />
          <PositionTransformControls
            disabled={!movableCount}
            onTransform={onTransformSelection}
          />
          <InspectorNumberField
            label="Opacity"
            value={mapInspectorValue(
              inspector.values.opacity,
              (opacity) => opacity * 100
            )}
            min={0}
            max={100}
            suffix="%"
            disabled={!movableCount}
            onCommit={(opacity) =>
              onUpdateSelection({ opacity: opacity / 100 })
            }
          />
        </div>
        {hasManagedWidth || hasManagedHeight ? (
          <EditorPanelNotice
            icon={<Settings2 />}
            description={`Auto-sizing text manages its ${
              hasManagedWidth ? "width" : ""
            }${hasManagedWidth && hasManagedHeight ? " and " : ""}${
              hasManagedHeight ? "height" : ""
            }. Change that text box to Fixed before resizing the complete selection on those axes.`}
            role="status"
          />
        ) : null}
      </InspectorSection>

      <InspectorSection title="Align & distribute">
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
      </InspectorSection>

      <InspectorSection title="Layer order">
        <div className="grid grid-cols-2 gap-2">
          <Button
            disabled={!movableCount || inspector.lockedCount > 0}
            size="sm"
            variant="outline"
            onClick={() => onReorder("front")}
          >
            <BringToFront data-icon="inline-start" />
            To front
          </Button>
          <Button
            disabled={!movableCount || inspector.lockedCount > 0}
            size="sm"
            variant="outline"
            onClick={() => onReorder("back")}
          >
            <SendToBack data-icon="inline-start" />
            To back
          </Button>
        </div>
      </InspectorSection>

      <Separator />
      <section className="grid grid-cols-2 gap-2 p-4">
        <Button size="sm" variant="outline" onClick={onDuplicate}>
          <CopyPlus data-icon="inline-start" />
          Duplicate
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={!movableCount}
          onClick={onDelete}
        >
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
  { value: "color", label: "Color" },
  { value: "choice", label: "Choice" },
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

function FieldDefinitionDialog({
  field,
  document,
  fields,
  controlIdPrefix,
  trigger,
  onSave,
  onFocusBinding,
}: {
  field?: FieldDefinition
  document: Document
  fields: FieldDefinition[]
  controlIdPrefix: string
  trigger: React.ReactNode
  onSave: (field: Omit<FieldDefinition, "id">) => void
  onFocusBinding?: (
    binding: Pick<FieldBindingImpact, "nodeId" | "property">
  ) => void
}) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState("")
  const [key, setKey] = useState("")
  const [keyEdited, setKeyEdited] = useState(false)
  const [type, setType] = useState<FieldDefinition["type"]>("text")
  const [required, setRequired] = useState(false)
  const [agentDescription, setAgentDescription] = useState("")
  const [minLength, setMinLength] = useState("")
  const [maxLength, setMaxLength] = useState("")
  const [minimum, setMinimum] = useState("")
  const [maximum, setMaximum] = useState("")
  const [choiceOptions, setChoiceOptions] = useState<
    NonNullable<FieldDefinition["validation"]["options"]>
  >([])
  const [defaultValue, setDefaultValue] = useState<FieldValue>("")
  const [defaultDraftValid, setDefaultDraftValid] = useState(true)
  const [confirmingChange, setConfirmingChange] = useState(false)
  const pendingFocusRef = useRef<Pick<
    FieldBindingImpact,
    "nodeId" | "property"
  > | null>(null)
  const controlId = `${controlIdPrefix}-${field?.id ?? "new"}`

  useEffect(() => {
    if (!open) return
    setLabel(field?.label ?? "")
    setKey(field?.key ?? "")
    setKeyEdited(Boolean(field))
    setType(field?.type ?? "text")
    setRequired(field?.required ?? false)
    setAgentDescription(field?.agentDescription ?? "")
    setMinLength(
      field?.validation.minLength === undefined
        ? ""
        : String(field.validation.minLength)
    )
    setMaxLength(
      field?.validation.maxLength === undefined
        ? ""
        : String(field.validation.maxLength)
    )
    setMinimum(
      field?.validation.minimum === undefined
        ? ""
        : fieldDraftValue(field.type, field.validation.minimum)
    )
    setMaximum(
      field?.validation.maximum === undefined
        ? ""
        : fieldDraftValue(field.type, field.validation.maximum)
    )
    setChoiceOptions(field?.validation.options ?? [])
    setDefaultValue(field?.defaultValue ?? "")
    setDefaultDraftValid(true)
    setConfirmingChange(false)
  }, [field, open])

  const parsedMinimum =
    minimum === ""
      ? undefined
      : type === "number"
        ? Number(minimum)
        : type === "currency"
          ? parseCurrencyValue(minimum)?.decimal
          : minimum
  const parsedMaximum =
    maximum === ""
      ? undefined
      : type === "number"
        ? Number(maximum)
        : type === "currency"
          ? parseCurrencyValue(maximum)?.decimal
          : maximum
  const validation: FieldDefinition["validation"] =
    type === "text"
      ? {
          minLength: minLength === "" ? undefined : Number(minLength),
          maxLength: maxLength === "" ? undefined : Number(maxLength),
        }
      : type === "number" || type === "currency" || type === "date"
        ? { minimum: parsedMinimum, maximum: parsedMaximum }
        : type === "choice"
          ? { options: choiceOptions }
          : {}
  const boundDraftErrors = validateFieldBoundDrafts(type, minimum, maximum)
  const draftDefinition: FieldDefinition = {
    id: field?.id ?? "draft_field",
    key: key || "draft_field",
    label: label.trim() || "Draft field",
    type,
    required,
    defaultValue,
    agentDescription,
    validation,
  }
  const definitionResult = fieldDefinitionSchema.safeParse(draftDefinition)
  const definitionError = definitionResult.success
    ? fieldDefinitionValidationMessage(draftDefinition)
    : (definitionResult.error.issues[0]?.message ?? "Review this field")

  const keyMalformed = Boolean(key) && !/^[a-z][a-z0-9_]*$/.test(key)
  const keyDuplicate = fields.some(
    (candidate) => candidate.id !== field?.id && candidate.key === key
  )
  const keyInvalid = keyMalformed || keyDuplicate
  const valid =
    label.trim().length > 0 &&
    /^[a-z][a-z0-9_]*$/.test(key) &&
    !keyDuplicate &&
    defaultDraftValid &&
    !boundDraftErrors.minimum &&
    !boundDraftErrors.maximum &&
    definitionResult.success &&
    !definitionError
  const nextDefinition: Omit<FieldDefinition, "id"> = {
    key,
    label: label.trim(),
    type,
    required,
    defaultValue,
    agentDescription: agentDescription.trim(),
    validation,
  }
  const definitionChanged =
    !field || !fieldDefinitionsEqual(field, nextDefinition)
  const canSave = valid && definitionChanged
  const changeImpact =
    field && definitionResult.success && !definitionError
      ? analyzeFieldDefinitionChange(document, field, nextDefinition)
      : null
  const typeImpact = changeImpact?.typeImpact ?? null
  const apiKeyChanged = changeImpact?.apiKeyChanged ?? false
  const requiresChangeConfirmation = changeImpact?.requiresConfirmation ?? false
  const save = () => {
    onSave(nextDefinition)
    setConfirmingChange(false)
    setOpen(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) pendingFocusRef.current = null
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        onCloseAutoFocus={(event) => {
          const binding = pendingFocusRef.current
          if (!binding) return
          event.preventDefault()
          pendingFocusRef.current = null
          requestAnimationFrame(() => onFocusBinding?.(binding))
        }}
      >
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
            if (!canSave) return
            if (requiresChangeConfirmation) {
              setConfirmingChange(true)
              return
            }
            save()
          }}
        >
          <FieldGroup className="gap-4">
            <Field>
              <FormFieldLabel htmlFor={`${controlId}-field-label`}>
                Label
              </FormFieldLabel>
              <Input
                id={`${controlId}-field-label`}
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
              <FormFieldLabel htmlFor={`${controlId}-field-key`}>
                API key
              </FormFieldLabel>
              <Input
                id={`${controlId}-field-key`}
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
              <FormFieldLabel htmlFor={`${controlId}-field-agent-description`}>
                Agent guidance
              </FormFieldLabel>
              <Textarea
                id={`${controlId}-field-agent-description`}
                aria-label="Agent guidance"
                className="min-h-20 resize-y"
                maxLength={1000}
                value={agentDescription}
                placeholder="Explain when an agent should use this field and what a good value looks like."
                onChange={(event) => setAgentDescription(event.target.value)}
              />
              <FieldDescription>
                Sent with the field contract so agents understand its intent.
              </FieldDescription>
            </Field>
            <Field>
              <FormFieldLabel htmlFor={`${controlId}-field-type`}>
                Value type
              </FormFieldLabel>
              <Select
                value={type}
                onValueChange={(nextType: FieldDefinition["type"]) => {
                  const firstChoice = {
                    value: "option_1",
                    label: "Option 1",
                    agentDescription: "",
                  }
                  const nextDefaultValue =
                    nextType === "choice" && required
                      ? firstChoice.value
                      : defaultFieldValue(nextType)
                  setType(nextType)
                  setDefaultValue(nextDefaultValue)
                  setMinLength("")
                  setMaxLength("")
                  setMinimum("")
                  setMaximum("")
                  setChoiceOptions(nextType === "choice" ? [firstChoice] : [])
                  setDefaultDraftValid(true)
                }}
              >
                <SelectTrigger
                  id={`${controlId}-field-type`}
                  aria-label="Value type"
                  className="h-11 w-full"
                >
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
            {type === "text" ? (
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FormFieldLabel htmlFor={`${controlId}-field-min-length`}>
                    Minimum length
                  </FormFieldLabel>
                  <Input
                    id={`${controlId}-field-min-length`}
                    aria-label="Minimum text length"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    type="number"
                    value={minLength}
                    placeholder="None"
                    onChange={(event) => setMinLength(event.target.value)}
                  />
                </Field>
                <Field>
                  <FormFieldLabel htmlFor={`${controlId}-field-max-length`}>
                    Maximum length
                  </FormFieldLabel>
                  <Input
                    id={`${controlId}-field-max-length`}
                    aria-label="Maximum text length"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    type="number"
                    value={maxLength}
                    placeholder="None"
                    onChange={(event) => setMaxLength(event.target.value)}
                  />
                </Field>
              </div>
            ) : null}
            {type === "number" || type === "currency" || type === "date" ? (
              <div className="grid grid-cols-2 gap-3">
                <Field data-invalid={Boolean(boundDraftErrors.minimum)}>
                  <FormFieldLabel htmlFor={`${controlId}-field-minimum`}>
                    Minimum
                  </FormFieldLabel>
                  <Input
                    id={`${controlId}-field-minimum`}
                    aria-label="Minimum value"
                    aria-invalid={Boolean(boundDraftErrors.minimum)}
                    inputMode={type === "date" ? undefined : "decimal"}
                    type={type === "date" ? "date" : "text"}
                    value={minimum}
                    placeholder="None"
                    onChange={(event) => setMinimum(event.target.value)}
                  />
                  {boundDraftErrors.minimum ? (
                    <FieldError>{boundDraftErrors.minimum}</FieldError>
                  ) : null}
                </Field>
                <Field data-invalid={Boolean(boundDraftErrors.maximum)}>
                  <FormFieldLabel htmlFor={`${controlId}-field-maximum`}>
                    Maximum
                  </FormFieldLabel>
                  <Input
                    id={`${controlId}-field-maximum`}
                    aria-label="Maximum value"
                    aria-invalid={Boolean(boundDraftErrors.maximum)}
                    inputMode={type === "date" ? undefined : "decimal"}
                    type={type === "date" ? "date" : "text"}
                    value={maximum}
                    placeholder="None"
                    onChange={(event) => setMaximum(event.target.value)}
                  />
                  {boundDraftErrors.maximum ? (
                    <FieldError>{boundDraftErrors.maximum}</FieldError>
                  ) : null}
                </Field>
              </div>
            ) : null}
            {type === "choice" ? (
              <Field>
                <div className="flex items-center justify-between gap-3">
                  <FormFieldLabel>Choice options</FormFieldLabel>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    onClick={() => {
                      let index = choiceOptions.length + 1
                      let value = `option_${index}`
                      const values = new Set(
                        choiceOptions.map((option) => option.value)
                      )
                      while (values.has(value)) {
                        index += 1
                        value = `option_${index}`
                      }
                      setChoiceOptions([
                        ...choiceOptions,
                        {
                          value,
                          label: `Option ${index}`,
                          agentDescription: "",
                        },
                      ])
                    }}
                  >
                    <Plus data-icon="inline-start" />
                    Add option
                  </Button>
                </div>
                <FieldDescription>
                  Values are stable API identifiers. Labels are what people see.
                </FieldDescription>
                <div className="flex flex-col gap-3">
                  {choiceOptions.map((option, index) => (
                    <div
                      key={`choice-${index}`}
                      className="rounded-lg border p-3"
                    >
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <span className="text-xs font-medium">
                          Option {index + 1}
                        </span>
                        <Button
                          type="button"
                          aria-label={`Remove option ${index + 1}`}
                          className="size-11"
                          variant="ghost"
                          onClick={() => {
                            const remaining = choiceOptions.filter(
                              (_, candidateIndex) => candidateIndex !== index
                            )
                            setChoiceOptions(remaining)
                            if (defaultValue === option.value) {
                              setDefaultValue(
                                required ? (remaining[0]?.value ?? "") : ""
                              )
                            }
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Field>
                          <FormFieldLabel
                            htmlFor={`${controlId}-choice-${index}-label`}
                          >
                            Label
                          </FormFieldLabel>
                          <Input
                            id={`${controlId}-choice-${index}-label`}
                            aria-label={`Option ${index + 1} label`}
                            value={option.label}
                            onChange={(event) => {
                              const next = [...choiceOptions]
                              next[index] = {
                                ...option,
                                label: event.target.value,
                              }
                              setChoiceOptions(next)
                            }}
                          />
                        </Field>
                        <Field>
                          <FormFieldLabel
                            htmlFor={`${controlId}-choice-${index}-value`}
                          >
                            API value
                          </FormFieldLabel>
                          <Input
                            id={`${controlId}-choice-${index}-value`}
                            aria-label={`Option ${index + 1} API value`}
                            className="font-mono"
                            value={option.value}
                            onChange={(event) => {
                              const nextValue = event.target.value
                              const next = [...choiceOptions]
                              next[index] = { ...option, value: nextValue }
                              setChoiceOptions(next)
                              if (defaultValue === option.value) {
                                setDefaultValue(nextValue)
                              }
                            }}
                          />
                        </Field>
                      </div>
                      <Field className="mt-3">
                        <FormFieldLabel
                          htmlFor={`${controlId}-choice-${index}-description`}
                        >
                          Agent guidance
                        </FormFieldLabel>
                        <Textarea
                          id={`${controlId}-choice-${index}-description`}
                          aria-label={`Option ${index + 1} agent guidance`}
                          className="min-h-16 resize-y"
                          maxLength={1000}
                          value={option.agentDescription}
                          placeholder="When should an agent choose this option?"
                          onChange={(event) => {
                            const next = [...choiceOptions]
                            next[index] = {
                              ...option,
                              agentDescription: event.target.value,
                            }
                            setChoiceOptions(next)
                          }}
                        />
                      </Field>
                    </div>
                  ))}
                </div>
              </Field>
            ) : null}
            <Field>
              <FormFieldLabel htmlFor={`${controlId}-field-default`}>
                Default value
              </FormFieldLabel>
              <TypedFieldValueControl
                ariaLabel="Default value"
                id={`${controlId}-field-default`}
                field={draftDefinition}
                value={defaultValue}
                onCommit={setDefaultValue}
                onDraftValidityChange={setDefaultDraftValid}
              />
            </Field>
            <Field>
              <FormFieldLabel htmlFor={`${controlId}-field-requirement`}>
                Requirement
              </FormFieldLabel>
              <ToggleGroup
                id={`${controlId}-field-requirement`}
                type="single"
                aria-label="Requirement"
                value={required ? "required" : "optional"}
                variant="outline"
                spacing={1}
                onValueChange={(value) => {
                  if (!value) return
                  const nextRequired = value === "required"
                  setRequired(nextRequired)
                  if (
                    nextRequired &&
                    type === "choice" &&
                    defaultValue === "" &&
                    choiceOptions[0]
                  ) {
                    setDefaultValue(choiceOptions[0].value)
                    setDefaultDraftValid(true)
                  }
                }}
              >
                <ToggleGroupItem className="h-11 flex-1" value="optional">
                  Optional
                </ToggleGroupItem>
                <ToggleGroupItem className="h-11 flex-1" value="required">
                  Required
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>
            {definitionError && !keyInvalid ? (
              <FieldError>{definitionError}</FieldError>
            ) : null}
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!canSave}>
              {field ? "Save changes" : "Create field"}
            </Button>
          </DialogFooter>
        </form>
        <AlertDialog open={confirmingChange} onOpenChange={setConfirmingChange}>
          <AlertDialogContent
            onCloseAutoFocus={(event) => {
              if (pendingFocusRef.current) event.preventDefault()
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Review field contract changes</AlertDialogTitle>
              <AlertDialogDescription>
                {apiKeyChanged
                  ? `The current draft API key changes from ${field?.key} to ${key}. Future published versions and integrations using them must use the new key; older immutable versions keep their original key. `
                  : ""}
                {typeImpact?.summary ?? ""}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {typeImpact?.incompatibleBindings.length ? (
              <div className="max-h-48 overflow-y-auto rounded-lg border p-2">
                {typeImpact.incompatibleBindings.map((binding) => (
                  <button
                    key={binding.bindingId}
                    type="button"
                    className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md border-b px-2 text-left text-[11px] last:border-b-0 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    onClick={() => {
                      pendingFocusRef.current = binding
                      setConfirmingChange(false)
                      setOpen(false)
                    }}
                  >
                    <span className="truncate font-medium">
                      {binding.nodeName ?? binding.nodeId}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {binding.pageName ?? "Missing page"} ·{" "}
                      {bindingPropertyLabels[binding.property]}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel>Keep current contract</AlertDialogCancel>
              <AlertDialogAction onClick={save}>
                Apply changes
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}

function FieldValueEditor({
  field,
  value,
  hasBindings,
  controlIdPrefix,
  onCommit,
  onChooseAsset,
}: {
  field: FieldDefinition
  value: FieldValue
  hasBindings: boolean
  controlIdPrefix: string
  onCommit: (value: FieldValue) => void
  onChooseAsset?: (opener: HTMLButtonElement) => void
}) {
  return (
    <TypedFieldValueControl
      ariaLabel={field.label}
      id={`${controlIdPrefix}-field-value-${field.id}`}
      field={field}
      value={value}
      assetCanBeEmpty={!field.required && !hasBindings}
      onCommit={onCommit}
      onChooseAsset={field.type === "asset" ? onChooseAsset : undefined}
    />
  )
}

function FieldDeletionDialog({
  field,
  impact,
  onRemove,
  onFocusBinding,
}: {
  field: FieldDefinition
  impact: ReturnType<typeof analyzeFieldDeletion>
  onRemove: () => void
  onFocusBinding: (
    binding: Pick<FieldBindingImpact, "nodeId" | "property">
  ) => void
}) {
  const [open, setOpen] = useState(false)
  const [pendingFocus, setPendingFocus] = useState<Pick<
    FieldBindingImpact,
    "nodeId" | "property"
  > | null>(null)

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) setPendingFocus(null)
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          aria-label={`Delete ${field.label}`}
          size="icon"
          className="size-11"
          variant="ghost"
        >
          <Trash2 />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          if (!pendingFocus) return
          event.preventDefault()
          const binding = pendingFocus
          setPendingFocus(null)
          requestAnimationFrame(() => onFocusBinding(binding))
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {field.label}?</AlertDialogTitle>
          <AlertDialogDescription>
            {impact.requiresConfirmation
              ? `This removes ${impact.bindingCount} binding${impact.bindingCount === 1 ? "" : "s"} across ${impact.outputCount} output${impact.outputCount === 1 ? "" : "s"} and ${impact.pageCount} page${impact.pageCount === 1 ? "" : "s"}.`
              : "This field has no bindings."}{" "}
            Existing layer content stays in place, and Undo restores the field,
            value, and every binding together.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {impact.bindings.length ? (
          <div className="max-h-52 overflow-y-auto rounded-lg border p-2">
            {impact.bindings.map((binding) => (
              <button
                key={binding.bindingId}
                type="button"
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-2 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                onClick={() => {
                  setPendingFocus(binding)
                  setOpen(false)
                }}
              >
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
                  {binding.nodeName ?? binding.nodeId}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {binding.pageName ?? "Missing page"} ·{" "}
                  {bindingPropertyLabels[binding.property]}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onRemove}>
            Delete field
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function FieldsPanel({
  document,
  selectedNodes,
  controlIdPrefix,
  onUpdateField,
  onCreateField,
  onUpdateFieldDefinition,
  onRemoveField,
  onBindField,
  onUnbindField,
  onFocusBinding,
  onChooseFieldAsset,
}: {
  document: Document
  selectedNodes: SceneNode[]
  controlIdPrefix: string
  onUpdateField: (fieldId: string, value: string | number | boolean) => void
  onCreateField: (field: Omit<FieldDefinition, "id">) => void
  onUpdateFieldDefinition: (
    fieldId: string,
    patch: Partial<Omit<FieldDefinition, "id">>
  ) => void
  onRemoveField: (fieldId: string) => void
  onBindField: (
    fieldId: string,
    nodeId: string,
    property: BindableProperty
  ) => void
  onUnbindField: (bindingId: string) => void
  onFocusBinding: (
    binding: Pick<FieldBindingImpact, "nodeId" | "property">
  ) => void
  onChooseFieldAsset?: (fieldId: string, opener: HTMLButtonElement) => void
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
  return (
    <div className="flex min-w-0 flex-col overflow-x-hidden">
      <section className="flex min-w-0 flex-col gap-4 p-4">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <div className="min-w-0">
            <h2 className="text-xs font-medium">Content fields</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Reuse document content across layers and outputs.
            </p>
          </div>
          <FieldDefinitionDialog
            document={document}
            fields={document.fields}
            controlIdPrefix={controlIdPrefix}
            trigger={
              <Button className="h-11 shrink-0" variant="outline">
                <Plus data-icon="inline-start" />
                New
              </Button>
            }
            onSave={onCreateField}
          />
        </div>

        {document.fields.length ? (
          <div className="flex min-w-0 flex-col gap-2">
            {document.fields.map((field) => {
              const bindings = document.bindings.filter(
                (binding) => binding.fieldId === field.id
              )
              const impact = analyzeFieldDeletion(document, field.id)
              return (
                <div
                  key={field.id}
                  className="w-full min-w-0 overflow-hidden rounded-lg border"
                  data-inspector-field-id={field.id}
                  tabIndex={-1}
                >
                  <div className="flex min-w-0 items-start gap-2 p-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <p className="truncate text-xs font-medium">
                          {field.label}
                        </p>
                        {field.required ? (
                          <Badge className="shrink-0" variant="secondary">
                            Required
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                        {field.key} · {field.type}
                      </p>
                    </div>
                    <FieldDefinitionDialog
                      field={field}
                      document={document}
                      fields={document.fields}
                      controlIdPrefix={controlIdPrefix}
                      trigger={
                        <Button
                          aria-label={`Edit ${field.label}`}
                          size="icon"
                          className="size-11 shrink-0"
                          variant="ghost"
                        >
                          <Settings2 />
                        </Button>
                      }
                      onSave={(updated) =>
                        onUpdateFieldDefinition(field.id, updated)
                      }
                      onFocusBinding={onFocusBinding}
                    />
                    <FieldDeletionDialog
                      field={field}
                      impact={impact}
                      onFocusBinding={onFocusBinding}
                      onRemove={() => onRemoveField(field.id)}
                    />
                  </div>
                  <Separator />
                  <div className="flex min-w-0 flex-col gap-2 p-2.5">
                    <FieldValueEditor
                      field={field}
                      hasBindings={bindings.length > 0}
                      controlIdPrefix={controlIdPrefix}
                      value={
                        document.fieldValues[field.id] ?? field.defaultValue
                      }
                      onCommit={(value) => onUpdateField(field.id, value)}
                      onChooseAsset={
                        onChooseFieldAsset
                          ? (opener) => onChooseFieldAsset(field.id, opener)
                          : undefined
                      }
                    />
                    <p className="text-[11px] text-muted-foreground">
                      {bindings.length} layer{bindings.length === 1 ? "" : "s"}
                      {impact.outputCount
                        ? ` across ${impact.outputCount} output${impact.outputCount === 1 ? "" : "s"}`
                        : ""}
                    </p>
                    {bindings.length ? (
                      <div
                        aria-label={`${field.label} bindings`}
                        className="flex flex-col gap-1"
                      >
                        {bindings.map((binding) => {
                          const node = document.nodes.find(
                            (candidate) => candidate.id === binding.nodeId
                          )
                          const page = document.pages.find((candidate) =>
                            candidate.nodeIds.includes(binding.nodeId)
                          )
                          if (!node || !page) return null
                          return (
                            <button
                              key={binding.id}
                              type="button"
                              className="group flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                              onClick={() => onFocusBinding(binding)}
                            >
                              <Link2 className="size-3 shrink-0 text-muted-foreground group-hover:text-foreground" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[11px] font-medium">
                                  {node.name}
                                </span>
                                <span className="block truncate text-[11px] text-muted-foreground">
                                  {page.name} ·{" "}
                                  {bindingPropertyLabels[binding.property]}
                                </span>
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <EditorPanelState
            icon={<Database />}
            title="No shared fields"
            description="Create a field for content that repeats across outputs."
          >
            <FieldDefinitionDialog
              document={document}
              fields={document.fields}
              controlIdPrefix={controlIdPrefix}
              trigger={
                <Button size="sm">
                  <Plus data-icon="inline-start" />
                  Create field
                </Button>
              }
              onSave={onCreateField}
            />
          </EditorPanelState>
        )}
      </section>

      <Separator />

      <section className="flex min-w-0 flex-col gap-3 px-3 py-3.5">
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
                      className="flex min-h-11 items-center gap-1 rounded-lg border p-1"
                    >
                      <Link2 className="size-3.5 text-muted-foreground" />
                      <button
                        type="button"
                        className="min-h-11 min-w-0 flex-1 rounded-md px-1 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        onClick={() => onFocusBinding(binding)}
                      >
                        <p className="truncate text-[11px] font-medium">
                          {field?.label ?? "Missing field"}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {bindingPropertyLabels[binding.property]}
                        </p>
                      </button>
                      <Button
                        aria-label={`Unbind ${field?.label ?? "field"}`}
                        size="icon"
                        className="size-11"
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
                <FormFieldLabel
                  htmlFor={`${controlIdPrefix}-field-binding-property`}
                >
                  Layer property
                </FormFieldLabel>
                <Select
                  value={property}
                  onValueChange={(next: BindableProperty) => setProperty(next)}
                >
                  <SelectTrigger
                    id={`${controlIdPrefix}-field-binding-property`}
                    aria-label="Layer property"
                    className="h-11 w-full"
                  >
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
                <FormFieldLabel
                  htmlFor={`${controlIdPrefix}-field-binding-shared-field`}
                >
                  Shared field
                </FormFieldLabel>
                <Select
                  value={bindingFieldId}
                  onValueChange={setBindingFieldId}
                  disabled={!compatibleFields.length}
                >
                  <SelectTrigger
                    id={`${controlIdPrefix}-field-binding-shared-field`}
                    aria-label="Shared field"
                    className="h-11 w-full"
                  >
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
              className="h-11"
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
          <EditorPanelNotice
            icon={<Link2 />}
            title="No layer selected"
            description="Select one layer on the canvas or in Layers to connect it to a content field."
          />
        )}
      </section>
    </div>
  )
}

function ReviewPanel({
  document,
  navigationDocument,
  pendingGeneratedDocument,
  generatedDocumentError,
  isCreatingGeneratedDocument,
  pendingChangeSet,
  lastResolvedChangeSet,
  reviewJournal,
  conflict,
  error,
  isApplying,
  webMcpStatus,
  webMcpError,
  onDecideOperation,
  onDecideAll,
  onApply,
  onDiscard,
  onCreateGeneratedDocument,
  onDiscardGeneratedDocument,
  onFocusTarget,
}: {
  document: Document
  navigationDocument: Document
  pendingGeneratedDocument: GeneratedDocumentPlan | null
  generatedDocumentError: string | null
  isCreatingGeneratedDocument: boolean
  pendingChangeSet: ChangeSet | null
  lastResolvedChangeSet: ChangeSet | null
  reviewJournal: ReviewJournal
  conflict: { message: string } | null
  error: string | null
  isApplying: boolean
  webMcpStatus: "unavailable" | "registering" | "ready" | "error"
  webMcpError: string | null
  onDecideOperation: (
    operationId: string,
    status: ChangeOperation["status"]
  ) => void
  onDecideAll: (status: "accepted" | "rejected") => void
  onApply: () => void
  onDiscard: () => void
  onCreateGeneratedDocument: () => void | Promise<boolean>
  onDiscardGeneratedDocument: () => void
  onFocusTarget: (target: ReviewAffectedTarget) => void
}) {
  const registeredToolNames = new Set(toolCatalog.map((tool) => tool.name))
  const [briefCopied, setBriefCopied] = useState(false)
  const acceptedCount =
    pendingChangeSet?.operations.filter(
      (operation) => operation.status === "accepted"
    ).length ?? 0
  const decidedCount =
    pendingChangeSet?.operations.filter(
      (operation) => operation.status !== "pending"
    ).length ?? 0
  const pendingReview = reviewJournal.pending

  const targetExists = (target: ReviewAffectedTarget) =>
    reviewTargetExists(navigationDocument, target)

  return (
    <div className="flex w-full min-w-0 flex-col overflow-hidden">
      <section className="flex min-w-0 flex-col gap-3 overflow-hidden p-4">
        <div className="flex items-start gap-2.5">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-secondary">
            <ListChecks className="size-3.5" />
          </div>
          <div>
            <h2 className="text-xs font-medium">Agent change set</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Proposals preview on canvas but never change the saved document
              until you apply them.
            </p>
          </div>
        </div>
        {pendingGeneratedDocument ? (
          <>
            <div className="min-w-0 rounded-lg border bg-muted/30 p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs leading-relaxed font-medium break-words">
                    {pendingGeneratedDocument.candidate.name}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {pendingGeneratedDocument.summary.pages.length} page
                    {pendingGeneratedDocument.summary.pages.length === 1
                      ? ""
                      : "s"}{" "}
                    · {pendingGeneratedDocument.candidate.nodes.length} editable
                    layers
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {pendingGeneratedDocument.provenance.skill.title} ·{" "}
                    {pendingGeneratedDocument.start.kind === "template"
                      ? `Template ${pendingGeneratedDocument.start.template.id} v${pendingGeneratedDocument.start.template.version}`
                      : `Blank preset ${pendingGeneratedDocument.start.presetId}`}
                  </p>
                </div>
                <Badge variant="secondary">Candidate</Badge>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {pendingGeneratedDocument.summary.pages.map((page) => {
                const scale = Math.min(116 / page.width, 92 / page.height)
                return (
                  <div
                    key={page.id}
                    className="min-w-0 overflow-hidden rounded-md border bg-muted/35 p-1.5"
                  >
                    <div className="grid h-24 place-items-center overflow-hidden">
                      <div
                        className="overflow-hidden border bg-background shadow-xs"
                        style={{
                          width: page.width * scale,
                          height: page.height * scale,
                        }}
                      >
                        <Artboard
                          document={pendingGeneratedDocument.candidate}
                          imageSemantics="thumbnail"
                          pageId={page.id}
                          scale={scale}
                          showImageRecoveryActions={false}
                        />
                      </div>
                    </div>
                    <p className="mt-1 truncate text-[11px] font-medium">
                      {page.name}
                    </p>
                    <p className="text-[11px] text-muted-foreground tabular-nums">
                      {page.width} × {page.height}
                    </p>
                  </div>
                )
              })}
            </div>

            <div className="grid gap-2 rounded-lg border bg-muted/20 p-2.5 text-[11px]">
              <p>
                <span className="text-muted-foreground">Structure:</span>{" "}
                {pendingGeneratedDocument.summary.structuralChanges.join(" · ")}
              </p>
              <p>
                <span className="text-muted-foreground">Fields:</span>{" "}
                {pendingGeneratedDocument.summary.fields.length
                  ? pendingGeneratedDocument.summary.fields.join(", ")
                  : "None"}
              </p>
              <p>
                <span className="text-muted-foreground">Assets:</span>{" "}
                {pendingGeneratedDocument.summary.assets.length
                  ? pendingGeneratedDocument.summary.assets.join(", ")
                  : "None"}
              </p>
              <p>
                <span className="text-muted-foreground">Design guides:</span>{" "}
                {pendingGeneratedDocument.provenance.designGuides.length
                  ? pendingGeneratedDocument.provenance.designGuides
                      .map((guide) => guide.title)
                      .join(", ")
                  : "None declared"}
              </p>
              <p>
                <span className="text-muted-foreground">Validation:</span>{" "}
                {pendingGeneratedDocument.validation.length
                  ? `${pendingGeneratedDocument.validation.length} issue(s)`
                  : "Passed"}
              </p>
            </div>

            {generatedDocumentError ? (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-[11px] leading-relaxed text-destructive"
              >
                {generatedDocumentError}
              </div>
            ) : null}

            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-1.5">
              <Button
                disabled={isCreatingGeneratedDocument}
                size="sm"
                variant="outline"
                onClick={onDiscardGeneratedDocument}
              >
                Discard
              </Button>
              <Button
                className="flex-1"
                disabled={isCreatingGeneratedDocument}
                size="sm"
                onClick={() => void onCreateGeneratedDocument()}
              >
                {isCreatingGeneratedDocument ? (
                  <>
                    <LoaderCircleIcon className="animate-spin" />
                    Creating…
                  </>
                ) : (
                  "Create editable document"
                )}
              </Button>
            </div>
          </>
        ) : pendingChangeSet ? (
          <>
            <div className="min-w-0 rounded-lg border bg-muted/30 p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs leading-relaxed font-medium break-words">
                    {pendingChangeSet.title}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Revision {pendingChangeSet.baseRevision} · {decidedCount} of{" "}
                    {pendingChangeSet.operations.length} reviewed
                  </p>
                  {pendingReview ? (
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                      {pendingReview.provenance.actorLabel}
                      {pendingReview.provenance.toolName
                        ? ` · ${pendingReview.provenance.toolName}`
                        : ""}
                      {` · ${new Date(pendingChangeSet.createdAt).toLocaleString()}`}
                    </p>
                  ) : null}
                </div>
                <Badge variant="secondary">Previewing</Badge>
              </div>
            </div>

            {pendingReview?.provenance.reason ? (
              <div className="rounded-lg border bg-muted/20 p-2.5">
                <p className="text-[11px] font-medium text-muted-foreground">
                  Reason
                </p>
                <p className="mt-1 text-[11px] leading-relaxed break-words">
                  {pendingReview.provenance.reason}
                </p>
              </div>
            ) : null}

            {pendingReview?.affected.length ? (
              <div className="flex min-w-0 flex-col gap-1.5">
                <p className="text-[11px] font-medium text-muted-foreground">
                  Affected objects
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {pendingReview.affected.map((target) => {
                    const exists = targetExists(target)
                    return (
                      <Button
                        key={`${target.kind}:${target.id}`}
                        size="sm"
                        variant="outline"
                        className="h-7 max-w-full px-2 text-[11px]"
                        disabled={!exists}
                        title={
                          exists
                            ? `Focus ${target.label}`
                            : `${target.label} is not present in the current document.`
                        }
                        onClick={() => onFocusTarget(target)}
                      >
                        <span className="truncate">
                          {reviewTargetKindLabel[target.kind]} · {target.label}
                        </span>
                      </Button>
                    )
                  })}
                </div>
              </div>
            ) : null}

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
                disabled={isApplying}
                size="sm"
                variant="outline"
                onClick={() => onDecideAll("rejected")}
              >
                Reject all
              </Button>
              <Button
                className="flex-1"
                disabled={isApplying}
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
                        <p className="mt-1 text-[11px] leading-relaxed break-words text-muted-foreground">
                          {operation.summary}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {details.context}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <Button
                          aria-label={`Reject ${operation.summary}`}
                          size="icon"
                          className="size-11"
                          disabled={isApplying}
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
                          size="icon"
                          className="size-11"
                          disabled={isApplying}
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
                    <div className="mt-2 grid min-w-0 gap-1 overflow-hidden rounded-md bg-muted/70 p-2 font-mono text-[11px] leading-relaxed">
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
              <Button
                disabled={isApplying}
                size="sm"
                variant="outline"
                onClick={onDiscard}
              >
                Discard
              </Button>
              <Button
                className="flex-1"
                size="sm"
                disabled={isApplying || !acceptedCount || Boolean(conflict)}
                onClick={onApply}
              >
                {isApplying ? (
                  <>
                    <LoaderCircleIcon className="animate-spin" />
                    Checking images…
                  </>
                ) : (
                  <>
                    Apply {acceptedCount || "accepted"} change
                    {acceptedCount === 1 ? "" : "s"}
                  </>
                )}
              </Button>
            </div>
          </>
        ) : (
          <EditorPanelState
            icon={<ListChecks />}
            title="No changes waiting"
            description={
              webMcpStatus === "ready"
                ? "Ask a browser agent to inspect the design and propose field or canvas updates."
                : "Copy the brief, then use it with this route in a WebMCP-capable browser."
            }
          >
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(DEMO_AGENT_BRIEF)
                setBriefCopied(true)
                window.setTimeout(() => setBriefCopied(false), 1600)
              }}
            >
              {briefCopied ? <Check /> : <ClipboardCopy />}
              {briefCopied ? "Brief copied" : "Copy demo brief"}
            </Button>
            {lastResolvedChangeSet ? (
              <Badge variant="outline">
                Last review: {lastResolvedChangeSet.status.replace("_", " ")}
              </Badge>
            ) : null}
          </EditorPanelState>
        )}

        {reviewJournal.resolved.length ? (
          <div className="flex min-w-0 flex-col gap-2 border-t pt-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[11px] font-medium text-muted-foreground">
                Review history
              </h3>
              <Badge variant="outline">{reviewJournal.resolved.length}</Badge>
            </div>
            {reviewJournal.resolved.map((entry) => (
              <div
                key={`${entry.changeSet.id}:${entry.resolution.resolvedAt}`}
                className="min-w-0 rounded-lg border p-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium break-words">
                      {entry.changeSet.title}
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                      {entry.provenance.actorLabel}
                      {entry.provenance.toolName
                        ? ` · ${entry.provenance.toolName}`
                        : ""}
                      {` · ${new Date(entry.resolution.resolvedAt).toLocaleString()}`}
                    </p>
                  </div>
                  <Badge
                    variant={
                      entry.resolution.status === "applied"
                        ? "secondary"
                        : "outline"
                    }
                  >
                    {entry.resolution.status}
                  </Badge>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Result revision {entry.resolution.resultRevision} ·{" "}
                  {entry.resolution.acceptedOperationIds.length} applied ·{" "}
                  {entry.resolution.rejectedOperationIds.length} rejected
                </p>
                {entry.affected.length ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {entry.affected.map((target) => {
                      const exists = targetExists(target)
                      return (
                        <Button
                          key={`${target.kind}:${target.id}`}
                          size="sm"
                          variant="ghost"
                          className="h-6 max-w-full px-1.5 text-[11px]"
                          disabled={!exists}
                          onClick={() => onFocusTarget(target)}
                        >
                          <span className="truncate">
                            {reviewTargetKindLabel[target.kind]} ·{" "}
                            {target.label}
                          </span>
                        </Button>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
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
              ? `${registeredToolNames.size} live`
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
                className="max-w-full font-mono text-[11px] break-all"
              >
                {tool.name}
              </Badge>
            ))}
        </div>
      </section>
    </div>
  )
}

const subscribeToNoCropPreview = () => () => undefined
const getNoCropPreview = () => null

export function projectImageCropInspectorSelection(
  selectedNodes: SceneNode[],
  cropSession: ReturnType<ImageCropPreviewStore["getSnapshot"]> | null
) {
  if (!cropSession) return selectedNodes
  return selectedNodes.map((node) =>
    node.type === "image" && node.id === cropSession.target.nodeId
      ? {
          ...node,
          ...cropSession.draftFrame,
          placement: cropSession.draft,
          frameMask: cropSession.draftFrameMask,
        }
      : node
  )
}

export function InspectorSidebar({
  document,
  reviewNavigationDocument = document,
  selectedNodes: selectedNodesProp,
  selectedGroupId = null,
  textEditingState = null,
  imageCropPreviewStore = null,
  pendingGeneratedDocument = null,
  generatedDocumentError = null,
  isCreatingGeneratedDocument = false,
  pendingChangeSet,
  lastResolvedChangeSet,
  reviewJournal = EMPTY_REVIEW_JOURNAL,
  changeSetConflict,
  changeSetError,
  isApplyingChangeSet,
  webMcpStatus,
  webMcpError,
  onUpdateNode,
  onPreviewNodePatch = ignoreNodePatch,
  onCancelNodePreview = ignoreNodePreviewCancel,
  onUpdateSelection,
  onTransformSelection = ignorePositionTransform,
  onUpdateField,
  onChooseFieldAsset,
  onCreateField,
  onUpdateFieldDefinition,
  onRemoveField,
  onBindField,
  onUnbindField,
  onFocusNode,
  onDecideChangeOperation,
  onDecideAllChangeOperations,
  onApplyChangeSet,
  onDiscardChangeSet,
  onCreateGeneratedDocument = async () => false,
  onDiscardGeneratedDocument = () => undefined,
  onFocusReviewTarget = ignoreReviewTarget,
  onAlignSelection,
  onAlignSelectionToPage,
  onDistributeSelection,
  onSetSelectionLocked,
  onSetSelectionVisible,
  onReorderSelection,
  onDuplicateSelection,
  onDeleteSelection,
  onUpdateImageFrameGeometry,
  onSetImagePlacement,
  onSetImageFrameMask,
  onRunImageCommand,
  isImageCommandEnabled,
  onRetryImageSource,
  onRemoveImageLayer,
  onReviewDocumentImage = () => undefined,
  backgroundRemoval,
  onApplyTextEditingStyle = ignoreTextStylePatch,
  onApplyTextEditingParagraphStyle = ignoreTextParagraphStylePatch,
  onEditTextLink = ignoreReviewTarget,
  onCreateTypographyStyle = ignoreCreateTypographyStyle,
  onUpdateTypographyStyle = ignoreTypographyStyleUpdate,
  onDeleteTypographyStyle = ignoreStyleMutation,
  onApplyTypographyStyle = ignoreStyleMutation,
  onDetachTypographyStyle = ignoreNodeStyleDetach,
  onCreatePaintStyle = ignoreCreatePaintStyle,
  onUpdatePaintStyle = ignorePaintStyleUpdate,
  onDeletePaintStyle = ignoreStyleMutation,
  onApplyPaintStyle = ignoreStyleMutation,
  onDetachPaintStyle = ignoreNodeStyleDetach,
  onCreateVariable = ignoreCreateVariable,
  onUpdateVariable = ignoreUpdateVariable,
  onDeleteVariable = ignoreVariableMutation,
  onBindVariable = ignoreBindVariable,
  onUnbindVariable = ignoreVariableMutation,
  onUpdateComponent = ignoreUpdateComponent,
  onSwitchComponentVariant = ignoreComponentVariant,
  onResetComponentLayerOverrides = ignoreComponentLayerOverrides,
  onResetAllComponentOverrides = ignoreComponentInstance,
  onDetachComponentInstance = ignoreComponentInstance,
  onFocusComponentSource = ignoreComponentSource,
  productCommandContext,
  productCommandRuntime,
  capabilityContext,
  focusFieldId = null,
  className,
}: {
  document: Document
  reviewNavigationDocument?: Document
  selectedNodes: SceneNode[]
  selectedGroupId?: string | null
  textEditingState?: CanvasTextEditingState | null
  imageCropPreviewStore?: ImageCropPreviewStore | null
  pendingGeneratedDocument?: GeneratedDocumentPlan | null
  generatedDocumentError?: string | null
  isCreatingGeneratedDocument?: boolean
  pendingChangeSet: ChangeSet | null
  lastResolvedChangeSet: ChangeSet | null
  reviewJournal?: ReviewJournal
  changeSetConflict: { message: string } | null
  changeSetError: string | null
  isApplyingChangeSet: boolean
  webMcpStatus: "unavailable" | "registering" | "ready" | "error"
  webMcpError: string | null
  onUpdateNode: (nodeId: string, patch: Partial<SceneNode>) => void
  onPreviewNodePatch?: (nodeId: string, patch: Partial<SceneNode>) => void
  onCancelNodePreview?: (nodeId: string) => void
  onUpdateSelection: (patch: Partial<SceneNode>) => void
  onTransformSelection?: (action: PositionTransformAction) => void
  onUpdateField: (fieldId: string, value: string | number | boolean) => void
  onChooseFieldAsset?: (fieldId: string, opener: HTMLButtonElement) => void
  onCreateField: (field: Omit<FieldDefinition, "id">) => void
  onUpdateFieldDefinition: (
    fieldId: string,
    patch: Partial<Omit<FieldDefinition, "id">>
  ) => void
  onRemoveField: (fieldId: string) => void
  onBindField: (
    fieldId: string,
    nodeId: string,
    property: BindableProperty
  ) => void
  onUnbindField: (bindingId: string) => void
  onFocusNode: (nodeId: string) => void
  onDecideChangeOperation: (
    operationId: string,
    status: ChangeOperation["status"]
  ) => void
  onDecideAllChangeOperations: (status: "accepted" | "rejected") => void
  onApplyChangeSet: () => void
  onDiscardChangeSet: () => void
  onCreateGeneratedDocument?: () => void | Promise<boolean>
  onDiscardGeneratedDocument?: () => void
  onFocusReviewTarget?: (target: ReviewAffectedTarget) => void
  onAlignSelection: (alignment: Alignment) => void
  onAlignSelectionToPage: (alignment: Alignment) => void
  onDistributeSelection: (distribution: "horizontal" | "vertical") => void
  onSetSelectionLocked: (locked: boolean) => void
  onSetSelectionVisible: (visible: boolean) => void
  onReorderSelection: (edge: "front" | "back") => void
  onDuplicateSelection: () => void
  onDeleteSelection: () => void
  onUpdateImageFrameGeometry: (
    nodeId: string,
    patch: Partial<NodeGeometryPatch>
  ) => void
  onSetImagePlacement: (nodeId: string, placement: ImagePlacement) => void
  onSetImageFrameMask: (nodeId: string, frameMask: ImageFrameMask) => void
  onRunImageCommand: (commandId: EditorImageCommandId) => void
  isImageCommandEnabled: (commandId: EditorImageCommandId) => boolean
  onRetryImageSource: (nodeId: string) => void
  onRemoveImageLayer: () => void
  onReviewDocumentImage?: (localAssetId: string) => void
  backgroundRemoval?: BackgroundRemovalModel
  onApplyTextEditingStyle?: (patch: TextRunStylePatch) => void
  onApplyTextEditingParagraphStyle?: (patch: TextParagraphStylePatch) => void
  onEditTextLink?: () => void
  onCreateTypographyStyle?: (
    style: Omit<TypographyStyle, "id">,
    nodeId?: string
  ) => string | null
  onUpdateTypographyStyle?: (
    styleId: string,
    patch: TypographyStylePatch
  ) => boolean
  onDeleteTypographyStyle?: (styleId: string) => boolean
  onApplyTypographyStyle?: (styleId: string, nodeId: string) => boolean
  onDetachTypographyStyle?: (nodeId: string) => boolean
  onCreatePaintStyle?: (
    style: Omit<PaintStyle, "id">,
    nodeId?: string
  ) => string | null
  onUpdatePaintStyle?: (styleId: string, patch: PaintStylePatch) => boolean
  onDeletePaintStyle?: (styleId: string) => boolean
  onApplyPaintStyle?: (styleId: string, nodeId: string) => boolean
  onDetachPaintStyle?: (nodeId: string) => boolean
  onCreateVariable?: (variable: DesignVariable) => boolean
  onUpdateVariable?: (variableId: string, patch: DesignVariablePatch) => boolean
  onDeleteVariable?: (variableId: string) => boolean
  onBindVariable?: (
    variableId: string,
    target: VariableBindingTarget
  ) => boolean
  onUnbindVariable?: (bindingId: string) => boolean
  onUpdateComponent?: (
    componentId: string,
    patch: {
      name?: string
      description?: string
      defaultVariantId?: string
    }
  ) => boolean
  onSwitchComponentVariant?: (instanceId: string, variantId: string) => boolean
  onResetComponentLayerOverrides?: (
    instanceId: string,
    sourceNodeId: string
  ) => boolean
  onResetAllComponentOverrides?: (instanceId: string) => boolean
  onDetachComponentInstance?: (instanceId: string) => boolean
  onFocusComponentSource?: (componentId: string) => void
  productCommandContext?: ProductCommandRuntimeContext
  productCommandRuntime?: ProductCommandMenuRuntime
  capabilityContext?: InspectorCapabilityContext
  focusFieldId?: string | null
  className?: string
}) {
  const cropSession = useSyncExternalStore(
    imageCropPreviewStore?.subscribe ?? subscribeToNoCropPreview,
    imageCropPreviewStore?.getSnapshot ?? getNoCropPreview,
    imageCropPreviewStore?.getSnapshot ?? getNoCropPreview
  )
  const selectedNodes = useMemo(
    () => projectImageCropInspectorSelection(selectedNodesProp, cropSession),
    [cropSession, selectedNodesProp]
  )
  const componentSelection = useMemo(
    () => projectComponentSelection(document, selectedNodes, selectedGroupId),
    [document, selectedGroupId, selectedNodes]
  )
  const maskCapabilities = useMemo(
    () =>
      deriveInspectorMaskCapabilities({
        document,
        pageId:
          productCommandContext?.activePageId ??
          document.pages.find((page) =>
            selectedNodes.some((node) => page.nodeIds.includes(node.id))
          )?.id ??
          document.pages[0]?.id ??
          "missing-page",
        selectedNodeIds: selectedNodes.map((node) => node.id),
        selectedGroupId,
        documentEditable: capabilityContext?.documentEditable ?? true,
      }),
    [
      capabilityContext?.documentEditable,
      document,
      productCommandContext?.activePageId,
      selectedGroupId,
      selectedNodes,
    ]
  )
  const controlIdPrefix = `inspector-${useId()}`
  const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : undefined
  const [activeTab, setActiveTab] = useState(
    pendingChangeSet || pendingGeneratedDocument ? "review" : "design"
  )
  const [focusedBinding, setFocusedBinding] = useState<{
    nodeId: string
    property: BindableProperty
  } | null>(null)
  const inspectorRootRef = useRef<HTMLElement>(null)
  const previousSelectedNodeIdRef = useRef(selectedNode?.id)
  const reviewPending = Boolean(pendingChangeSet || pendingGeneratedDocument)

  useEffect(() => {
    if (pendingChangeSet || pendingGeneratedDocument) setActiveTab("review")
  }, [pendingChangeSet, pendingGeneratedDocument])

  useEffect(() => {
    if (!focusFieldId || pendingChangeSet || pendingGeneratedDocument) return
    setActiveTab("data")
    const frame = requestAnimationFrame(() => {
      const target = inspectorRootRef.current?.querySelector<HTMLElement>(
        `[data-inspector-field-id="${CSS.escape(focusFieldId)}"]`
      )
      target?.scrollIntoView({ behavior: "smooth", block: "center" })
      target?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [focusFieldId, pendingChangeSet, pendingGeneratedDocument])

  useEffect(() => {
    if (
      activeTab !== "design" ||
      !focusedBinding ||
      selectedNode?.id !== focusedBinding.nodeId
    ) {
      return
    }
    let clearTimer: ReturnType<typeof setTimeout> | undefined
    const frame = requestAnimationFrame(() => {
      const target = inspectorRootRef.current?.querySelector<HTMLElement>(
        `[data-inspector-property="${focusedBinding.property}"]`
      )
      target?.scrollIntoView({ behavior: "smooth", block: "center" })
      target?.focus({ preventScroll: true })
      clearTimer = setTimeout(() => {
        setFocusedBinding((current) =>
          current?.nodeId === focusedBinding.nodeId &&
          current.property === focusedBinding.property
            ? null
            : current
        )
      }, 1800)
    })
    return () => {
      cancelAnimationFrame(frame)
      if (clearTimer) clearTimeout(clearTimer)
    }
  }, [activeTab, focusedBinding, selectedNode?.id])

  useEffect(() => {
    if (previousSelectedNodeIdRef.current === selectedNode?.id) return
    previousSelectedNodeIdRef.current = selectedNode?.id
    setFocusedBinding((current) =>
      current && current.nodeId !== selectedNode?.id ? null : current
    )
  }, [selectedNode?.id])

  return (
    <aside
      ref={inspectorRootRef}
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden border-l bg-editor-panel",
        className
      )}
    >
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          setActiveTab(value)
          if (value !== "design") setFocusedBinding(null)
        }}
        className="min-h-0 min-w-0 flex-1 gap-0 overflow-hidden"
      >
        <EditorPanelTabsList aria-label="Inspector panels">
          <TabsTrigger
            value="design"
            disabled={reviewPending}
            className="flex-none px-2 text-[11px]"
          >
            Design
          </TabsTrigger>
          <TabsTrigger
            value="data"
            disabled={reviewPending}
            className="flex-none px-2 text-[11px]"
          >
            Data
          </TabsTrigger>
          <TabsTrigger value="review" className="flex-none px-2 text-[11px]">
            Review
          </TabsTrigger>
        </EditorPanelTabsList>
        <TabsContent value="design" className="min-h-0">
          <ScrollArea className="h-full" viewportClassName="pr-2.5 pb-3">
            {componentSelection ? (
              <ComponentInspectorSection
                context={componentSelection}
                reviewPending={reviewPending}
                onUpdateComponent={onUpdateComponent}
                onSwitchVariant={onSwitchComponentVariant}
                onResetLayerOverrides={onResetComponentLayerOverrides}
                onResetAllOverrides={onResetAllComponentOverrides}
                onDetach={onDetachComponentInstance}
                onFocusSource={onFocusComponentSource}
              />
            ) : null}
            <MaskInspectorSection
              document={document}
              capabilities={maskCapabilities}
              commandContext={productCommandContext}
              commandRuntime={productCommandRuntime}
            />
            {selectedNode ? (
              <NodeInspector
                document={document}
                node={selectedNode}
                textEditingState={textEditingState}
                focusedProperty={
                  focusedBinding?.nodeId === selectedNode.id
                    ? focusedBinding.property
                    : undefined
                }
                onUpdate={(patch) => onUpdateNode(selectedNode.id, patch)}
                onUpdateRelatedNode={onUpdateNode}
                onPreview={(patch) =>
                  onPreviewNodePatch(selectedNode.id, patch)
                }
                onCancelPreview={() => onCancelNodePreview(selectedNode.id)}
                onAlignToPage={onAlignSelectionToPage}
                onUpdateImageFrameGeometry={onUpdateImageFrameGeometry}
                onSetImagePlacement={onSetImagePlacement}
                onSetImageFrameMask={onSetImageFrameMask}
                onRunImageCommand={onRunImageCommand}
                isImageCommandEnabled={isImageCommandEnabled}
                onRetryImageSource={onRetryImageSource}
                onRemoveImageLayer={onRemoveImageLayer}
                onReviewDocumentImage={onReviewDocumentImage}
                backgroundRemoval={backgroundRemoval}
                capabilityContext={capabilityContext}
                onApplyTextEditingStyle={onApplyTextEditingStyle}
                onApplyTextEditingParagraphStyle={
                  onApplyTextEditingParagraphStyle
                }
                onEditTextLink={onEditTextLink}
                onCreateTypographyStyle={onCreateTypographyStyle}
                onUpdateTypographyStyle={onUpdateTypographyStyle}
                onDeleteTypographyStyle={onDeleteTypographyStyle}
                onApplyTypographyStyle={onApplyTypographyStyle}
                onDetachTypographyStyle={onDetachTypographyStyle}
                onCreatePaintStyle={onCreatePaintStyle}
                onUpdatePaintStyle={onUpdatePaintStyle}
                onDeletePaintStyle={onDeletePaintStyle}
                onApplyPaintStyle={onApplyPaintStyle}
                onDetachPaintStyle={onDetachPaintStyle}
                onFocusStyleNode={onFocusNode}
              />
            ) : selectedNodes.length > 1 ? (
              <MultiSelectionInspector
                nodes={selectedNodes}
                onUpdateSelection={onUpdateSelection}
                onTransformSelection={onTransformSelection}
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
              <EditorPanelState
                description="Select an object on the canvas or in Layers to edit its properties."
                icon={<Square />}
                title="Nothing selected"
              />
            )}
          </ScrollArea>
        </TabsContent>
        <TabsContent value="data" className="min-h-0 min-w-0 overflow-hidden">
          <ScrollArea
            className="h-full min-w-0"
            viewportClassName="min-w-0 overflow-x-hidden pr-2.5 pb-3"
          >
            <div className="min-w-0 overflow-x-hidden">
              <FieldsPanel
                document={document}
                selectedNodes={selectedNodes}
                controlIdPrefix={controlIdPrefix}
                onUpdateField={onUpdateField}
                onChooseFieldAsset={
                  capabilityContext?.documentEditable === false
                    ? undefined
                    : onChooseFieldAsset
                }
                onCreateField={onCreateField}
                onUpdateFieldDefinition={onUpdateFieldDefinition}
                onRemoveField={onRemoveField}
                onBindField={onBindField}
                onUnbindField={onUnbindField}
                onFocusBinding={(binding) => {
                  setFocusedBinding({
                    nodeId: binding.nodeId,
                    property: binding.property,
                  })
                  onFocusNode(binding.nodeId)
                  setActiveTab("design")
                }}
              />
              <Separator />
              <DesignVariablesPanel
                document={document}
                selectedNode={selectedNode}
                textEditingState={textEditingState}
                onCreate={onCreateVariable}
                onUpdate={onUpdateVariable}
                onDelete={onDeleteVariable}
                onBind={onBindVariable}
                onUnbind={onUnbindVariable}
                onFocusNode={(nodeId) => {
                  onFocusNode(nodeId)
                  setActiveTab("design")
                }}
              />
            </div>
          </ScrollArea>
        </TabsContent>
        <TabsContent value="review" className="min-h-0">
          <ScrollArea className="h-full" viewportClassName="pr-2.5 pb-3">
            <ReviewPanel
              document={document}
              navigationDocument={reviewNavigationDocument}
              pendingGeneratedDocument={pendingGeneratedDocument}
              generatedDocumentError={generatedDocumentError}
              isCreatingGeneratedDocument={isCreatingGeneratedDocument}
              pendingChangeSet={pendingChangeSet}
              lastResolvedChangeSet={lastResolvedChangeSet}
              reviewJournal={reviewJournal}
              conflict={changeSetConflict}
              error={changeSetError}
              isApplying={isApplyingChangeSet}
              webMcpStatus={webMcpStatus}
              webMcpError={webMcpError}
              onDecideOperation={onDecideChangeOperation}
              onDecideAll={onDecideAllChangeOperations}
              onApply={onApplyChangeSet}
              onDiscard={onDiscardChangeSet}
              onCreateGeneratedDocument={onCreateGeneratedDocument}
              onDiscardGeneratedDocument={onDiscardGeneratedDocument}
              onFocusTarget={onFocusReviewTarget}
            />
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </aside>
  )
}
