// @vitest-environment jsdom

import { webcrypto } from "node:crypto"
import { act, useLayoutEffect } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import {
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { createTemplateVersion, northstarSeed } from "@webmcp/document"
import { useRenderHistory } from "./use-render-history"

type Controller = ReturnType<typeof useRenderHistory>

function MountedRenderHistory({
  capture,
}: {
  capture: (value: Controller) => void
}) {
  const version = createTemplateVersion(northstarSeed, {
    id: "render-lifecycle-version",
    templateId: "render-lifecycle-template",
    version: 1,
    sourceSnapshotId: `sha256-${"a".repeat(64)}`,
    publishedAt: "2026-08-30T00:00:00.000Z",
  })
  const value = useRenderHistory(version)
  useLayoutEffect(() => capture(value))
  return null
}

describe("render history lifecycle", () => {
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
    vi.restoreAllMocks()
  })

  it("retries an unknown render with the same server identity", async () => {
    const captured: { current: Controller | null } = { current: null }
    const requests: RequestInit[] = []
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation((_input, init) => {
        if (!init?.method) {
          return Promise.resolve(
            new Response(JSON.stringify({ data: [] }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
          )
        }
        requests.push(init)
        if (requests.length === 1) return new Promise<Response>(() => undefined)
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "render-server-authoritative",
              completedAt: "2026-08-30T00:00:01.000Z",
              artifacts: [],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        )
      })
    vi.stubGlobal("fetch", fetchMock)
    await act(async () => {
      root.render(
        <MountedRenderHistory
          capture={(value) => {
            captured.current = value
          }}
        />
      )
      await Promise.resolve()
    })
    if (!captured.current) throw new Error("Expected render history controller")
    const selection = [
      { outputId: northstarSeed.outputs[0].id, format: "pdf" as const },
    ]
    const controller = new AbortController()
    let first: Awaited<ReturnType<Controller["runRender"]>> | undefined
    await act(async () => {
      const pending = captured.current!.runRender(
        createTemplateVersion(northstarSeed, {
          id: "render-lifecycle-version",
          templateId: "render-lifecycle-template",
          version: 1,
          sourceSnapshotId: `sha256-${"a".repeat(64)}`,
          publishedAt: "2026-08-30T00:00:00.000Z",
        }),
        {},
        selection,
        { signal: controller.signal, idempotencyKey: "webmcp-render-retry" }
      )
      controller.abort()
      first = await pending
    })
    expect(first?.status).toBe("status_unknown")

    let second: Awaited<ReturnType<Controller["runRender"]>> | undefined
    await act(async () => {
      second = await captured.current!.runRender(
        createTemplateVersion(northstarSeed, {
          id: "render-lifecycle-version",
          templateId: "render-lifecycle-template",
          version: 1,
          sourceSnapshotId: `sha256-${"a".repeat(64)}`,
          publishedAt: "2026-08-30T00:00:00.000Z",
        }),
        {},
        selection,
        { idempotencyKey: "webmcp-render-retry" }
      )
    })

    expect(second?.status).toBe("completed")
    expect(
      requests
        .map((request) => request.headers)
        .map((headers) => new Headers(headers).get("Idempotency-Key"))
    ).toEqual(["webmcp-render-retry", "webmcp-render-retry"])
    expect(
      captured.current.records.filter(
        (record) => record.id === "render-server-authoritative"
      )
    ).toHaveLength(1)
  })

  it("reconciles a transport-unknown render with the same idempotency key", async () => {
    const captured: { current: Controller | null } = { current: null }
    const keys: Array<string | null> = []
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation((_input, init) => {
        if (!init?.method) {
          return Promise.resolve(
            new Response(JSON.stringify({ data: [] }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
          )
        }
        keys.push(new Headers(init.headers).get("Idempotency-Key"))
        if (keys.length === 1) {
          return Promise.reject(new TypeError("Connection reset"))
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "render-server-after-network-loss",
              completedAt: "2026-08-30T00:00:01.000Z",
              artifacts: [],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        )
      })
    vi.stubGlobal("fetch", fetchMock)

    await act(async () => {
      root.render(
        <MountedRenderHistory
          capture={(value) => {
            captured.current = value
          }}
        />
      )
      await Promise.resolve()
    })
    if (!captured.current) throw new Error("Expected render history controller")
    const version = createTemplateVersion(northstarSeed, {
      id: "render-lifecycle-version",
      templateId: "render-lifecycle-template",
      version: 1,
      sourceSnapshotId: `sha256-${"a".repeat(64)}`,
      publishedAt: "2026-08-30T00:00:00.000Z",
    })
    const selections = [
      { outputId: northstarSeed.outputs[0].id, format: "pdf" as const },
    ]

    let first: Awaited<ReturnType<Controller["runRender"]>> | undefined
    await act(async () => {
      first = await captured.current!.runRender(version, {}, selections, {
        idempotencyKey: "webmcp-render-network-loss",
      })
    })
    expect(first?.status).toBe("status_unknown")

    let second: Awaited<ReturnType<Controller["runRender"]>> | undefined
    await act(async () => {
      second = await captured.current!.runRender(version, {}, selections, {
        idempotencyKey: "webmcp-render-network-loss",
      })
    })

    expect(second?.status).toBe("completed")
    expect(keys).toEqual([
      "webmcp-render-network-loss",
      "webmcp-render-network-loss",
    ])
    expect(
      captured.current.records.filter(
        (record) => record.id === "render-server-after-network-loss"
      )
    ).toHaveLength(1)
  })

  it("deduplicates a restored server row when the matching render completes", async () => {
    const captured: { current: Controller | null } = { current: null }
    let resolveHistory: ((response: Response) => void) | undefined
    let resolveRender: ((response: Response) => void) | undefined
    const history = new Promise<Response>((resolve) => {
      resolveHistory = resolve
    })
    const render = new Promise<Response>((resolve) => {
      resolveRender = resolve
    })
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation((_input, init) => (init?.method ? render : history))
    vi.stubGlobal("fetch", fetchMock)

    await act(async () => {
      root.render(
        <MountedRenderHistory
          capture={(value) => {
            captured.current = value
          }}
        />
      )
      await Promise.resolve()
    })
    if (!captured.current) throw new Error("Expected render history controller")
    const version = createTemplateVersion(northstarSeed, {
      id: "render-lifecycle-version",
      templateId: "render-lifecycle-template",
      version: 1,
      sourceSnapshotId: `sha256-${"a".repeat(64)}`,
      publishedAt: "2026-08-30T00:00:00.000Z",
    })
    const selections = [
      { outputId: northstarSeed.outputs[0].id, format: "pdf" as const },
    ]
    let pending: ReturnType<Controller["runRender"]> | undefined
    await act(async () => {
      pending = captured.current!.runRender(version, {}, selections, {
        idempotencyKey: "webmcp-render-race",
      })
      await vi.waitFor(() =>
        expect(
          fetchMock.mock.calls.some(([, init]) => init?.method === "POST")
        ).toBe(true)
      )
    })

    await act(async () => {
      resolveHistory?.(
        new Response(
          JSON.stringify({
            data: [
              {
                id: "render-server-race",
                templateId: version.templateId,
                version: version.version,
                createdAt: "2026-08-30T00:00:00.000Z",
                completedAt: "2026-08-30T00:00:01.000Z",
                status: "completed",
                error: null,
                request: {
                  modifications: {},
                  response: { outputs: selections },
                },
                artifacts: [],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      await history
      await Promise.resolve()
    })

    await act(async () => {
      resolveRender?.(
        new Response(
          JSON.stringify({
            id: "render-server-race",
            completedAt: "2026-08-30T00:00:01.000Z",
            artifacts: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      await pending
    })

    expect(
      captured.current.records.filter(
        (record) => record.id === "render-server-race"
      )
    ).toHaveLength(1)
    expect(
      captured.current.records.some((record) =>
        record.id.startsWith("local-render-")
      )
    ).toBe(false)
  })
})
