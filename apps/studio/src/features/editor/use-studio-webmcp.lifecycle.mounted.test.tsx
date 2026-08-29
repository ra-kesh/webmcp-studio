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
import type { WebMcpModelContext, WebMcpTool } from "@webmcp/webmcp"
import { studioAssets } from "./asset-catalog"
import {
  useStudioWebMcp,
  WEBMCP_REGISTRATION_TIMEOUT_MS,
} from "./use-studio-webmcp"

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
  getProductCommandContext: () => null,
  runProductCommand: vi.fn(() => ({ status: "accepted" as const })),
  proposeChangeSet: vi.fn(),
  publishTemplate: vi.fn(),
  renderTemplate: vi.fn(),
}

function MountedWebMcp({
  enabled,
  mutationDisabledReason = null,
  capture,
}: {
  enabled: boolean
  mutationDisabledReason?: string | null
  capture: (result: ReturnType<typeof useStudioWebMcp>) => void
}) {
  const result = useStudioWebMcp(
    { ...services, mutationDisabledReason },
    { enabled }
  )
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
    vi.clearAllMocks()
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

  it("keeps registered mutations disabled while a document transition is in flight", async () => {
    const registeredTools = new Map<string, WebMcpTool>()
    const modelContext: WebMcpModelContext = {
      registerTool: async (tool) => {
        registeredTools.set(tool.name, tool)
        return undefined
      },
    }
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: modelContext,
    })
    const reason =
      "Wait for the new document to finish opening before editing this one."
    const render = (mutationDisabledReason: string | null) =>
      root.render(
        <MountedWebMcp
          enabled
          mutationDisabledReason={mutationDisabledReason}
          capture={() => undefined}
        />
      )

    await act(async () => {
      render(null)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(registeredTools.size).toBe(toolNames.length)

    await act(async () => render(reason))

    const proposal = await registeredTools
      .get("propose_field_updates")
      ?.execute({
        documentId: northstarSeed.id,
        baseRevision: northstarSeed.revision,
        baseSnapshotId: services.snapshotId,
        values: { couple_names: "Transition race" },
      })
    const publication = await registeredTools.get("publish_template")?.execute({
      documentId: northstarSeed.id,
      expectedRevision: northstarSeed.revision,
      expectedSnapshotId: services.snapshotId,
    })

    expect(proposal).toMatchObject({ isError: true })
    expect(proposal?.content[0]?.text).toContain(reason)
    expect(publication).toMatchObject({ isError: true })
    expect(publication?.content[0]?.text).toContain(reason)
    expect(services.proposeChangeSet).not.toHaveBeenCalled()
    expect(services.publishTemplate).not.toHaveBeenCalled()
    expect(services.runProductCommand).not.toHaveBeenCalled()
    expect(services.renderTemplate).not.toHaveBeenCalled()
  })

  it("cancels an in-flight managed asset proposal when registration ends", async () => {
    const registeredTools = new Map<string, WebMcpTool>()
    const modelContext: WebMcpModelContext = {
      registerTool: async (tool) => {
        registeredTools.set(tool.name, tool)
        return undefined
      },
    }
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: modelContext,
    })
    const managedAssetId = "asset-0123456789abcdef0123456789abcdef"
    let observedSignal: AbortSignal | undefined
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation((_input, init) => {
        observedSignal = init?.signal ?? undefined
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            {
              once: true,
            }
          )
        })
      })
    vi.stubGlobal("fetch", fetchMock)
    const render = (enabled: boolean) =>
      root.render(<MountedWebMcp enabled={enabled} capture={() => undefined} />)

    await act(async () => {
      render(true)
      await Promise.resolve()
      await Promise.resolve()
    })

    const pending = registeredTools.get("propose_asset_insertion")?.execute({
      documentId: northstarSeed.id,
      baseRevision: northstarSeed.revision,
      baseSnapshotId: services.snapshotId,
      pageId: northstarSeed.pages[0].id,
      assetId: managedAssetId,
      x: 20,
      y: 20,
      width: 100,
      height: 100,
      placement: {
        mode: "fill",
        focalX: 0.5,
        focalY: 0.5,
        zoom: 1,
        rotation: 0,
        flipX: false,
        flipY: false,
      },
    })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())

    await act(async () => render(false))
    const result = await pending

    expect(observedSignal?.aborted).toBe(true)
    expect(result).toMatchObject({
      isError: true,
      structuredContent: { code: "execution_cancelled" },
    })
    expect(services.proposeChangeSet).not.toHaveBeenCalled()
  })

  it("threads registration teardown into an in-flight publication", async () => {
    const registeredTools = new Map<string, WebMcpTool>()
    const modelContext: WebMcpModelContext = {
      registerTool: async (tool) => {
        registeredTools.set(tool.name, tool)
        return undefined
      },
    }
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: modelContext,
    })
    let observedSignal: AbortSignal | undefined
    services.publishTemplate.mockImplementationOnce((_expected, options) => {
      observedSignal = options?.signal
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => reject(options.signal?.reason),
          { once: true }
        )
      })
    })
    const render = (enabled: boolean) =>
      root.render(<MountedWebMcp enabled={enabled} capture={() => undefined} />)

    await act(async () => {
      render(true)
      await Promise.resolve()
      await Promise.resolve()
    })
    const pending = registeredTools.get("publish_template")?.execute({
      documentId: northstarSeed.id,
      expectedRevision: northstarSeed.revision,
      expectedSnapshotId: services.snapshotId,
    })
    await vi.waitFor(() => expect(observedSignal).toBeDefined())

    await act(async () => render(false))
    const result = await pending

    expect(observedSignal?.aborted).toBe(true)
    expect(result).toMatchObject({
      isError: true,
      structuredContent: { code: "execution_status_unknown" },
    })
  })

  it("retires an old model context and registers the replacement", async () => {
    const firstTools = new Map<string, WebMcpTool>()
    const secondTools = new Map<string, WebMcpTool>()
    const firstSignals: AbortSignal[] = []
    const firstContext: WebMcpModelContext = {
      registerTool: async (tool, options) => {
        firstTools.set(tool.name, tool)
        if (options?.signal) firstSignals.push(options.signal)
        return undefined
      },
    }
    const secondContext: WebMcpModelContext = {
      registerTool: async (tool) => {
        secondTools.set(tool.name, tool)
        return undefined
      },
    }
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: firstContext,
    })

    await act(async () => {
      root.render(<MountedWebMcp enabled capture={() => undefined} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(firstTools.size).toBe(toolNames.length)
    const staleTool = firstTools.get("inspect_design")

    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: secondContext,
    })
    await act(
      () =>
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, 550)
        })
    )

    expect(firstSignals.every((signal) => signal.aborted)).toBe(true)
    expect(secondTools.size).toBe(toolNames.length)
    await expect(staleTool?.execute({})).resolves.toMatchObject({
      isError: true,
      structuredContent: { code: "execution_cancelled" },
    })
  })

  it("leaves a hung registration attempt with a finite retryable error", async () => {
    vi.useFakeTimers()
    try {
      const modelContext: WebMcpModelContext = {
        registerTool: () => new Promise<undefined>(() => undefined),
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
            capture={(next) => {
              result = next
            }}
          />
        )
        await Promise.resolve()
      })
      expect(result).toMatchObject({ status: "registering" })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(WEBMCP_REGISTRATION_TIMEOUT_MS + 1)
      })

      expect(result).toMatchObject({
        status: "error",
        error: "WebMCP tool registration timed out.",
        registeredToolCount: 0,
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
