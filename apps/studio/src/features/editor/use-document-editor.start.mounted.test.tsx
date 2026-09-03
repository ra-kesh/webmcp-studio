// @vitest-environment jsdom

import "fake-indexeddb/auto"
import { webcrypto } from "node:crypto"
import { builtInDesignTemplateRepository } from "@webmcp/document"
import type { GeneratedDocumentPlan } from "@webmcp/document"
import { act, useLayoutEffect } from "react"
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
import type { CurrentDraftRepositoryMigrationResult } from "./document-draft-migration"
import { DocumentDraftRepository } from "./document-draft-repository"
import { DRAFT_RECOVERY_STORAGE_KEY } from "./draft-recovery"
import { quotationStarter } from "./quotation-starter"
import { CURRENT_DRAFT_STORAGE_KEY } from "./current-draft-repository"
import type { CurrentDraftEnvelope } from "./current-draft-repository"
import {
  StudioPersistenceTestWrapper,
  useStudioPersistence,
} from "./studio-persistence-test-wrapper"
import type { StudioPersistenceTestWrapperProps } from "./studio-persistence-test-wrapper"
import type { StudioPersistenceApi } from "../persistence/studio-persistence-provider"
import { useDocumentEditor } from "./use-document-editor"
import { getStudioLibraryCatalogDetail } from "../../content/library/catalog"

type Editor = ReturnType<typeof useDocumentEditor>
type MountedCapture = Readonly<{
  editor: Editor
  persistence: StudioPersistenceApi
}>
type MountOptions = Pick<
  StudioPersistenceTestWrapperProps,
  "createRepository" | "migrate"
>

const emptyMigration = {
  status: "empty",
} as const satisfies CurrentDraftRepositoryMigrationResult

const unavailableFailure = {
  kind: "storage_unavailable",
  message: "Studio document storage is unavailable for this test.",
} as const

const unavailableMigration = {
  status: "repository_unavailable",
  failure: unavailableFailure,
} as const satisfies CurrentDraftRepositoryMigrationResult

const blockedFailure = {
  kind: "blocked",
  message: "Another Studio tab is upgrading document storage.",
} as const

const blockedMigration = {
  status: "blocked",
  failure: blockedFailure,
} as const satisfies CurrentDraftRepositoryMigrationResult

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function recoveryMigrationFor(envelope: CurrentDraftEnvelope) {
  const recovery = {
    schemaVersion: 1 as const,
    sourceStorageKey: CURRENT_DRAFT_STORAGE_KEY,
    capturedAt: "2026-08-29T01:00:00.000Z",
    failure: {
      kind: "malformed_json" as const,
      message: "The saved draft needs explicit recovery approval.",
    },
    raw: JSON.stringify(envelope),
  }
  return {
    recovery,
    migration: {
      status: "recovery_required" as const,
      recovery,
      recoveryStored: true,
    } satisfies CurrentDraftRepositoryMigrationResult,
  }
}

function MountedEditor({
  capture,
}: {
  capture: (value: MountedCapture) => void
}) {
  const persistence = useStudioPersistence()
  const editor = useDocumentEditor({
    persistence,
    libraryTemplateDetailPort: async (kind, id, version, signal) => {
      if (signal.aborted) throw signal.reason
      return getStudioLibraryCatalogDetail(kind, id, version)
    },
  })
  useLayoutEffect(
    () => capture({ editor, persistence }),
    [capture, editor, persistence]
  )
  return null
}

describe("useDocumentEditor start session", () => {
  let host: HTMLDivElement
  let root: Root
  let repositorySequence = 0

  beforeAll(() => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    })
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  })

  beforeEach(() => {
    localStorage.clear()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    localStorage.clear()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function createRepository(label = "start") {
    repositorySequence += 1
    return new DocumentDraftRepository({
      databaseName: `webmcp-studio-start-mounted-${label}-${repositorySequence}`,
      indexedDB: globalThis.indexedDB,
      sessionId: `start-mounted-${label}-${repositorySequence}`,
    })
  }

  async function mount(options: MountOptions = {}) {
    const captured: { current: MountedCapture | null } = { current: null }
    const createRepositoryForMount =
      options.createRepository ?? (() => createRepository())
    await act(async () => {
      root.render(
        <StudioPersistenceTestWrapper
          createRepository={createRepositoryForMount}
          migrate={options.migrate}
        >
          <MountedEditor
            capture={(value) => {
              captured.current = value
            }}
          />
        </StudioPersistenceTestWrapper>
      )
    })
    return captured
  }

  async function waitForPersistenceStatus(
    captured: { current: MountedCapture | null },
    status: StudioPersistenceApi["state"]["status"]
  ) {
    await act(async () => {
      await vi.waitFor(() => {
        expect(captured.current?.persistence.state.status).toBe(status)
      })
    })
  }

  async function advanceAutosaveWindow() {
    vi.useFakeTimers()
    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    vi.useRealTimers()
  }

  it("keeps first-run state neutral and never autosaves the sample", async () => {
    const captured = await mount({ migrate: async () => emptyMigration })

    expect(captured.current?.editor.sessionMode).toBe("start")
    expect(captured.current?.editor.document.id).toBe(
      "private-bootstrap-document"
    )
    expect(captured.current?.editor.quotationSource).toBeNull()

    await advanceAutosaveWindow()
    expect(localStorage.getItem(CURRENT_DRAFT_STORAGE_KEY)).toBeNull()
  })

  it("preserves the exact legacy envelope when the repository cannot open", async () => {
    const envelope: CurrentDraftEnvelope = {
      schemaVersion: 1,
      document: quotationStarter.document,
      sourceContext: {
        quotationSource: quotationStarter.source,
        quotationTemplateId: quotationStarter.templateId,
        designTemplate: null,
      },
    }
    const raw = JSON.stringify(envelope)
    localStorage.setItem(CURRENT_DRAFT_STORAGE_KEY, raw)
    const migration = deferred<CurrentDraftRepositoryMigrationResult>()
    const captured = await mount({
      migrate: () => migration.promise,
    })

    expect(captured.current?.persistence.state).toEqual({ status: "opening" })
    expect(captured.current?.editor.sessionMode).toBe("start")
    await act(async () => {
      expect(await captured.current?.editor.continueSessionDocument()).toBe(
        false
      )
      migration.resolve({
        status: "legacy_storage_unavailable",
        failure: {
          operation: "get_storage",
          message: "Legacy local storage is unavailable.",
        },
        recoverableDraft: envelope,
      })
    })
    await waitForPersistenceStatus(captured, "unavailable")

    expect(captured.current?.editor.startModel).toMatchObject({
      status: "unavailable",
      durable: false,
      storageWarning: "Legacy local storage is unavailable.",
    })
    if (captured.current?.editor.startModel.status !== "unavailable") {
      throw new Error("Expected unavailable Start state")
    }
    expect(captured.current.editor.startModel.recoverableEnvelope).toBe(
      envelope
    )
    expect(captured.current.editor.sessionMode).toBe("start")
    expect(captured.current.editor.document.id).toBe(
      "private-bootstrap-document"
    )

    await advanceAutosaveWindow()
    expect(localStorage.getItem(CURRENT_DRAFT_STORAGE_KEY)).toBe(raw)
  })

  it.each([
    ["blocked", blockedMigration, blockedFailure],
    ["unavailable", unavailableMigration, unavailableFailure],
  ] as const)(
    "projects the exact %s provider failure without replacing the neutral bootstrap",
    async (status, migration, failure) => {
      const captured = await mount({ migrate: async () => migration })
      await waitForPersistenceStatus(captured, status)

      expect(captured.current?.editor.repositoryLifecycle).toEqual({
        status,
        failure,
      })
      expect(captured.current?.editor.startModel).toEqual({
        status,
        durable: false,
        storageWarning: failure.message,
        recoverableEnvelope: null,
      })
      expect(captured.current?.editor.sessionMode).toBe("start")
      expect(captured.current?.editor.document.id).toBe(
        "private-bootstrap-document"
      )
    }
  )

  it("validates a session-only blank document before opening it", async () => {
    const captured = await mount({ migrate: async () => unavailableMigration })
    await waitForPersistenceStatus(captured, "unavailable")

    let created = false
    await act(async () => {
      created =
        (await captured.current?.editor.createBlankDocument({
          name: "Client proof",
          width: 1600,
          height: 900,
        })) ?? false
    })
    expect({ created, error: captured.current?.editor.documentError }).toEqual({
      created: true,
      error: null,
    })

    expect(captured.current?.editor.sessionMode).toBe("workspace")
    expect(localStorage.getItem(CURRENT_DRAFT_STORAGE_KEY)).toBeNull()
    expect(captured.current?.editor).toMatchObject({
      document: {
        name: "Client proof",
        outputs: [{ kind: "custom", exportFormats: ["png", "pdf"] }],
        pages: [{ width: 1600, height: 900 }],
      },
    })

    await act(async () => {
      expect(await captured.current?.editor.returnToStart()).toBe(true)
    })
    expect(captured.current?.editor.sessionMode).toBe("start")
    expect(captured.current?.editor.startModel).toMatchObject({
      status: "unavailable",
      recoverableEnvelope: {
        document: { name: "Client proof" },
      },
    })
  })

  it("opens the sample locally without waiting for the best-effort server reset", async () => {
    let resolveReset: ((response: Response) => void) | undefined
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveReset = resolve
          })
      )
    )
    const captured = await mount({ migrate: async () => emptyMigration })
    await waitForPersistenceStatus(captured, "ready")
    let opened = false

    await act(async () => {
      opened = (await captured.current?.editor.restoreDemoDocument()) ?? false
    })

    expect(opened).toBe(true)
    expect(captured.current?.editor.sessionMode).toBe("workspace")
    expect(captured.current?.editor.document.id).not.toBe(
      quotationStarter.document.id
    )
    expect(captured.current?.editor.document.name).toBe(
      quotationStarter.document.name
    )
    expect(captured.current?.editor.activeQuotationComposition).toMatchObject({
      status: "known",
      composerId: "quotation",
      composerVersion: 3,
      sourceQuotationId: quotationStarter.source.source.quotationId,
      sourceRevision: quotationStarter.source.source.revision,
      template: {
        id: "quotation-editorial-olive",
        version: 3,
      },
    })

    await act(async () => resolveReset?.(new Response(null, { status: 204 })))
  })

  it("keeps session-only work in memory when returning home", async () => {
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new DOMException("Storage blocked", "SecurityError")
      })
    const captured = await mount()
    await waitForPersistenceStatus(captured, "unavailable")
    await act(async () => {
      await vi.waitFor(() => {
        expect(captured.current?.editor.startModel).toMatchObject({
          status: "unavailable",
          durable: false,
        })
      })
    })
    getItem.mockRestore()

    expect(captured.current?.editor.startModel).toMatchObject({
      status: "unavailable",
      durable: false,
    })
    await act(async () => {
      expect(
        await captured.current?.editor.createBlankDocument({
          name: "Session only",
          width: 1080,
          height: 1080,
        })
      ).toBe(true)
    })
    await act(async () => {
      captured.current?.editor.addRectangle()
      expect(await captured.current?.editor.returnToStart()).toBe(true)
    })

    expect(captured.current?.editor.sessionMode).toBe("start")
    expect(captured.current?.editor.startModel).toMatchObject({
      status: "unavailable",
      durable: false,
      recoverableEnvelope: { document: { name: "Session only" } },
    })
    expect(localStorage.getItem(CURRENT_DRAFT_STORAGE_KEY)).toBeNull()

    await act(async () => {
      expect(await captured.current?.editor.continueSessionDocument()).toBe(
        true
      )
    })
    expect(captured.current?.editor.sessionMode).toBe("workspace")
    expect(
      captured.current?.editor.document.nodes.some(
        (node) => node.type === "rect" && node.name === "Rectangle"
      )
    ).toBe(true)
  })

  it("creates distinct durable blank, template, import, and sample records after Home", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 }))
    )
    const repository = createRepository("home-create-distinct")
    const captured = await mount({
      createRepository: () => repository,
      migrate: async () => emptyMigration,
    })
    await waitForPersistenceStatus(captured, "ready")
    const documentIds: string[] = []

    const rememberAndReturnHome = async () => {
      const documentId = captured.current?.editor.document.id
      if (!documentId) throw new Error("Expected an active document")
      documentIds.push(documentId)
      return captured.current?.editor.returnToStart()
    }
    const expectReturnedHome = () => {
      expect(captured.current?.editor.sessionMode).toBe("start")
      expect(captured.current?.editor.startModel).toEqual({
        status: "ready",
        durable: true,
        storageWarning: null,
        recoverableEnvelope: null,
      })
    }

    await act(async () => {
      expect(
        await captured.current?.editor.createBlankDocument({
          name: "Blank from Home",
          width: 1600,
          height: 900,
        })
      ).toBe(true)
    })
    const importSource = structuredClone(captured.current!.editor.document)
    await act(async () => {
      expect(await rememberAndReturnHome()).toBe(true)
    })
    expectReturnedHome()

    await act(async () => {
      expect(
        await captured.current?.editor.createDocumentFromTemplate(
          "editorial-one-pager",
          1
        )
      ).toBe(true)
    })
    await act(async () => {
      expect(await rememberAndReturnHome()).toBe(true)
    })
    expectReturnedHome()

    const importedDocument = {
      ...importSource,
      id: `import-${crypto.randomUUID()}`,
      name: "Imported from Home",
    }
    const importedJson = JSON.stringify(importedDocument)
    const importedFile = {
      size: new TextEncoder().encode(importedJson).byteLength,
      text: async () => importedJson,
    } as File
    await act(async () => {
      const opened =
        await captured.current?.editor.openDocumentFile(importedFile)
      expect({ opened, error: captured.current?.editor.documentError }).toEqual(
        { opened: true, error: null }
      )
    })
    await act(async () => {
      expect(await rememberAndReturnHome()).toBe(true)
    })
    expectReturnedHome()

    await act(async () => {
      expect(await captured.current?.editor.restoreDemoDocument()).toBe(true)
    })
    await act(async () => {
      expect(await rememberAndReturnHome()).toBe(true)
    })
    expectReturnedHome()

    expect(new Set(documentIds).size).toBe(4)
    const listed = await repository.list({ state: "active", limit: 24 })
    expect(listed.ok).toBe(true)
    if (!listed.ok) throw new Error(listed.failure.message)
    expect(new Set(listed.page.items.map((item) => item.documentId))).toEqual(
      new Set(documentIds)
    )
  })

  it("persists a generated candidate only once after explicit Review approval", async () => {
    const repository = createRepository("generated-review")
    const create = vi.spyOn(repository, "create")
    const captured = await mount({
      createRepository: () => repository,
      migrate: async () => emptyMigration,
    })
    await waitForPersistenceStatus(captured, "ready")
    const materialized = builtInDesignTemplateRepository.materialize(
      "editorial-one-pager",
      1,
      {
        identity: "canonical",
        now: "2026-08-31T08:00:00.000Z",
      }
    )
    const candidate = {
      ...materialized,
      id: "generated-review-document",
      name: "Generated editorial brief",
    }
    const plan: GeneratedDocumentPlan = {
      requestId: "generated-review-request",
      rootRequestId: "generated-review-request",
      attempt: 1,
      idempotencyKey: "generated-review-key",
      requestHash: "generated-review-hash",
      createdAt: "2026-08-31T08:00:00.000Z",
      start: {
        kind: "template",
        template: {
          id: "editorial-one-pager",
          version: 1,
          snapshotId: "template-snapshot",
        },
      },
      candidate,
      summary: {
        pages: candidate.pages.map(({ id, name, width, height }) => ({
          id,
          name,
          width,
          height,
        })),
        nodesByType: {},
        fields: candidate.fields.map((field) => field.key),
        assets: [],
        structuralChanges: ["Materialized editorial-one-pager v1"],
      },
      provenance: {
        skill: { kind: "repository", title: "studio-document" },
        designGuides: [],
        references: [],
      },
      validation: [],
      warnings: [],
    }

    await act(async () => {
      expect(captured.current?.editor.proposeDocumentGeneration(plan)).toBe(
        plan
      )
    })
    expect(captured.current?.editor.document.id).toBe(
      "private-bootstrap-document"
    )
    expect(create).not.toHaveBeenCalled()

    await act(async () => {
      const replacement = {
        ...plan,
        requestId: "generated-review-replacement",
        idempotencyKey: "generated-review-replacement-key",
        requestHash: "generated-review-replacement-hash",
        replacementForRequestId: plan.requestId,
      }
      expect(
        captured.current?.editor.proposeDocumentGeneration(replacement)
      ).toMatchObject({
        requestId: replacement.requestId,
        rootRequestId: plan.requestId,
        attempt: 2,
      })
      expect(() =>
        captured.current?.editor.proposeDocumentGeneration({
          ...replacement,
          requestId: "generated-review-second-replacement",
          idempotencyKey: "generated-review-second-replacement-key",
          requestHash: "generated-review-second-replacement-hash",
          replacementForRequestId: replacement.requestId,
        })
      ).toThrow(/two-attempt limit/)
      expect(captured.current?.editor.discardGeneratedDocument()).toBe(true)
    })
    expect(create).not.toHaveBeenCalled()

    await act(async () => {
      captured.current?.editor.proposeDocumentGeneration(plan)
      captured.current?.editor.recordGeneratedDocumentInspection({
        requestHash: plan.requestHash,
        passes: true,
        blockingReasons: [],
      })
      const first = captured.current?.editor.createGeneratedDocument()
      const replay = captured.current?.editor.createGeneratedDocument()
      expect(await replay).toBe(false)
      expect(await first).toBe(true)
    })

    expect(create).toHaveBeenCalledTimes(1)
    expect(captured.current?.editor.document.id).toBe(candidate.id)
    expect(captured.current?.editor.pendingGeneratedDocument).toBeNull()
  })

  it.each(["retry", "reset"] as const)(
    "keeps authoritative recovery and source bytes when %s durable create fails",
    async (action) => {
      const envelope: CurrentDraftEnvelope = {
        schemaVersion: 1,
        document: quotationStarter.document,
        sourceContext: null,
      }
      const { recovery, migration } = recoveryMigrationFor(envelope)
      localStorage.setItem(CURRENT_DRAFT_STORAGE_KEY, recovery.raw)
      localStorage.setItem(DRAFT_RECOVERY_STORAGE_KEY, "recovery-marker")
      const repository = createRepository(`failed-${action}`)
      const create = vi.spyOn(repository, "create").mockResolvedValue({
        ok: false,
        reason: "storage_unavailable",
        failure: unavailableFailure,
      })
      const captured = await mount({
        createRepository: () => repository,
        migrate: async () => migration,
      })
      await waitForPersistenceStatus(captured, "recovery_required")

      let result: boolean | undefined
      await act(async () => {
        result =
          action === "retry"
            ? await captured.current?.editor.retryDraftRecovery()
            : await captured.current?.editor.resetDraftRecovery()
      })

      expect(result).toBe(false)
      expect(create).toHaveBeenCalledTimes(1)
      expect(captured.current?.persistence.state).toEqual({
        status: "recovery_required",
        recovery,
      })
      expect(captured.current?.editor.draftRecovery).toBe(recovery)
      expect(localStorage.getItem(CURRENT_DRAFT_STORAGE_KEY)).toBe(recovery.raw)
      expect(localStorage.getItem(DRAFT_RECOVERY_STORAGE_KEY)).toBe(
        "recovery-marker"
      )
    }
  )

  it("completes Retry only after durable create and keeps cleanup failure visible", async () => {
    const envelope: CurrentDraftEnvelope = {
      schemaVersion: 1,
      document: quotationStarter.document,
      sourceContext: null,
    }
    const { recovery, migration } = recoveryMigrationFor(envelope)
    localStorage.setItem(CURRENT_DRAFT_STORAGE_KEY, recovery.raw)
    const repository = createRepository("retry-order")
    const originalCreate = repository.create.bind(repository)
    const createGate = deferred<void>()
    const create = vi
      .spyOn(repository, "create")
      .mockImplementation(async (...args) => {
        await createGate.promise
        return originalCreate(...args)
      })
    const captured = await mount({
      createRepository: () => repository,
      migrate: async () => migration,
    })
    await waitForPersistenceStatus(captured, "recovery_required")
    const originalRemoveItem = Storage.prototype.removeItem
    const removeItem = vi.spyOn(Storage.prototype, "removeItem")
    removeItem.mockImplementation(function (this: Storage, key: string) {
      if (key === CURRENT_DRAFT_STORAGE_KEY) {
        throw new DOMException("Cleanup blocked", "SecurityError")
      }
      return originalRemoveItem.call(this, key)
    })

    let retryPromise: Promise<boolean | void> | null = null
    await act(async () => {
      retryPromise = captured.current!.editor.retryDraftRecovery()
      await Promise.resolve()
    })
    expect(create).toHaveBeenCalledTimes(1)
    expect(captured.current?.persistence.state).toEqual({
      status: "recovery_required",
      recovery,
    })

    let result: boolean | void = false
    await act(async () => {
      createGate.resolve()
      result = await retryPromise!
    })

    const cleanupWarning =
      "The document was restored, but one legacy recovery key could not be removed."
    expect(result).toBe(true)
    expect(captured.current?.persistence.state).toEqual({
      status: "ready",
      migration: { status: "empty" },
      warning: cleanupWarning,
    })
    expect(captured.current?.editor.draftRecovery).toBeNull()
    expect(captured.current?.editor.draftRecoveryNotice).toBe(cleanupWarning)
    await vi.waitFor(() => {
      expect(captured.current?.editor.startModel).toMatchObject({
        status: "ready",
        storageWarning: cleanupWarning,
      })
    })
  })

  it("completes Reset only after its durable starter create", async () => {
    const envelope: CurrentDraftEnvelope = {
      schemaVersion: 1,
      document: quotationStarter.document,
      sourceContext: null,
    }
    const { recovery, migration } = recoveryMigrationFor(envelope)
    localStorage.setItem(CURRENT_DRAFT_STORAGE_KEY, recovery.raw)
    const repository = createRepository("reset-order")
    const originalCreate = repository.create.bind(repository)
    const createGate = deferred<void>()
    const create = vi
      .spyOn(repository, "create")
      .mockImplementation(async (...args) => {
        await createGate.promise
        return originalCreate(...args)
      })
    const captured = await mount({
      createRepository: () => repository,
      migrate: async () => migration,
    })
    await waitForPersistenceStatus(captured, "recovery_required")
    await act(async () => {
      await vi.waitFor(() => {
        expect(captured.current?.editor.draftRecovery).toEqual(recovery)
      })
    })

    let resetPromise: Promise<boolean> | null = null
    await act(async () => {
      resetPromise = captured.current!.editor.resetDraftRecovery()
      await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    })
    expect(create).toHaveBeenCalledTimes(1)
    expect(captured.current?.persistence.state).toEqual({
      status: "recovery_required",
      recovery,
    })

    let result = false
    await act(async () => {
      createGate.resolve()
      result = await resetPromise!
    })

    expect(result).toBe(true)
    expect(captured.current?.persistence.state).toEqual({
      status: "ready",
      migration: { status: "empty" },
      warning: null,
    })
    expect(captured.current?.editor.draftRecovery).toBeNull()
    expect(captured.current?.editor.draftRecoveryNotice).toBeNull()
    expect(localStorage.getItem(CURRENT_DRAFT_STORAGE_KEY)).toBeNull()
  })
})
