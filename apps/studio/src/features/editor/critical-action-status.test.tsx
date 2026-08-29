// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { CriticalActionStatus } from "./critical-action-status"

describe("CriticalActionStatus", () => {
  let host: HTMLDivElement
  let root: Root

  beforeAll(() => {
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
  })

  it("keeps an active export visible with a truthful cancel action", async () => {
    const cancel = vi.fn()
    await act(async () => {
      root.render(
        <CriticalActionStatus
          lifecycle={{
            status: "running",
            action: "export-png",
            operationId: "png-1",
            cancelable: true,
          }}
          onCancel={cancel}
          onRetry={vi.fn()}
        />
      )
    })

    const status = host.querySelector<HTMLElement>('[role="status"]')
    expect(status?.textContent).toContain("PNG export in progress")
    await act(async () =>
      status?.querySelector<HTMLButtonElement>("button")?.click()
    )
    expect(cancel).toHaveBeenCalledOnce()
  })

  it("announces a terminal failure and exposes retry", async () => {
    const retry = vi.fn()
    await act(async () => {
      root.render(
        <CriticalActionStatus
          lifecycle={{
            status: "timed_out",
            action: "export-pdf",
            operationId: "pdf-1",
            message: "PDF export took too long.",
            retryable: true,
          }}
          onCancel={vi.fn()}
          onRetry={retry}
        />
      )
    })

    const alert = host.querySelector<HTMLElement>('[role="alert"]')
    expect(alert?.textContent).toContain("PDF export took too long.")
    await act(async () =>
      alert?.querySelector<HTMLButtonElement>("button")?.click()
    )
    expect(retry).toHaveBeenCalledOnce()
  })

  it("keeps cancellation visible without allowing an overlapping action", async () => {
    const cancel = vi.fn()
    const retry = vi.fn()
    await act(async () => {
      root.render(
        <CriticalActionStatus
          lifecycle={{
            status: "cancelling",
            action: "export-pdf",
            operationId: "pdf-stopping",
            reason: "cancelled",
          }}
          onCancel={cancel}
          onRetry={retry}
        />
      )
    })

    const status = host.querySelector<HTMLElement>('[role="status"]')
    expect(status?.textContent).toContain("Stopping PDF export")
    expect(status?.textContent).toContain("Waiting for owned work to stop")
    expect(status?.querySelector("button")).toBeNull()
    expect(cancel).not.toHaveBeenCalled()
    expect(retry).not.toHaveBeenCalled()
  })
})
