import type { ProductCommandInvocation } from "@webmcp/editor/product-commands"

export type StudioCommandPaletteItem = Readonly<{
  id: string
  label: string
  category: string
  keywords: readonly string[]
  shortcut?: string | null
  enabled: boolean
  disabledReason?: string | null
  checked?: boolean | "mixed"
  run: () => boolean | Promise<boolean>
}>

export function productCommandInvocationKey(
  invocation: ProductCommandInvocation
) {
  const target = invocation.target
  const targetKey = target
    ? target.kind === "selection"
      ? `${target.kind}:${target.pageId}:${target.nodeIds.join(",")}`
      : target.kind === "node"
        ? `${target.kind}:${target.pageId}:${target.nodeId}`
        : target.kind === "group"
          ? `${target.kind}:${target.pageId}:${target.groupId}`
          : target.kind === "page"
            ? `${target.kind}:${target.pageId}`
            : target.kind === "output"
              ? `${target.kind}:${target.outputId}`
              : target.kind
    : "current"
  const argument = invocation.arguments
  const argumentKey = argument
    ? argument.kind === "alignment"
      ? `${argument.kind}:${argument.relativeTo}:${argument.alignment}`
      : argument.kind === "distribution"
        ? `${argument.kind}:${argument.distribution}`
        : argument.kind === "text-preset"
          ? `${argument.kind}:${argument.presetId}`
          : argument.kind
    : "none"
  return `${invocation.commandId}:${targetKey}:${argumentKey}`
}

const normalizeSearchText = (value: string) =>
  value.trim().toLocaleLowerCase().replaceAll(/\s+/g, " ")

export function filterStudioCommandPaletteItems(
  items: readonly StudioCommandPaletteItem[],
  query: string
) {
  const terms = normalizeSearchText(query).split(" ").filter(Boolean)
  if (terms.length === 0) return items

  return items.filter((item) => {
    const haystack = normalizeSearchText(
      [item.label, item.category, item.shortcut ?? "", ...item.keywords].join(
        " "
      )
    )
    return terms.every((term) => haystack.includes(term))
  })
}

export function groupStudioCommandPaletteItems(
  items: readonly StudioCommandPaletteItem[]
) {
  const groups = new Map<string, StudioCommandPaletteItem[]>()
  for (const item of items) {
    const group = groups.get(item.category)
    if (group) group.push(item)
    else groups.set(item.category, [item])
  }
  return [...groups.entries()].map(([category, commands]) => ({
    category,
    commands,
  }))
}
