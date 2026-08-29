// @vitest-environment jsdom

import { webcrypto } from "node:crypto"
import { act, useLayoutEffect } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { northstarSeed } from "@webmcp/document"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { toolNames } from "@webmcp/webmcp"
import type { WebMcpModelContext } from "@webmcp/webmcp"
import { studioAssets } from "./asset-catalog"
import { useStudioWebMcp } from "./use-studio-webmcp"

const services = {
  document: northstarSeed,
  snapshotId: "webmcp-lifecycle-snapshot",
  operationVersion: 0,
  activePageId: northstarSeed.pages[0].id,
  selection: null,
  pendingChangeSet: null,
  assets: studioAssets,
  publishedVersion: null,
  renderHistory: [],
  getCommandCapabilities: () => [],
  proposeChangeSet: vi.fn(),
  publishTemplate: vi.fn(),
  renderTemplate: vi.fn(),
}

function MountedWebMcp({
  enabled,
  capture,
}: {
  enabled: boolean
  capture: (result: ReturnType<typeof useStudioWebMcp>) => void
}) {
  const result = useStudioWebMcp(services, { enabled })
  useLayoutEffect(() => capture(result))
  return null
}

describe("useStudioWebMcp lifecycle", () => {
  let host: HTMLDivElement
  let root: Root

  beforeAll(() => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    })
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  })

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: undefined,
    })
    vi.restoreAllMocks()
  })

  it("aborts every registered tool when the editor returns to the start surface", async () => {
    const signals: AbortSignal[] = []
    const modelContext: WebMcpModelContext = {
      registerTool: async (_tool, options) => {
        if (!options?.signal) throw new Error("Expected a registration signal")
        signals.push(options.signal)
        return undefined
      },
    }
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: modelContext,
    })
    let status: ReturnType<typeof useStudioWebMcp>["status"] = "unavailable"
    let registeredToolCount = 0
    const render = (enabled: boolean) =>
      root.render(
        <MountedWebMcp
          enabled={enabled}
          capture={(result) => {
            status = result.status
            registeredToolCount = result.registeredToolCount
          }}
        />
      )

    await act(async () => {
      render(true)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(status).toBe("ready")
    expect(registeredToolCount).toBe(toolNames.length)
    expect(signals).toHaveLength(toolNames.length)
    expect(signals.every((signal) => !signal.aborted)).toBe(true)

    await act(async () => render(false))

    expect(status).toBe("unavailable")
    expect(registeredToolCount).toBe(0)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
  })

  it("aborts a partially registered tool set when one registration fails", async () => {
    const signals: AbortSignal[] = []
    const modelContext: WebMcpModelContext = {
      registerTool: async (tool, options) => {
        if (!options?.signal) throw new Error("Expected a registration signal")
        signals.push(options.signal)
        if (tool.name === "read_design_node") {
          throw new Error("Registration refused")
        }
        return undefined
      },
    }
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: modelContext,
    })
    let result: ReturnType<typeof useStudioWebMcp> | null = null

    await act(async () => {
      root.render(
        <MountedWebMcp
          enabled
          capture={(nextResult) => {
            result = nextResult
          }}
        />
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result).toMatchObject({
      status: "error",
      error: "Registration refused",
      registeredToolCount: 0,
    })
    expect(signals).toHaveLength(toolNames.length)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
  })
})
