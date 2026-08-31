// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import type { FieldDefinition } from "@webmcp/document"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TypedFieldValueControl } from "./typed-field-value-control"

const reactEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}
reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const assetField = (
  overrides: Partial<FieldDefinition> = {}
): FieldDefinition => ({
  id: "hero_image",
  key: "hero_image",
  label: "Hero image",
  type: "asset",
  required: false,
  defaultValue: "",
  agentDescription: "",
  validation: {},
  ...overrides,
})

describe("TypedFieldValueControl asset chooser", () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it("opens the shared chooser from an editable source field with the exact opener", async () => {
    const onChooseAsset = vi.fn()
    await act(async () => {
      root.render(
        <TypedFieldValueControl
          field={assetField()}
          value="asset:managed/asset-workspace01"
          ariaLabel="Hero image"
          onCommit={vi.fn()}
          onChooseAsset={onChooseAsset}
        />
      )
    })

    const button = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Choose image for Hero image"]'
    )
    expect(button).not.toBeNull()
    expect(host.textContent).toContain("Workspace-managed image")
    await act(async () => button?.click())
    expect(onChooseAsset).toHaveBeenCalledWith(button)
  })

  it("does not add the chooser to ID mode or field-definition default editing", async () => {
    await act(async () => {
      root.render(
        <TypedFieldValueControl
          field={assetField()}
          value=""
          ariaLabel="Hero image"
          assetValueMode="id"
          onCommit={vi.fn()}
          onChooseAsset={vi.fn()}
        />
      )
    })
    expect(host.textContent).not.toContain("Choose image")

    await act(async () => {
      root.render(
        <TypedFieldValueControl
          field={assetField()}
          value=""
          ariaLabel="Hero image"
          onCommit={vi.fn()}
        />
      )
    })
    expect(host.textContent).not.toContain("Choose image")
  })

  it("blocks clearing required and bound fields and explains each policy", async () => {
    const onCommit = vi.fn()
    await act(async () => {
      root.render(
        <TypedFieldValueControl
          field={assetField({ required: true })}
          value="asset:local/device-image-1"
          ariaLabel="Hero image"
          assetCanBeEmpty={false}
          onCommit={onCommit}
          onChooseAsset={vi.fn()}
        />
      )
    })
    let clear = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Clear image from Hero image"]'
    )
    expect(clear?.disabled).toBe(true)
    expect(host.textContent).toContain("required field cannot be cleared")

    await act(async () => {
      root.render(
        <TypedFieldValueControl
          field={assetField()}
          value="asset:local/device-image-1"
          ariaLabel="Hero image"
          assetCanBeEmpty={false}
          onCommit={onCommit}
          onChooseAsset={vi.fn()}
        />
      )
    })
    clear = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Clear image from Hero image"]'
    )
    expect(clear?.disabled).toBe(true)
    expect(host.textContent).toContain("Unbind the image layers")
    expect(onCommit).not.toHaveBeenCalled()
  })

  it("clears an optional unbound field through the canonical commit callback", async () => {
    const onCommit = vi.fn()
    await act(async () => {
      root.render(
        <TypedFieldValueControl
          field={assetField()}
          value="asset:local/device-image-1"
          ariaLabel="Hero image"
          assetCanBeEmpty
          onCommit={onCommit}
          onChooseAsset={vi.fn()}
        />
      )
    })
    const clear = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Clear image from Hero image"]'
    )
    expect(clear?.disabled).toBe(false)
    await act(async () => clear?.click())
    expect(onCommit).toHaveBeenCalledOnce()
    expect(onCommit).toHaveBeenCalledWith("")
  })
})
