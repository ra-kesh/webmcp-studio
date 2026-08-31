import { useId } from "react"
import type { ReactNode } from "react"
import type {
  ProductAppMenu,
  ProductCommandInvocation,
  ProductCommandRunResult,
  ProductMenuGroup,
  ProductMenuItem,
  ResolvedProductCommand,
} from "@webmcp/editor/product-commands"
import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "@webmcp/ui/components/menubar"
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@webmcp/ui/components/context-menu"
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@webmcp/ui/components/dropdown-menu"

export type ProductCommandMenuRuntime = Readonly<{
  run: (invocation: ProductCommandInvocation) => ProductCommandRunResult
  shortcut: (commandId: ProductCommandInvocation["commandId"]) => string | null
}>

export const productCommandMenuDensity = {
  desktopItem: "min-h-7 py-1 text-xs leading-4",
  compactItem:
    "min-h-11 py-2 text-xs leading-4 min-[1280px]:min-h-7 min-[1280px]:py-1 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:py-2",
  shortcut: "font-mono text-[11px] tracking-normal",
} as const

function CommandLabel({
  command,
  descriptionId,
}: {
  command: ResolvedProductCommand
  descriptionId?: string
}) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate">{command.label}</span>
      {!command.enabled && command.disabledReason ? (
        <span
          id={descriptionId}
          className="block max-w-72 text-[11px] leading-4 whitespace-normal text-muted-foreground"
        >
          {command.disabledReason}
        </span>
      ) : null}
    </span>
  )
}

function groupItems(groups: readonly ProductMenuGroup[]) {
  return groups.flatMap((group, index) => [
    ...(index > 0 ? ([{ type: "separator" }] as const) : []),
    ...group.items,
  ])
}

function MenuCommandItem({
  command,
  runtime,
  kind,
}: {
  command: ResolvedProductCommand
  runtime: ProductCommandMenuRuntime
  kind: "menubar" | "context"
}) {
  const descriptionId = useId()
  const shortcut = runtime.shortcut(command.invocation.commandId)
  const common = {
    disabled: !command.enabled,
    "data-command-id": command.invocation.commandId,
    "aria-describedby":
      !command.enabled && command.disabledReason ? descriptionId : undefined,
    onSelect: () => runtime.run(command.invocation),
  }
  if (kind === "menubar") {
    if (command.checked !== undefined) {
      return (
        <MenubarCheckboxItem
          className={productCommandMenuDensity.desktopItem}
          checked={
            command.checked === "mixed" ? "indeterminate" : command.checked
          }
          {...common}
        >
          <CommandLabel command={command} descriptionId={descriptionId} />
          {shortcut ? (
            <MenubarShortcut className={productCommandMenuDensity.shortcut}>
              {shortcut}
            </MenubarShortcut>
          ) : null}
        </MenubarCheckboxItem>
      )
    }
    return (
      <MenubarItem
        className={productCommandMenuDensity.desktopItem}
        variant={command.definition.destructive ? "destructive" : "default"}
        {...common}
      >
        <CommandLabel command={command} descriptionId={descriptionId} />
        {shortcut ? (
          <MenubarShortcut className={productCommandMenuDensity.shortcut}>
            {shortcut}
          </MenubarShortcut>
        ) : null}
      </MenubarItem>
    )
  }

  if (command.checked !== undefined) {
    return (
      <ContextMenuCheckboxItem
        className={productCommandMenuDensity.desktopItem}
        checked={
          command.checked === "mixed" ? "indeterminate" : command.checked
        }
        {...common}
      >
        <CommandLabel command={command} descriptionId={descriptionId} />
        {shortcut ? (
          <ContextMenuShortcut className={productCommandMenuDensity.shortcut}>
            {shortcut}
          </ContextMenuShortcut>
        ) : null}
      </ContextMenuCheckboxItem>
    )
  }
  return (
    <ContextMenuItem
      className={productCommandMenuDensity.desktopItem}
      variant={command.definition.destructive ? "destructive" : "default"}
      {...common}
    >
      <CommandLabel command={command} descriptionId={descriptionId} />
      {shortcut ? (
        <ContextMenuShortcut className={productCommandMenuDensity.shortcut}>
          {shortcut}
        </ContextMenuShortcut>
      ) : null}
    </ContextMenuItem>
  )
}

function DropdownProductCommandItem({
  command,
  runtime,
}: {
  command: ResolvedProductCommand
  runtime: ProductCommandMenuRuntime
}) {
  const descriptionId = useId()
  const shortcut = runtime.shortcut(command.invocation.commandId)
  const common = {
    disabled: !command.enabled,
    "data-command-id": command.invocation.commandId,
    "aria-describedby":
      !command.enabled && command.disabledReason ? descriptionId : undefined,
    onSelect: () => runtime.run(command.invocation),
  }
  const content = (
    <>
      <CommandLabel command={command} descriptionId={descriptionId} />
      {shortcut ? (
        <DropdownMenuShortcut className={productCommandMenuDensity.shortcut}>
          {shortcut}
        </DropdownMenuShortcut>
      ) : null}
    </>
  )
  return command.checked !== undefined ? (
    <DropdownMenuCheckboxItem
      className={productCommandMenuDensity.compactItem}
      checked={command.checked === "mixed" ? "indeterminate" : command.checked}
      {...common}
    >
      {content}
    </DropdownMenuCheckboxItem>
  ) : (
    <DropdownMenuItem
      className={productCommandMenuDensity.compactItem}
      variant={command.definition.destructive ? "destructive" : "default"}
      {...common}
    >
      {content}
    </DropdownMenuItem>
  )
}

function renderMenuItems(
  items: readonly ProductMenuItem[],
  runtime: ProductCommandMenuRuntime,
  kind: "menubar" | "context",
  keyPrefix: string
): ReactNode[] {
  return items.map((item, index) => {
    const key = `${keyPrefix}-${item.type}-${index}`
    if (item.type === "separator") {
      return kind === "menubar" ? (
        <MenubarSeparator key={key} />
      ) : (
        <ContextMenuSeparator key={key} />
      )
    }
    if (item.type === "explanation") {
      return (
        <div
          key={key}
          className="max-w-72 px-2 py-1.5 text-xs leading-4 text-muted-foreground"
        >
          {item.text}
        </div>
      )
    }
    if (item.type === "command") {
      return (
        <MenuCommandItem
          key={`${key}-${item.command.invocation.commandId}`}
          command={item.command}
          runtime={runtime}
          kind={kind}
        />
      )
    }
    if (kind === "menubar") {
      return (
        <MenubarSub key={`${key}-${item.id}`}>
          <MenubarSubTrigger className={productCommandMenuDensity.desktopItem}>
            {item.label}
          </MenubarSubTrigger>
          <MenubarSubContent className="min-w-56">
            {renderMenuItems(item.items, runtime, kind, `${key}-${item.id}`)}
          </MenubarSubContent>
        </MenubarSub>
      )
    }
    return (
      <ContextMenuSub key={`${key}-${item.id}`}>
        <ContextMenuSubTrigger
          className={productCommandMenuDensity.desktopItem}
        >
          {item.label}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="min-w-56">
          {renderMenuItems(item.items, runtime, kind, `${key}-${item.id}`)}
        </ContextMenuSubContent>
      </ContextMenuSub>
    )
  })
}

function renderDropdownItems(
  items: readonly ProductMenuItem[],
  runtime: ProductCommandMenuRuntime,
  keyPrefix: string
): ReactNode[] {
  return items.map((item, index) => {
    const key = `${keyPrefix}-${item.type}-${index}`
    if (item.type === "separator") {
      return <DropdownMenuSeparator key={key} />
    }
    if (item.type === "explanation") {
      return (
        <div
          key={key}
          className="max-w-72 px-2 py-1.5 text-xs leading-4 text-muted-foreground"
        >
          {item.text}
        </div>
      )
    }
    if (item.type === "submenu") {
      return (
        <DropdownMenuSub key={`${key}-${item.id}`}>
          <DropdownMenuSubTrigger
            className={productCommandMenuDensity.compactItem}
          >
            {item.label}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-56">
            {renderDropdownItems(item.items, runtime, `${key}-${item.id}`)}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )
    }

    return (
      <DropdownProductCommandItem
        key={`${key}-${item.command.invocation.commandId}`}
        command={item.command}
        runtime={runtime}
      />
    )
  })
}

export function ProductCommandMenubar({
  menus,
  runtime,
}: {
  menus: readonly ProductAppMenu[]
  runtime: ProductCommandMenuRuntime
}) {
  return (
    <Menubar
      aria-label="Application menu"
      className="h-7 shrink-0 gap-0 border-0 bg-transparent p-0"
    >
      {menus.map((menu) => (
        <MenubarMenu key={menu.id}>
          <MenubarTrigger className="h-7 px-2 text-xs font-normal">
            {menu.label}
          </MenubarTrigger>
          <MenubarContent className="min-w-64">
            {renderMenuItems(
              groupItems(menu.groups),
              runtime,
              "menubar",
              menu.id
            )}
          </MenubarContent>
        </MenubarMenu>
      ))}
    </Menubar>
  )
}

export function ProductCommandContextMenu({
  groups,
  runtime,
  children,
  onOpenChange,
}: {
  groups: readonly ProductMenuGroup[]
  runtime: ProductCommandMenuRuntime
  children: ReactNode
  onOpenChange?: (open: boolean) => void
}) {
  return (
    <ContextMenu onOpenChange={onOpenChange}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-64">
        {renderMenuItems(groupItems(groups), runtime, "context", "context")}
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function ProductCommandDropdownGroups({
  menus,
  runtime,
}: {
  menus: readonly ProductAppMenu[]
  runtime: ProductCommandMenuRuntime
}) {
  return menus.map((menu) => (
    <DropdownMenuSub key={menu.id}>
      <DropdownMenuSubTrigger className={productCommandMenuDensity.compactItem}>
        {menu.label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-64">
        {renderDropdownItems(
          groupItems(menu.groups),
          runtime,
          `dropdown-${menu.id}`
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  ))
}

export function ResponsiveProductCommandDropdownGroups({
  menus,
  runtime,
}: {
  menus: readonly ProductAppMenu[]
  runtime: ProductCommandMenuRuntime
}) {
  const responsiveMenus = responsiveProductCommandMenus(menus)

  return (
    <>
      <div className="min-[640px]:hidden" data-compact-product-menus>
        <ProductCommandDropdownGroups
          menus={responsiveMenus.compact}
          runtime={runtime}
        />
      </div>
      <div className="hidden min-[640px]:contents" data-desktop-product-menus>
        <ProductCommandDropdownGroups
          menus={responsiveMenus.desktop}
          runtime={runtime}
        />
      </div>
    </>
  )
}

export function responsiveProductCommandMenus(
  menus: readonly ProductAppMenu[]
) {
  return {
    compact: menus.filter((menu) => menu.id !== "text"),
    desktop: menus,
  } as const
}

export function ProductCommandDropdownItems({
  groups,
  runtime,
}: {
  groups: readonly ProductMenuGroup[]
  runtime: ProductCommandMenuRuntime
}) {
  return renderDropdownItems(groupItems(groups), runtime, "dropdown-items")
}
