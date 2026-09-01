"use client"

import {
  Bold,
  Italic,
  Link2,
  Minus,
  Plus,
  Strikethrough,
  Underline,
} from "lucide-react"
import type { MouseEvent, ReactNode } from "react"

import type { TextRunStylePatch } from "@webmcp/document"
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
import {
  sharedTextSelectionValue,
  textColorChoices,
  textFormattingTogglePatch,
} from "./text-formatting-model"

function FormattingButton({
  label,
  active,
  mixed,
  disabled,
  children,
  onClick,
}: {
  label: string
  active: boolean
  mixed?: boolean
  disabled?: boolean
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
          disabled={disabled}
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
  onEditLink,
  className,
}: {
  state: CanvasTextEditingState
  onApply: (patch: TextRunStylePatch) => void
  onEditLink: () => void
  className?: string
}) {
  const fontSize = sharedTextSelectionValue(state.style.fontSize)
  const fontWeight = sharedTextSelectionValue(state.style.fontWeight)
  const italic = sharedTextSelectionValue(state.style.italic)
  const decoration = sharedTextSelectionValue(state.style.decoration)
  const color = sharedTextSelectionValue(state.style.color)
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
          "flex h-11 w-full max-w-full [scrollbar-width:none] items-center gap-0.5 overflow-x-auto overscroll-x-contain rounded-xl border bg-editor-floating p-1 shadow-lg ring-1 ring-black/4 backdrop-blur-md [&::-webkit-scrollbar]:hidden [&>*]:shrink-0",
          className
        )}
        data-text-formatting-toolbar="true"
        onDoubleClick={(event) => event.stopPropagation()}
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
        <FormattingButton
          label={
            state.selection.anchor === state.selection.focus &&
            state.link.kind === "none"
              ? "Select text to add a link"
              : state.link.kind === "value"
                ? "Edit link"
                : state.link.kind === "mixed"
                  ? "Replace links"
                  : "Add link"
          }
          active={state.link.kind === "value"}
          mixed={state.link.kind === "mixed"}
          disabled={
            state.selection.anchor === state.selection.focus &&
            state.link.kind === "none"
          }
          onClick={onEditLink}
        >
          <Link2 />
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
          className="h-8 min-w-[72px] gap-1 rounded-[5px] px-2 text-[11px] tabular-nums"
          data-font-weight-cycle="true"
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
