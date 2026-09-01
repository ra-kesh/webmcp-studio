import * as React from "react"

import { TabsList } from "@webmcp/ui/components/tabs"
import { cn } from "@webmcp/ui/lib/utils"

function EditorPanelHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="editor-panel-header"
      className={cn(
        "flex h-(--studio-contextbar-height) shrink-0 items-center border-b border-border bg-editor-panel px-3",
        className
      )}
      {...props}
    />
  )
}

function EditorPanelTabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsList>) {
  return (
    <EditorPanelHeader className="p-0">
      <TabsList
        variant="line"
        className={cn(
          "[&_[data-slot=tabs-trigger]][data-state=active]:font-semibold [&_[data-slot=tabs-trigger]][data-state=active]:text-foreground !h-full w-full justify-start gap-0 rounded-none p-0 px-1.5 [&_[data-slot=tabs-trigger]]:!h-full [&_[data-slot=tabs-trigger]]:rounded-none [&_[data-slot=tabs-trigger]]:px-2.5 [&_[data-slot=tabs-trigger]]:font-normal [&_[data-slot=tabs-trigger]]:text-muted-foreground [&_[data-slot=tabs-trigger]]:after:inset-x-2 [&_[data-slot=tabs-trigger]]:after:bottom-0 [&_[data-slot=tabs-trigger]]:focus-visible:border-transparent [&_[data-slot=tabs-trigger]]:focus-visible:ring-1 [&_[data-slot=tabs-trigger]]:focus-visible:ring-studio-accent/50 [&_[data-slot=tabs-trigger]]:focus-visible:ring-inset",
          className
        )}
        {...props}
      />
    </EditorPanelHeader>
  )
}

function EditorPanelSectionHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="editor-panel-section-header"
      className={cn(
        "flex min-h-8 shrink-0 items-center gap-2 border-b border-border bg-editor-panel px-3 text-[11px] font-semibold",
        className
      )}
      {...props}
    />
  )
}

function EditorPanelNotice({
  icon,
  title,
  description,
  tone = "neutral",
  children,
  className,
  ...props
}: React.ComponentProps<"section"> & {
  icon?: React.ReactNode
  title?: React.ReactNode
  description: React.ReactNode
  tone?: "neutral" | "warning" | "error"
}) {
  return (
    <section
      data-slot="editor-panel-notice"
      data-tone={tone}
      className={cn(
        "flex min-w-0 items-start gap-2 rounded-sm border border-border bg-editor-field px-2.5 py-2 text-[11px] leading-4 text-muted-foreground",
        tone === "warning" &&
          "border-[color:var(--vbg-color-warning)]/30 bg-[color:var(--vbg-amber-100)] text-foreground",
        tone === "error" &&
          "border-destructive/30 bg-destructive/6 text-destructive",
        className
      )}
      {...props}
    >
      {icon ? (
        <span
          aria-hidden
          className="mt-px grid size-4 shrink-0 place-items-center text-current [&_svg]:size-3.5"
          data-slot="editor-panel-notice-icon"
        >
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        {title ? (
          <p
            className="font-medium text-foreground"
            data-slot="editor-panel-notice-title"
          >
            {title}
          </p>
        ) : null}
        <div
          className={cn(title && "mt-0.5")}
          data-slot="editor-panel-notice-description"
        >
          {description}
        </div>
        {children ? (
          <div
            className="mt-2 flex flex-wrap items-center gap-1.5"
            data-slot="editor-panel-notice-actions"
          >
            {children}
          </div>
        ) : null}
      </div>
    </section>
  )
}

function EditorPanelState({
  icon,
  title,
  description,
  tone = "neutral",
  children,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  tone?: "neutral" | "error"
}) {
  return (
    <div
      data-slot="editor-panel-state"
      data-tone={tone}
      className={cn(
        "flex min-h-56 w-full min-w-0 flex-1 flex-col items-center justify-center px-6 py-8 text-center",
        className
      )}
      {...props}
    >
      {icon ? (
        <div
          className={cn(
            "mb-3 grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4",
            tone === "error" && "bg-destructive/10 text-destructive"
          )}
          data-slot="editor-panel-state-icon"
        >
          {icon}
        </div>
      ) : null}
      <p className="text-xs font-semibold" data-slot="editor-panel-state-title">
        {title}
      </p>
      {description ? (
        <p
          className="mt-1 max-w-56 text-xs leading-4 text-muted-foreground"
          data-slot="editor-panel-state-description"
        >
          {description}
        </p>
      ) : null}
      {children ? (
        <div
          className="mt-3 flex flex-wrap items-center justify-center gap-2"
          data-slot="editor-panel-state-actions"
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}

export {
  EditorPanelHeader,
  EditorPanelNotice,
  EditorPanelSectionHeader,
  EditorPanelState,
  EditorPanelTabsList,
}
