import { useState } from "react"
import {
  Check,
  Eye,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Unlink,
} from "lucide-react"

import { Button } from "@webmcp/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@webmcp/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@webmcp/ui/components/dropdown-menu"
import { Input } from "@webmcp/ui/components/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@webmcp/ui/components/select"

const NONE = "__none__"
const MIXED = "__mixed__"

export type ReusableStyleOption = Readonly<{
  id: string
  name: string
}>

export type ReusableStyleUsageNode = Readonly<{
  id: string
  name: string
}>

export function ReusableStyleField({
  label,
  value,
  styles,
  usageNodes,
  attachmentCount,
  rangeAttachmentCount,
  disabled = false,
  onApply,
  onCreate,
  onRename,
  onUpdateFromSelection,
  onDelete,
  onFocusNode,
}: {
  label: string
  value: string | null | "mixed"
  styles: readonly ReusableStyleOption[]
  usageNodes: readonly ReusableStyleUsageNode[]
  attachmentCount: number
  rangeAttachmentCount: number
  disabled?: boolean
  onApply: (styleId: string | null) => boolean
  onCreate: (name: string) => string | null
  onRename: (styleId: string, name: string) => boolean
  onUpdateFromSelection: (styleId: string) => boolean
  onDelete: (styleId: string) => boolean
  onFocusNode: (nodeId: string) => void
}) {
  const [createOpen, setCreateOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [name, setName] = useState("")
  const activeStyle =
    typeof value === "string" && value !== "mixed"
      ? styles.find((style) => style.id === value)
      : undefined
  const missingStyleId =
    typeof value === "string" && value !== "mixed" && !activeStyle
      ? value
      : null
  const selectValue =
    value === "mixed" ? MIXED : typeof value === "string" ? value : NONE
  const usageLabel = `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}${rangeAttachmentCount ? ` · ${rangeAttachmentCount} text range${rangeAttachmentCount === 1 ? "" : "s"}` : ""}`

  const openCreate = () => {
    setName("")
    setCreateOpen(true)
  }
  const openRename = () => {
    if (!activeStyle) return
    setName(activeStyle.name)
    setRenameOpen(true)
  }

  return (
    <div className="flex flex-col gap-2" data-reusable-style-field={label}>
      <div className="flex items-end gap-1.5">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">
            {label}
          </span>
          <Select
            value={selectValue}
            disabled={disabled}
            onValueChange={(next) => {
              if (next === MIXED) return
              onApply(next === NONE ? null : next)
            }}
          >
            <SelectTrigger
              className="min-h-11 min-w-0 min-[1280px]:min-h-7"
              size="sm"
              aria-label={label}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {value === "mixed" ? (
                  <SelectItem value={MIXED} disabled>
                    Mixed styles
                  </SelectItem>
                ) : null}
                <SelectItem value={NONE}>No style</SelectItem>
                {styles.map((style) => (
                  <SelectItem key={style.id} value={style.id}>
                    {style.name}
                  </SelectItem>
                ))}
                {missingStyleId ? (
                  <SelectItem value={missingStyleId} disabled>
                    Missing style · {missingStyleId}
                  </SelectItem>
                ) : null}
              </SelectGroup>
            </SelectContent>
          </Select>
        </label>
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          className="size-11 shrink-0 min-[1280px]:size-7"
          aria-label={`Create ${label.toLocaleLowerCase()}`}
          disabled={disabled}
          onClick={openCreate}
        >
          <Plus />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="size-11 shrink-0 min-[1280px]:size-7"
              aria-label={`${label} actions`}
              disabled={disabled || !activeStyle}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="truncate">
              {activeStyle?.name}
            </DropdownMenuLabel>
            <DropdownMenuItem
              onSelect={() =>
                activeStyle && onUpdateFromSelection(activeStyle.id)
              }
            >
              <RefreshCw />
              Update from selection
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={openRename}>
              <Pencil />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!activeStyle}
              onSelect={() => activeStyle && onApply(null)}
            >
              <Unlink />
              Detach from selection
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={attachmentCount > 0}
              onSelect={() => activeStyle && onDelete(activeStyle.id)}
            >
              <Trash2 />
              {attachmentCount > 0 ? "Detach before deleting" : "Delete style"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {activeStyle ? (
        <div className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-muted/45 px-2 py-1.5">
          <span className="min-w-0 truncate text-[11px] text-muted-foreground">
            {usageLabel}
          </span>
          {usageNodes.length ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 px-1.5 text-[11px]"
                >
                  <Eye />
                  Show
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>Affected layers</DropdownMenuLabel>
                {usageNodes.map((node) => (
                  <DropdownMenuItem
                    key={node.id}
                    onSelect={() => onFocusNode(node.id)}
                  >
                    <Eye />
                    <span className="truncate">{node.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      ) : missingStyleId ? (
        <div className="rounded-md border border-amber-500/35 bg-amber-500/8 px-2 py-1.5 text-[11px] leading-4 text-muted-foreground">
          This attachment is missing. Detach it before applying another style.
        </div>
      ) : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Create {label.toLocaleLowerCase()}</DialogTitle>
            <DialogDescription>
              Save the current selection as a reusable document style.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            aria-label={`${label} name`}
            value={name}
            maxLength={120}
            placeholder={
              label === "Text style" ? "Editorial / Hero" : "Brand / Accent"
            }
            onChange={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !name.trim()) return
              const created = onCreate(name.trim())
              if (created) setCreateOpen(false)
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!name.trim()}
              onClick={() => {
                const created = onCreate(name.trim())
                if (created) setCreateOpen(false)
              }}
            >
              <Check />
              Create style
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename {label.toLocaleLowerCase()}</DialogTitle>
            <DialogDescription>
              Attachments keep the same stable style identity.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            aria-label={`Rename ${label.toLocaleLowerCase()}`}
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !name.trim() || !activeStyle) return
              if (onRename(activeStyle.id, name.trim())) setRenameOpen(false)
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!name.trim() || !activeStyle}
              onClick={() => {
                if (activeStyle && onRename(activeStyle.id, name.trim())) {
                  setRenameOpen(false)
                }
              }}
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
