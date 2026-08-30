"use client"

import {
  Bold,
  Italic,
  Minus,
  Plus,
  Strikethrough,
  Underline,
} from "lucide-react"
import type { MouseEvent, ReactNode } from "react"

import type {
  TextRunStylePatch,
  TextSelectionSharedValue,
} from "@webmcp/document"
import type { CanvasTextEditingState } from "@webmcp/editor"
import { Button } from "@webmcp/ui/components/button"
import { Separator } from "@webmcp/ui/components/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@webmcp/ui/components/tooltip"
import { cn } from "@webmcp/ui/lib/utils"

const textColorChoices = ["#111827", "#ffffff", "#2563eb", "#dc2626"] as const

const sharedValue = <Value,>(state: TextSelectionSharedValue<Value>) =>
  state.kind === "value" ? state.value : null

export const textFormattingTogglePatch = (
  state: CanvasTextEditingState,
  control: "bold" | "italic" | "underline" | "strikethrough"
): TextRunStylePatch => {
  if (control === "bold") {
    const weight = sharedValue(state.style.fontWeight)
    return { fontWeight: weight !== null && weight >= 700 ? 400 : 700 }
  }
  if (control === "italic") {
    return { italic: sharedValue(state.style.italic) !== true }
  }
  const current = sharedValue(state.style.decoration)
  const decoration = control === "underline" ? "underline" : "line_through"
  return { decoration: current === decoration ? "none" : decoration }
}

function FormattingButton({
  label,
  active,
  mixed,
  children,
  onClick,
}: {
  label: string
  active: boolean
  mixed?: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={label}
          aria-pressed={active}
          className="size-8 rounded-md aria-pressed:bg-foreground aria-pressed:text-background data-[mixed=true]:bg-muted [&_svg]:size-3.5"
          data-mixed={mixed ? "true" : "false"}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function TextFormattingToolbar({
  state,
  onApply,
  className,
}: {
  state: CanvasTextEditingState
  onApply: (patch: TextRunStylePatch) => void
  className?: string
}) {
  const fontSize = sharedValue(state.style.fontSize)
  const fontWeight = sharedValue(state.style.fontWeight)
  const italic = sharedValue(state.style.italic)
  const decoration = sharedValue(state.style.decoration)
  const color = sharedValue(state.style.color)
  const selectionLabel =
    state.selection.anchor === state.selection.focus
      ? "Text insertion formatting"
      : "Selected text formatting"
  const keepCanvasFocus = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div
        aria-label={selectionLabel}
        className={cn(
          "flex h-11 max-w-full items-center gap-0.5 rounded-xl border bg-background/96 p-1 shadow-lg ring-1 ring-black/4 backdrop-blur-md",
          className
        )}
        data-text-formatting-toolbar="true"
        onMouseDown={keepCanvasFocus}
        role="toolbar"
      >
        <div
          aria-label="Font size"
          className="flex h-8 items-center rounded-md bg-muted/70"
          role="group"
        >
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Decrease font size"
            className="size-8 rounded-md [&_svg]:size-3"
            onClick={() =>
              onApply({ fontSize: Math.max(1, (fontSize ?? 16) - 1) })
            }
          >
            <Minus />
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
            aria-label="Increase font size"
            className="size-8 rounded-md [&_svg]:size-3"
            onClick={() => onApply({ fontSize: (fontSize ?? 16) + 1 })}
          >
            <Plus />
          </Button>
        </div>
        <Separator className="mx-0.5 h-5" orientation="vertical" />
        <FormattingButton
          label="Bold (⌘B)"
          active={fontWeight !== null && fontWeight >= 700}
          mixed={fontWeight === null}
          onClick={() => onApply(textFormattingTogglePatch(state, "bold"))}
        >
          <Bold />
        </FormattingButton>
        <FormattingButton
          label="Italic (⌘I)"
          active={italic === true}
          mixed={italic === null}
          onClick={() => onApply(textFormattingTogglePatch(state, "italic"))}
        >
          <Italic />
        </FormattingButton>
        <FormattingButton
          label="Underline (⌘U)"
          active={decoration === "underline"}
          mixed={decoration === null}
          onClick={() => onApply(textFormattingTogglePatch(state, "underline"))}
        >
          <Underline />
        </FormattingButton>
        <FormattingButton
          label="Strikethrough"
          active={decoration === "line_through"}
          mixed={decoration === null}
          onClick={() =>
            onApply(textFormattingTogglePatch(state, "strikethrough"))
          }
        >
          <Strikethrough />
        </FormattingButton>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={
            fontWeight === null
              ? "Mixed font weights"
              : `Font weight ${fontWeight}`
          }
          className="h-8 min-w-11 rounded-md px-2 text-[10px] tabular-nums"
          onClick={() => {
            const weights = [400, 500, 600, 700, 800]
            const currentIndex = weights.indexOf(fontWeight ?? 400)
            onApply({
              fontWeight: weights[(currentIndex + 1) % weights.length],
            })
          }}
        >
          {fontWeight === null ? "Mix" : fontWeight}
        </Button>
        <Separator className="mx-0.5 h-5" orientation="vertical" />
        <div aria-label="Text color" className="flex items-center" role="group">
          {textColorChoices.map((choice) => (
            <Tooltip key={choice}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={`Set text color ${choice}`}
                  aria-pressed={color === choice}
                  className="relative grid size-7 place-items-center rounded-md hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  onClick={() => onApply({ color: choice })}
                >
                  <span
                    className="size-3.5 rounded-full border border-black/15 shadow-xs ring-offset-2 aria-hidden:ring-2"
                    style={{ backgroundColor: choice }}
                  />
                  {color === choice ? (
                    <span className="absolute right-0.5 bottom-0.5 size-1.5 rounded-full bg-primary ring-1 ring-background" />
                  ) : null}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8}>
                {choice}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>
    </TooltipProvider>
  )
}
