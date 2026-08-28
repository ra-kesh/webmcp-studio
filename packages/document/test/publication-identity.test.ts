import { describe, expect, it } from "vitest"
import {
  createTemplateVersionFromPublishRequest,
  deriveDocumentSnapshotId,
  northstarSeed,
} from "../src"

describe("publication snapshot identity", () => {
  it("is stable for canonical content and changes across same-revision branches", async () => {
    const branchA = structuredClone(northstarSeed)
    const branchB = structuredClone(northstarSeed)
    const branchBTitle = branchB.nodes.find((node) => node.id === "cover-title")
    if (!branchBTitle) throw new Error("Cover title fixture is unavailable")
    branchBTitle.x += 24
    branchB.revision = branchA.revision

    const [first, clone, second] = await Promise.all([
      deriveDocumentSnapshotId(branchA),
      deriveDocumentSnapshotId(structuredClone(branchA)),
      deriveDocumentSnapshotId(branchB),
    ])

    expect(first).toMatch(/^sha256-[a-f0-9]{64}$/)
    expect(clone).toBe(first)
    expect(second).not.toBe(first)
  })

  it("derives identity on the trusted publication boundary", async () => {
    const document = structuredClone(northstarSeed)
    const version = await createTemplateVersionFromPublishRequest({
      id: "server-derived-publication",
      templateId: "northstar",
      version: 1,
      publishedAt: "2026-08-28T00:00:00.000Z",
      document,
    })

    expect(version.sourceSnapshotId).toBe(
      await deriveDocumentSnapshotId(document)
    )
    document.name = "Mutated after publication"
    expect(version.document.name).toBe(northstarSeed.name)
  })
})
