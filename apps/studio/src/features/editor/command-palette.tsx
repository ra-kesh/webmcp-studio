import { useId, useMemo, useState } from "react"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@webmcp/ui/components/command"
import {
  filterStudioCommandPaletteItems,
  groupStudioCommandPaletteItems,
} from "./command-palette-model"
import type { StudioCommandPaletteItem } from "./command-palette-model"

export type { StudioCommandPaletteItem } from "./command-palette-model"
export {
  filterStudioCommandPaletteItems,
  groupStudioCommandPaletteItems,
  productCommandInvocationKey,
} from "./command-palette-model"

function CommandPaletteRow({
  item,
  onAccepted,
}: {
  item: StudioCommandPaletteItem
  onAccepted: () => void
}) {
  const descriptionId = useId()
  return (
    <CommandItem
      value={item.id}
      disabled={!item.enabled}
      data-checked={item.checked === true || undefined}
      aria-checked={item.checked}
      aria-describedby={
        !item.enabled && item.disabledReason ? descriptionId : undefined
      }
      onSelect={() => {
        if (!item.enabled) return
        void Promise.resolve(item.run()).then((accepted) => {
          if (accepted) onAccepted()
        })
      }}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate">{item.label}</span>
        {!item.enabled && item.disabledReason ? (
          <span
            id={descriptionId}
            className="block text-xs leading-4 whitespace-normal text-muted-foreground"
          >
            {item.disabledReason}
          </span>
        ) : null}
      </span>
      {item.checked === "mixed" ? (
        <span className="text-xs text-muted-foreground">Mixed</span>
      ) : item.shortcut ? (
        <CommandShortcut>{item.shortcut}</CommandShortcut>
      ) : null}
    </CommandItem>
  )
}

export function StudioCommandPalette({
  open,
  onOpenChange,
  items,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: readonly StudioCommandPaletteItem[]
}) {
  const [query, setQuery] = useState("")
  const visibleItems = useMemo(
    () => filterStudioCommandPaletteItems(items, query),
    [items, query]
  )
  const groups = useMemo(
    () => groupStudioCommandPaletteItems(visibleItems),
    [visibleItems]
  )
  const resultLabel = `${visibleItems.length} ${
    visibleItems.length === 1 ? "command" : "commands"
  }`

  return (
    <CommandDialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen)
        if (!nextOpen) setQuery("")
      }}
      title="Command search"
      description="Search the commands available in the current editor context."
      className="max-w-xl"
    >
      <Command shouldFilter={false} loop>
        <CommandInput
          aria-label="Search commands"
          autoFocus
          placeholder="Search commands…"
          value={query}
          onValueChange={setQuery}
        />
        <span className="sr-only" aria-live="polite" aria-atomic="true">
          {resultLabel}
        </span>
        <CommandList className="max-h-[min(28rem,60vh)]">
          <CommandEmpty>No matching commands</CommandEmpty>
          {groups.map((group, groupIndex) => (
            <div key={group.category}>
              {groupIndex > 0 ? <CommandSeparator /> : null}
              <CommandGroup heading={group.category}>
                {group.commands.map((item) => (
                  <CommandPaletteRow
                    key={item.id}
                    item={item}
                    onAccepted={() => onOpenChange(false)}
                  />
                ))}
              </CommandGroup>
            </div>
          ))}
        </CommandList>
        <div className="flex h-9 items-center justify-between border-t px-3 text-[11px] text-muted-foreground">
          <span>{resultLabel}</span>
          <span>Enter to run · Esc to close</span>
        </div>
      </Command>
    </CommandDialog>
  )
}
