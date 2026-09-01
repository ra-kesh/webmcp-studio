import { describe, expect, it } from "vitest"
import { quotationStarter } from "./quotation-starter"
import { buildMultiArtboardPageSyncIdentities } from "./multi-artboard-page-sync"

describe("buildMultiArtboardPageSyncIdentities", () => {
  it("changes only the page that owns a page-local node edit", () => {
    const document = structuredClone(quotationStarter.document)
    const before = buildMultiArtboardPageSyncIdentities(document)
    const editedNode = document.nodes.find((node) =>
      document.pages[1]?.nodeIds.includes(node.id)
    )
    expect(editedNode).toBeDefined()
    if (!editedNode) return
    editedNode.x += 12
    document.revision += 1
    const after = buildMultiArtboardPageSyncIdentities(document)

    for (const page of document.pages) {
      if (page.id === document.pages[1]?.id) {
        expect(after.get(page.id)).not.toBe(before.get(page.id))
      } else {
        expect(after.get(page.id)).toBe(before.get(page.id))
      }
    }
  })

  it("tracks page structure and group changes without using camera state", () => {
    const document = structuredClone(quotationStarter.document)
    const before = buildMultiArtboardPageSyncIdentities(document)
    const page = document.pages[0]!
    page.name = "Renamed cover"
    const pageChanged = buildMultiArtboardPageSyncIdentities(document)
    expect(pageChanged.get(page.id)).not.toBe(before.get(page.id))

    const group = document.groups.find(
      (candidate) => candidate.pageId === page.id
    )
    expect(group).toBeDefined()
    if (!group) return
    group.name = "Renamed group"
    const groupChanged = buildMultiArtboardPageSyncIdentities(document)
    expect(groupChanged.get(page.id)).not.toBe(pageChanged.get(page.id))
  })
})
