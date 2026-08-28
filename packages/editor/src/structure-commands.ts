export const documentStructureCommandIds = [
  "page.add",
  "page.duplicate",
  "page.update",
  "page.remove",
  "page.move-up",
  "page.move-down",
  "output.add",
  "output.update",
  "output.remove",
] as const

export type DocumentStructureCommandId =
  (typeof documentStructureCommandIds)[number]

export type DocumentStructureCommandContext = {
  reviewPending: boolean
  outputCount: number
  outputPageCount: number
  pageIndex?: number
}

export function isDocumentStructureCommandEnabled(
  commandId: DocumentStructureCommandId,
  context: DocumentStructureCommandContext
) {
  if (context.reviewPending) return false

  switch (commandId) {
    case "page.remove":
      return context.outputPageCount > 1
    case "page.move-up":
      return context.pageIndex !== undefined && context.pageIndex > 0
    case "page.move-down":
      return (
        context.pageIndex !== undefined &&
        context.pageIndex < context.outputPageCount - 1
      )
    case "output.remove":
      return context.outputCount > 1
    default:
      return true
  }
}
