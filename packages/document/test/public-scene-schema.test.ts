import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  documentCommandSchema,
  documentSchema,
  northstarSeed,
  readPublicSceneSchema,
  sceneNodeSchema,
  sceneTransactionSchema,
} from "../src"

describe("public scene schemas", () => {
  it("derives the public command and node contracts from canonical schemas", () => {
    const command = {
      id: "command-public-schema",
      type: "add_node",
      actor: "agent",
      at: "2026-09-02T08:00:00.000Z",
      pageId: northstarSeed.pages[0]!.id,
      node: structuredClone(northstarSeed.nodes[0]!),
    }
    const transaction = {
      version: 1,
      id: "transaction-public-schema",
      idempotencyKey: "public-schema",
      title: "Create canonical layer",
      mode: "review",
      expected: {
        documentId: northstarSeed.id,
        revision: northstarSeed.revision,
        snapshotId: "snapshot-public-schema",
        operationVersion: 0,
      },
      commands: [command],
    }

    expect(documentCommandSchema.safeParse(command).success).toBe(true)
    expect(sceneNodeSchema.safeParse(command.node).success).toBe(true)
    expect(sceneTransactionSchema.safeParse(transaction).success).toBe(true)
    expect(JSON.stringify(readPublicSceneSchema("command").schema)).toContain(
      '"add_node"'
    )
    expect(JSON.stringify(readPublicSceneSchema("node").schema)).toContain(
      '"frame"'
    )
    expect(
      JSON.stringify(readPublicSceneSchema("transaction").schema)
    ).toContain('"idempotencyKey"')
    expect(readPublicSceneSchema("command").schema).toEqual(
      z.toJSONSchema(documentCommandSchema, {
        target: "draft-7",
        reused: "ref",
      })
    )
    expect(readPublicSceneSchema("node").schema).toEqual(
      z.toJSONSchema(sceneNodeSchema, { target: "draft-7", reused: "ref" })
    )
    expect(readPublicSceneSchema("transaction").schema).toEqual(
      z.toJSONSchema(sceneTransactionSchema, {
        target: "draft-7",
        reused: "ref",
      })
    )
    expect(readPublicSceneSchema("document").schema).toEqual(
      z.toJSONSchema(documentSchema, { target: "draft-7", reused: "ref" })
    )
    expect(JSON.stringify(readPublicSceneSchema("document").schema)).toContain(
      '"sceneTransactionMetadata"'
    )
  })
})
