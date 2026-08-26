import { describe, expect, it } from "vitest"
import { northstarSeed, type ChangeSet } from "@webmcp/document"
import { registerStudioWebMcpTools, type WebMcpTool } from "../src"

function setup() {
  const registered = new Map<string, WebMcpTool>()
  let proposed: ChangeSet | null = null
  const controller = new AbortController()
  const services = {
    getSnapshot: () => ({
      document: northstarSeed,
      activePageId: "cover",
      selection: null,
      pendingChangeSet: proposed,
    }),
    proposeChangeSet: (changeSet: ChangeSet) => {
      proposed = changeSet
      return changeSet
    },
    id: (() => {
      let sequence = 0
      return () => String(++sequence)
    })(),
    now: () => "2026-08-26T10:00:00.000Z",
  }
  return { registered, controller, services, proposed: () => proposed }
}

describe("WebMCP registration", () => {
  it("registers current-state inspection, validation, and proposal tools", async () => {
    const state = setup()
    const count = await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    expect(count).toBe(3)
    expect([...state.registered.keys()]).toEqual([
      "inspect_design",
      "validate_design",
      "propose_field_updates",
    ])

    const inspected = await state.registered.get("inspect_design")?.execute({})
    expect(inspected?.structuredContent).toMatchObject({
      document: { id: northstarSeed.id, revision: northstarSeed.revision },
      activePage: { id: "cover" },
    })
  })

  it("creates a pending preview through the registered proposal handler", async () => {
    const state = setup()
    await registerStudioWebMcpTools(
      {
        registerTool: async (tool) => {
          state.registered.set(tool.name, tool)
          return undefined
        },
      },
      state.services,
      state.controller.signal
    )

    const result = await state.registered
      .get("propose_field_updates")
      ?.execute({
        documentId: northstarSeed.id,
        baseRevision: northstarSeed.revision,
        reason: "Adapt the pack for a smaller celebration",
        values: {
          package_name: "The Saffron Weekend",
          package_price: "₹4,10,000",
        },
      })

    expect(result?.isError).toBeUndefined()
    expect(state.proposed()).toMatchObject({
      status: "pending",
      title: "Adapt the pack for a smaller celebration",
      operations: [
        { command: { type: "set_field", value: "The Saffron Weekend" } },
        { command: { type: "set_field", value: "₹4,10,000" } },
      ],
    })
    expect(result?.content[0]?.text).toContain("nothing has been applied")
  })
})
