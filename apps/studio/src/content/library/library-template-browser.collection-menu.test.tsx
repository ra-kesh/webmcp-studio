// @vitest-environment jsdom

import { act } from "react"
import type { ButtonHTMLAttributes, ReactNode } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LibraryTemplateBrowser } from "./library-template-browser"
import {
  catalogTemplates,
  confirmedPage,
  DiscoveryTestRoot,
  discoveryState,
  preferenceSnapshot,
  preferenceState,
  staticController,
  staticPreferenceController,
} from "./library-template-browser.test-support"

vi.mock("@webmcp/ui/components/dropdown-menu", () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => children
  return {
    DropdownMenu: Passthrough,
    DropdownMenuContent: Passthrough,
    DropdownMenuGroup: Passthrough,
    DropdownMenuLabel: Passthrough,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuTrigger: Passthrough,
    DropdownMenuItem: ({
      children,
      disabled,
      ...props
    }: ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button disabled={disabled} role="menuitem" type="button" {...props}>
        {children}
      </button>
    ),
    DropdownMenuCheckboxItem: ({
      children,
      checked,
      disabled,
      ...props
    }: ButtonHTMLAttributes<HTMLButtonElement> & {
      checked?: boolean
    }) => (
      <button
        aria-checked={checked}
        disabled={disabled}
        role="menuitemcheckbox"
        type="button"
        {...props}
      >
        {children}
      </button>
    ),
  }
})

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe("LibraryTemplateBrowser collection card menu", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    vi.stubGlobal(
      "ResizeObserver",
      class implements ResizeObserver {
        disconnect() {}
        observe() {}
        unobserve() {}
      }
    )
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        disconnect() {}
        observe() {}
        takeRecords() {
          return []
        }
        unobserve() {}
      }
    )
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  })

  it("uses checked menu semantics and disables New collection without add permission", async () => {
    const allowed = structuredClone(catalogTemplates[0])
    const denied = {
      ...structuredClone(catalogTemplates[1]),
      permissions: {
        ...structuredClone(catalogTemplates[1].permissions),
        canAddToCollection: false,
      },
    }
    const collection = {
      id: "collection-menu-test",
      name: "Campaign",
      scope: "workspace" as const,
      revision: 1,
      itemCount: 0,
      createdAt: "2026-08-31T09:00:00.000Z",
      updatedAt: "2026-08-31T09:00:00.000Z",
    }
    await act(async () => {
      root.render(
        <DiscoveryTestRoot
          controller={staticController(
            discoveryState({
              confirmedPage: confirmedPage([allowed, denied]),
            })
          )}
          preferenceController={staticPreferenceController(
            preferenceState({
              snapshot: preferenceSnapshot({ collections: [collection] }),
            })
          )}
        >
          <LibraryTemplateBrowser
            hasQuotationSource
            variant="start"
            onCreate={vi.fn()}
          />
        </DiscoveryTestRoot>
      )
    })

    const membershipItems = host.querySelectorAll(
      `[data-library-collection-toggle="${collection.id}"]`
    )
    expect(membershipItems).toHaveLength(2)
    expect(membershipItems[0].getAttribute("role")).toBe("menuitemcheckbox")
    expect(membershipItems[0].getAttribute("aria-checked")).toBe("false")

    const createItems = host.querySelectorAll<HTMLButtonElement>(
      '[data-library-new-collection="true"]'
    )
    expect(createItems).toHaveLength(2)
    expect(createItems[0].disabled).toBe(false)
    expect(createItems[1].disabled).toBe(true)
  })
})
