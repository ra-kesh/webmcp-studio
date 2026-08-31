// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
  LibraryCatalogQueryInput,
  LibraryCollectionDetail,
  LibraryCollectionSummary,
} from "@webmcp/document"
import { LibraryCollectionBrowserDialog } from "./library-collection-browser"
import type { LibraryCollectionDialogRequest } from "./library-collection-browser"
import { LibraryCollectionBrowserController } from "./library-collection-browser-controller"
import { LibraryDiscoveryHttpError } from "./library-discovery-client"
import {
  catalogTemplates,
  DiscoveryTestRoot,
  discoveryState,
  preferenceSnapshot,
  preferenceState,
  staticController,
  staticPreferenceController,
} from "./library-template-browser.test-support"
import type { LibraryPreferenceFailure } from "./library-preference-controller"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const summary: LibraryCollectionSummary = {
  id: "collection-campaign",
  name: "Campaign",
  scope: "workspace",
  revision: 3,
  itemCount: 2,
  createdAt: "2026-08-31T09:00:00.000Z",
  updatedAt: "2026-08-31T10:00:00.000Z",
}

const detail: LibraryCollectionDetail = {
  summary,
  members: catalogTemplates.slice(0, 2).map(({ itemKind, id, version }) => ({
    itemKind,
    id,
    version,
  })),
}

const request = (
  mode: LibraryCollectionDialogRequest["mode"] = "manage"
): LibraryCollectionDialogRequest => ({
  key: 1,
  mode,
  collectionId: mode === "manage" ? summary.id : null,
  pendingMember: null,
})

const memberController = () =>
  new LibraryCollectionBrowserController({
    list: vi.fn(async (query: LibraryCatalogQueryInput) => ({
      workspaceRevision: 4,
      page: {
        schemaVersion: 1 as const,
        catalogRevision: "collection-browser-test-r1",
        generation: query.generation,
        queryIdentity: "libq_0123456789abcdef",
        items: [...catalogTemplates.slice(0, 2)].reverse(),
        nextCursor: null,
        total: 2,
      },
    })),
  })

const readyPreferenceState = () =>
  preferenceState({
    snapshot: preferenceSnapshot({ collections: [summary] }),
    collectionDetails: new Map([[summary.id, { status: "ready", detail }]]),
  })

const changeInput = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

describe("LibraryCollectionBrowserDialog", () => {
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
    vi.stubGlobal("PointerEvent", MouseEvent)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("loads server-named ordered members and exposes rename, filter, remove, reorder, and delete", async () => {
    const preferenceController = staticPreferenceController(
      readyPreferenceState()
    )
    const onFilterCollection = vi.fn()

    await act(async () => {
      root.render(
        <DiscoveryTestRoot
          controller={staticController(discoveryState())}
          preferenceController={preferenceController}
        >
          <LibraryCollectionBrowserDialog
            open
            createMemberController={memberController}
            request={request()}
            onFilterCollection={onFilterCollection}
            onOpenChange={vi.fn()}
          />
        </DiscoveryTestRoot>
      )
      await Promise.resolve()
    })

    const dialog = document.querySelector(
      '[data-library-collection-dialog="true"]'
    )
    expect(dialog).not.toBeNull()
    expect(preferenceController.loadCollection).toHaveBeenCalledWith(summary.id)
    expect(
      dialog?.querySelectorAll("[data-library-collection-member]")
    ).toHaveLength(2)
    expect(dialog?.textContent).toContain(catalogTemplates[0].name)
    expect(dialog?.querySelector("button button")).toBeNull()

    const collectionButton = dialog?.querySelector<HTMLButtonElement>(
      `[data-library-collection-row="${summary.id}"]`
    )
    expect(collectionButton?.tagName).toBe("BUTTON")
    expect(collectionButton?.getAttribute("role")).toBeNull()
    expect(collectionButton?.getAttribute("type")).toBe("button")
    collectionButton?.focus()
    expect(document.activeElement).toBe(collectionButton)
    expect(collectionButton?.tabIndex).toBe(0)

    const rename = dialog?.querySelector<HTMLInputElement>(
      "#library-collection-rename-name"
    )
    expect(rename).not.toBeNull()
    await act(async () => changeInput(rename!, "Campaign picks"))
    await act(async () =>
      dialog
        ?.querySelector<HTMLButtonElement>(
          '[data-library-collection-rename="true"]'
        )
        ?.click()
    )
    expect(preferenceController.renameCollection).toHaveBeenCalledWith(
      summary.id,
      "Campaign picks"
    )

    await act(async () =>
      dialog
        ?.querySelectorAll<HTMLButtonElement>(
          '[data-library-member-move="down"]'
        )[0]
        ?.click()
    )
    expect(preferenceController.reorderCollectionMembers).toHaveBeenCalledWith(
      summary.id,
      [detail.members[1], detail.members[0]]
    )

    await act(async () =>
      dialog
        ?.querySelector<HTMLButtonElement>("[data-library-member-remove]")
        ?.click()
    )
    expect(preferenceController.removeCollectionMember).toHaveBeenCalledWith(
      summary.id,
      detail.members[0],
      catalogTemplates[0].name
    )

    await act(async () =>
      dialog
        ?.querySelector<HTMLButtonElement>(
          `[data-library-collection-filter="${summary.id}"]`
        )
        ?.click()
    )
    expect(onFilterCollection).toHaveBeenCalledWith(summary.id)

    await act(async () =>
      dialog
        ?.querySelector<HTMLButtonElement>(
          `[data-library-collection-delete="${summary.id}"]`
        )
        ?.click()
    )
    const confirm = dialog?.querySelector<HTMLButtonElement>(
      `[data-library-collection-delete-confirm="${summary.id}"]`
    )
    expect(confirm).not.toBeNull()
    await act(async () => confirm?.click())
    expect(preferenceController.deleteCollection).toHaveBeenCalledWith(
      summary.id
    )
  })

  it("retains create input and renders action-specific request identity with Retry and Dismiss", async () => {
    const failure: LibraryPreferenceFailure = {
      key: "collection:create",
      action: "create_collection",
      message: "Couldn't create Client selects",
      code: "library_network_error",
      status: 0,
      requestId: "request-create-collection-1",
      retryable: true,
      retryMode: "same_key",
      commitStatus: "unknown",
    }
    const preferenceController = staticPreferenceController(
      preferenceState({
        snapshot: preferenceSnapshot({ collections: [] }),
        failures: new Map([[failure.key, failure]]),
      })
    )

    await act(async () => {
      root.render(
        <DiscoveryTestRoot
          controller={staticController(discoveryState())}
          preferenceController={preferenceController}
        >
          <LibraryCollectionBrowserDialog
            open
            createMemberController={memberController}
            request={request("create")}
            onFilterCollection={vi.fn()}
            onOpenChange={vi.fn()}
          />
        </DiscoveryTestRoot>
      )
    })

    const dialog = document.querySelector(
      '[data-library-collection-dialog="true"]'
    )
    const input = dialog?.querySelector<HTMLInputElement>(
      "#library-collection-create-name"
    )
    await act(async () => changeInput(input!, "Client selects"))
    expect(input?.value).toBe("Client selects")
    expect(dialog?.textContent).toContain("request-create-collection-1")

    const retry = Array.from(dialog?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent.trim() === "Retry"
    )
    const dismiss = Array.from(dialog?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent.trim() === "Dismiss"
    )
    await act(async () => retry?.click())
    await act(async () => dismiss?.click())
    expect(
      preferenceController.retryCreateCollectionResult
    ).toHaveBeenCalledOnce()
    expect(preferenceController.dismissFailure).toHaveBeenCalledWith(
      failure.key
    )
    expect(input?.value).toBe("Client selects")

    const submit = dialog?.querySelector<HTMLButtonElement>(
      '[data-library-collection-create-submit="true"]'
    )
    expect(submit?.className).toContain("min-h-11")
    await act(async () => submit?.click())
    expect(preferenceController.createCollectionResult).toHaveBeenCalledWith(
      "Client selects"
    )
  })

  it("creates a collection from a card and adds that exact card after confirmation", async () => {
    const item = catalogTemplates[0]
    const created: LibraryCollectionSummary = {
      ...summary,
      id: "collection-client-selects",
      name: "Client selects",
      revision: 1,
      itemCount: 0,
    }
    const preferenceController = staticPreferenceController(
      preferenceState({
        snapshot: preferenceSnapshot({ collections: [] }),
      })
    )
    preferenceController.createCollectionResult.mockImplementationOnce(
      async () => {
        preferenceController.updateState(
          preferenceState({
            snapshot: preferenceSnapshot({
              collections: [created],
            }),
          })
        )
        return created
      }
    )

    await act(async () => {
      root.render(
        <DiscoveryTestRoot
          controller={staticController(discoveryState())}
          preferenceController={preferenceController}
        >
          <LibraryCollectionBrowserDialog
            open
            createMemberController={memberController}
            request={{
              ...request("create"),
              pendingMember: {
                identity: {
                  itemKind: item.itemKind,
                  id: item.id,
                  version: item.version,
                },
                name: item.name,
              },
            }}
            onFilterCollection={vi.fn()}
            onOpenChange={vi.fn()}
          />
        </DiscoveryTestRoot>
      )
    })

    const input = document.querySelector<HTMLInputElement>(
      "#library-collection-create-name"
    )
    expect(document.body.textContent).toContain(
      `Create a collection and add ${item.name}.`
    )
    await act(async () => changeInput(input!, created.name))
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-library-collection-create-submit="true"]'
        )
        ?.click()
      await Promise.resolve()
    })

    expect(preferenceController.addCollectionMember).toHaveBeenCalledWith(
      created.id,
      {
        itemKind: item.itemKind,
        id: item.id,
        version: item.version,
      },
      item.name
    )
    expect(preferenceController.createCollectionResult).toHaveBeenCalledWith(
      created.name
    )
    expect(
      document.querySelector(
        `[data-library-collection-row="${created.id}"][aria-current="true"]`
      )
    ).not.toBeNull()
  })

  it("does not add to a same-name collection that appears while local create fails", async () => {
    const item = catalogTemplates[0]
    const otherSameName: LibraryCollectionSummary = {
      ...summary,
      id: "collection-other-tab",
      name: "Client selects",
    }
    const preferenceController = staticPreferenceController(
      preferenceState({ snapshot: preferenceSnapshot({ collections: [] }) })
    )
    preferenceController.createCollectionResult.mockImplementationOnce(
      async () => {
        preferenceController.updateState(
          preferenceState({
            snapshot: preferenceSnapshot({ collections: [otherSameName] }),
          })
        )
        return null
      }
    )
    await act(async () => {
      root.render(
        <DiscoveryTestRoot
          controller={staticController(discoveryState())}
          preferenceController={preferenceController}
        >
          <LibraryCollectionBrowserDialog
            open
            createMemberController={memberController}
            request={{
              ...request("create"),
              pendingMember: {
                identity: {
                  itemKind: item.itemKind,
                  id: item.id,
                  version: item.version,
                },
                name: item.name,
              },
            }}
            onFilterCollection={vi.fn()}
            onOpenChange={vi.fn()}
          />
        </DiscoveryTestRoot>
      )
    })
    const input = document.querySelector<HTMLInputElement>(
      "#library-collection-create-name"
    )
    await act(async () => changeInput(input!, otherSameName.name))
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-library-collection-create-submit="true"]'
        )
        ?.click()
      await Promise.resolve()
    })

    expect(input?.value).toBe(otherSameName.name)
    expect(preferenceController.addCollectionMember).not.toHaveBeenCalled()
    expect(
      document.querySelector('[data-library-collection-create-form="true"]')
    ).not.toBeNull()
  })

  it("retries create with the original card intent after reopening from another card", async () => {
    const firstItem = catalogTemplates[0]
    const secondItem = catalogTemplates[1]
    const created: LibraryCollectionSummary = {
      ...summary,
      id: "collection-original-retry",
      name: "Original retry",
      revision: 1,
      itemCount: 0,
    }
    const failure: LibraryPreferenceFailure = {
      key: "collection:create",
      action: "create_collection",
      message: "Couldn't create Original retry",
      code: "library_network_error",
      status: 0,
      requestId: "request-original-retry-1",
      retryable: true,
      retryMode: "same_key",
      commitStatus: "unknown",
    }
    const preferenceController = staticPreferenceController(
      preferenceState({ snapshot: preferenceSnapshot({ collections: [] }) })
    )
    preferenceController.createCollectionResult.mockImplementationOnce(
      async () => {
        preferenceController.updateState(
          preferenceState({
            snapshot: preferenceSnapshot({ collections: [] }),
            failures: new Map([[failure.key, failure]]),
          })
        )
        return null
      }
    )
    preferenceController.retryCreateCollectionResult.mockResolvedValueOnce(
      created
    )
    const renderDialog = (dialogRequest: LibraryCollectionDialogRequest) => (
      <DiscoveryTestRoot
        controller={staticController(discoveryState())}
        preferenceController={preferenceController}
      >
        <LibraryCollectionBrowserDialog
          open
          createMemberController={memberController}
          request={dialogRequest}
          onFilterCollection={vi.fn()}
          onOpenChange={vi.fn()}
        />
      </DiscoveryTestRoot>
    )
    const firstRequest: LibraryCollectionDialogRequest = {
      ...request("create"),
      pendingMember: {
        identity: {
          itemKind: firstItem.itemKind,
          id: firstItem.id,
          version: firstItem.version,
        },
        name: firstItem.name,
      },
    }
    await act(async () => root.render(renderDialog(firstRequest)))
    const input = document.querySelector<HTMLInputElement>(
      "#library-collection-create-name"
    )
    await act(async () => changeInput(input!, created.name))
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-library-collection-create-submit="true"]'
        )
        ?.click()
      await Promise.resolve()
    })

    await act(async () =>
      root.render(
        renderDialog({
          ...firstRequest,
          key: firstRequest.key + 1,
          pendingMember: {
            identity: {
              itemKind: secondItem.itemKind,
              id: secondItem.id,
              version: secondItem.version,
            },
            name: secondItem.name,
          },
        })
      )
    )
    const retry = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent.trim() === "Retry"
    )
    await act(async () => {
      retry?.click()
      await Promise.resolve()
    })

    expect(preferenceController.addCollectionMember).toHaveBeenCalledWith(
      created.id,
      firstRequest.pendingMember?.identity,
      firstRequest.pendingMember?.name
    )
    expect(preferenceController.addCollectionMember).not.toHaveBeenCalledWith(
      created.id,
      expect.objectContaining({ id: secondItem.id }),
      secondItem.name
    )
  })

  it("keeps confirmed collection content visible while a revision conflict reconciles", async () => {
    const preferenceController = staticPreferenceController(
      preferenceState({
        ...readyPreferenceState(),
        pending: new Map([
          [
            `collection:${summary.id}:rename`,
            {
              key: `collection:${summary.id}:rename`,
              action: "rename_collection",
              phase: "reconciling",
              itemIdentity: null,
              collectionId: summary.id,
              idempotencyKey: "rename-conflict-1",
              optimisticFavorite: null,
            },
          ],
        ]),
      })
    )

    await act(async () => {
      root.render(
        <DiscoveryTestRoot
          controller={staticController(discoveryState())}
          preferenceController={preferenceController}
        >
          <LibraryCollectionBrowserDialog
            open
            createMemberController={memberController}
            request={request()}
            onFilterCollection={vi.fn()}
            onOpenChange={vi.fn()}
          />
        </DiscoveryTestRoot>
      )
      await Promise.resolve()
    })

    const dialog = document.querySelector(
      '[data-library-collection-dialog="true"]'
    )
    expect(dialog?.textContent).toContain("Refreshing after another change")
    expect(
      dialog?.querySelectorAll("[data-library-collection-member]")
    ).toHaveLength(2)
    expect(
      dialog?.querySelector<HTMLInputElement>("#library-collection-rename-name")
        ?.disabled
    ).toBe(true)
  })

  it("preserves a dirty rename and surfaces an authoritative remote rename", async () => {
    const preferenceController = staticPreferenceController(
      readyPreferenceState()
    )
    await act(async () => {
      root.render(
        <DiscoveryTestRoot
          controller={staticController(discoveryState())}
          preferenceController={preferenceController}
        >
          <LibraryCollectionBrowserDialog
            open
            createMemberController={memberController}
            request={request()}
            onFilterCollection={vi.fn()}
            onOpenChange={vi.fn()}
          />
        </DiscoveryTestRoot>
      )
      await Promise.resolve()
    })
    const rename = document.querySelector<HTMLInputElement>(
      "#library-collection-rename-name"
    )
    await act(async () => changeInput(rename!, "My local campaign name"))
    const remoteSummary = {
      ...summary,
      name: "Remote campaign name",
      revision: summary.revision + 1,
    }
    await act(async () => {
      preferenceController.updateState(
        preferenceState({
          snapshot: preferenceSnapshot({ collections: [remoteSummary] }),
          collectionDetails: new Map([
            [
              remoteSummary.id,
              {
                status: "ready" as const,
                detail: { ...detail, summary: remoteSummary },
              },
            ],
          ]),
        })
      )
    })

    expect(rename?.value).toBe("My local campaign name")
    expect(
      document.querySelector('[data-library-collection-rename-conflict="true"]')
        ?.textContent
    ).toContain("Remote campaign name")
  })

  it("shows and dismisses a retained preference-detail failure without enabling stale rows", async () => {
    const detailFailure: LibraryPreferenceFailure = {
      key: `collection:${summary.id}:load`,
      action: "load_collection",
      message: `Couldn't load ${summary.name}`,
      code: "library_network_error",
      status: 0,
      requestId: "request-detail-refresh-1",
      retryable: true,
      retryMode: "refresh",
      commitStatus: "unknown",
    }
    const revisedSummary = { ...summary, revision: summary.revision + 1 }
    const preferenceController = staticPreferenceController(
      preferenceState({
        snapshot: preferenceSnapshot({ collections: [revisedSummary] }),
        collectionDetails: new Map([
          [
            summary.id,
            {
              status: "failed" as const,
              retained: detail,
              failure: detailFailure,
            },
          ],
        ]),
      })
    )
    await act(async () => {
      root.render(
        <DiscoveryTestRoot
          controller={staticController(discoveryState())}
          preferenceController={preferenceController}
        >
          <LibraryCollectionBrowserDialog
            open
            createMemberController={memberController}
            request={request()}
            onFilterCollection={vi.fn()}
            onOpenChange={vi.fn()}
          />
        </DiscoveryTestRoot>
      )
      await Promise.resolve()
    })
    const failure = document.querySelector(
      `[data-library-preference-failure="${detailFailure.key}"]`
    )
    expect(failure?.textContent).toContain(detailFailure.requestId)
    const dismiss = Array.from(failure?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent.trim() === "Dismiss"
    )
    await act(async () => dismiss?.click())
    expect(
      preferenceController.dismissCollectionDetailFailure
    ).toHaveBeenCalledWith(summary.id)
    expect(
      document.querySelector<HTMLButtonElement>(
        '[data-library-member-move="down"]'
      )?.disabled
    ).toBe(true)
  })

  it("keeps a dismissed cold catalog failure truthful and reloadable", async () => {
    const controller = new LibraryCollectionBrowserController({
      list: vi.fn(async () => {
        throw new LibraryDiscoveryHttpError({
          code: "library_timeout",
          status: 504,
          message: "Timed out",
          requestId: "request-cold-catalog-1",
          retryable: true,
        })
      }),
    })
    const preferenceController = staticPreferenceController(
      readyPreferenceState()
    )
    await act(async () => {
      root.render(
        <DiscoveryTestRoot
          controller={staticController(discoveryState())}
          preferenceController={preferenceController}
        >
          <LibraryCollectionBrowserDialog
            open
            createMemberController={() => controller}
            request={request()}
            onFilterCollection={vi.fn()}
            onOpenChange={vi.fn()}
          />
        </DiscoveryTestRoot>
      )
      await Promise.resolve()
    })
    await vi.waitFor(() =>
      expect(controller.getSnapshot().status).toBe("failed")
    )
    const dismiss = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent.trim() === "Dismiss"
    )
    await act(async () => dismiss?.click())

    expect(document.body.textContent).toContain(
      "Collection items are unavailable"
    )
    expect(document.body.textContent).not.toContain("This collection is empty")
    expect(
      Array.from(document.querySelectorAll("button")).some(
        (button) => button.textContent.trim() === "Reload items"
      )
    ).toBe(true)
  })

  it("shows retained refresh failure truth and disables stale-order mutations", async () => {
    let calls = 0
    const controller = new LibraryCollectionBrowserController({
      list: vi.fn(async (query: LibraryCatalogQueryInput) => {
        calls += 1
        if (calls > 1) {
          throw new LibraryDiscoveryHttpError({
            code: "library_timeout",
            status: 504,
            message: "Timed out",
            requestId: "request-member-refresh-1",
            retryable: true,
          })
        }
        return {
          workspaceRevision: 4,
          page: {
            schemaVersion: 1 as const,
            catalogRevision: "collection-browser-refresh-r1",
            generation: query.generation,
            queryIdentity: "libq_0123456789abcdef",
            items: [...catalogTemplates.slice(0, 2)],
            nextCursor: null,
            total: 2,
          },
        }
      }),
    })
    const preferenceController = staticPreferenceController(
      readyPreferenceState()
    )
    await act(async () => {
      root.render(
        <DiscoveryTestRoot
          controller={staticController(discoveryState())}
          preferenceController={preferenceController}
        >
          <LibraryCollectionBrowserDialog
            open
            createMemberController={() => controller}
            request={request()}
            onFilterCollection={vi.fn()}
            onOpenChange={vi.fn()}
          />
        </DiscoveryTestRoot>
      )
      await Promise.resolve()
    })
    await vi.waitFor(() =>
      expect(controller.getSnapshot().status).toBe("ready")
    )
    const revisedSummary = {
      ...summary,
      revision: summary.revision + 1,
    }
    const revisedDetail: LibraryCollectionDetail = {
      summary: revisedSummary,
      members: [...detail.members].reverse(),
    }
    await act(async () => {
      preferenceController.updateState(
        preferenceState({
          snapshot: preferenceSnapshot({ collections: [revisedSummary] }),
          collectionDetails: new Map([
            [summary.id, { status: "ready", detail: revisedDetail }],
          ]),
        })
      )
      await Promise.resolve()
    })
    await vi.waitFor(() =>
      expect(controller.getSnapshot().status).toBe("failed")
    )

    const warning = document.querySelector(
      '[data-library-collection-catalog-failure="true"]'
    )
    expect(warning?.textContent).toContain("request-member-refresh-1")
    const moveDown = document.querySelector<HTMLButtonElement>(
      '[data-library-member-move="down"]'
    )
    expect(moveDown?.disabled).toBe(true)
    await act(async () => moveDown?.click())
    expect(preferenceController.reorderCollectionMembers).not.toHaveBeenCalled()
    const dismiss = Array.from(warning?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent.trim() === "Dismiss"
    )
    await act(async () => dismiss?.click())
    expect(controller.getSnapshot()).toMatchObject({
      status: "dismissed",
      members: expect.any(Array),
    })
    expect(document.body.textContent).not.toContain("This collection is empty")
    expect(
      document.querySelectorAll("[data-library-collection-member]")
    ).toHaveLength(2)
    expect(moveDown?.disabled).toBe(true)
  })
})
