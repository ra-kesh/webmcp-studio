import { describe, expect, it, vi } from "vitest"
import { northstarSeed } from "@webmcp/document"
import {
  DOCUMENT_IMPORT_MAX_JSON_BYTES,
  parseDocumentImportFile,
  readBoundedDocumentImportText,
} from "./document-import"
import type {
  DocumentImportFile,
  DocumentImportResourceAdmission,
} from "./document-import"

const bytes = (value: string) => new TextEncoder().encode(value).byteLength

const importFile = (
  value: string,
  size = bytes(value)
): DocumentImportFile & { slice: ReturnType<typeof vi.fn> } => {
  const file = new File([value], "document.json", {
    type: "application/json",
  })
  if (file.size !== size) Object.defineProperty(file, "size", { value: size })
  vi.spyOn(file, "slice")
  return file as unknown as DocumentImportFile & {
    slice: ReturnType<typeof vi.fn>
  }
}

const legacyDocument = () => {
  const legacy = structuredClone(northstarSeed) as any
  legacy.schemaVersion = 1
  legacy.fields = legacy.fields.map((field: any) => {
    const {
      agentDescription: _agentDescription,
      validation: _validation,
      ...v1
    } = field
    return v1
  })
  return legacy
}

const withImage = (source: string) => {
  const document = structuredClone(northstarSeed)
  document.nodes.push({
    id: "import-image",
    type: "image",
    name: "Imported image",
    x: 10,
    y: 10,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    assetId:
      source.startsWith("asset:managed/") || source.startsWith("asset:local/")
        ? source.slice(source.indexOf("/") + 1)
        : "import-image",
    src: source,
    placement: {
      mode: "fill",
      focalX: 0.5,
      focalY: 0.5,
      zoom: 1,
      rotation: 0,
      flipX: false,
      flipY: false,
    },
    frameMask: { shape: "rectangle" },
    alt: "Imported photograph",
    decorative: false,
  })
  document.pages[0].nodeIds.push("import-image")
  return document
}

const localAsset = (id: string) => {
  const blob = new Blob(["verified local image"], { type: "image/png" })
  return {
    schemaVersion: 4 as const,
    id,
    name: "Verified local image",
    blob,
    mediaType: blob.type,
    size: blob.size,
    width: 100,
    height: 100,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
    lastUsedAt: "2026-08-30T00:00:00.000Z",
    archivedAt: null,
    revision: 1,
    integrity: "ready" as const,
  }
}

const managedAsset = (id: string, status: "ready" | "archived" = "ready") => ({
  id,
  status,
  selectable: status === "ready",
})

const localPromotion = (
  localAssetId: string,
  {
    status = "ready",
    contentSha256 = "a".repeat(64),
    assetId = "asset-importcopy01",
  }: {
    status?: "ready" | "archived"
    contentSha256?: string
    assetId?: string
  } = {}
) => ({
  localAssetId,
  contentSha256,
  asset: {
    id: assetId,
    name: "Imported Studio copy",
    mediaType: "image/png" as const,
    bytes: 20,
    width: 100,
    height: 100,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
    lastUsedAt: "2026-08-30T00:00:00.000Z",
    status,
    selectable: status === "ready",
    revision: 1,
  },
})

const resourceAdmission = ({
  local = async (assetIds) =>
    assetIds.map(() => ({ status: "absent" as const })),
  mappings = async (assetIds) => ({
    results: assetIds.map((localAssetId) => ({
      localAssetId,
      promotion: null,
    })),
    requestId: "request-import-plan",
  }),
  hash = async () => "a".repeat(64),
  managed = async () => null,
}: {
  local?: DocumentImportResourceAdmission["inspectLocalAssets"]
  mappings?: DocumentImportResourceAdmission["resolveLocalPromotions"]
  hash?: DocumentImportResourceAdmission["hashLocalAsset"]
  managed?: DocumentImportResourceAdmission["resolveManagedAsset"]
} = {}): DocumentImportResourceAdmission => ({
  inspectLocalAssets: vi.fn(local),
  resolveLocalPromotions: vi.fn(mappings),
  hashLocalAsset: vi.fn(hash),
  resolveManagedAsset: vi.fn(managed),
})

describe("document JSON import admission", () => {
  it("rejects an empty file before reading it", async () => {
    const file = importFile("", 0)

    await expect(parseDocumentImportFile(file)).resolves.toMatchObject({
      ok: false,
      failure: { kind: "empty_file" },
    })
    expect(file.slice).not.toHaveBeenCalled()
  })

  it("rejects an oversized file before reading it", async () => {
    const file = importFile("{}", DOCUMENT_IMPORT_MAX_JSON_BYTES + 1)

    await expect(parseDocumentImportFile(file)).resolves.toMatchObject({
      ok: false,
      failure: { kind: "oversized_file" },
    })
    expect(file.slice).not.toHaveBeenCalled()
  })

  it("rejects whitespace-only and unreadable files explicitly", async () => {
    const whitespace = importFile(" \n\t")
    await expect(parseDocumentImportFile(whitespace)).resolves.toMatchObject({
      ok: false,
      failure: { kind: "empty_file" },
    })

    const unreadable: DocumentImportFile = {
      size: 10,
      slice: vi.fn(),
      text: vi.fn(async () => {
        throw new Error("disk unavailable")
      }),
    }
    await expect(parseDocumentImportFile(unreadable)).resolves.toMatchObject({
      ok: false,
      failure: { kind: "file_read_failed" },
    })
  })

  it("acknowledges file-read cancellation and ignores the late result", async () => {
    let resolveText!: (value: string) => void
    const text = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveText = resolve
        })
    )
    const file: DocumentImportFile = {
      size: 2,
      slice: vi.fn(),
      text,
    }
    const controller = new AbortController()
    const reason = new DOMException("Import cancelled", "AbortError")
    const pending = parseDocumentImportFile(file, undefined, {
      signal: controller.signal,
    })

    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
    resolveText("{}")
    await Promise.resolve()
    expect(text).toHaveBeenCalledOnce()
  })

  it("aborts and detaches the browser FileReader before rejecting", async () => {
    class ControlledFileReader {
      static readonly EMPTY = 0
      static readonly LOADING = 1
      static readonly DONE = 2
      readyState = ControlledFileReader.EMPTY
      result: string | ArrayBuffer | null = null
      readonly listeners = new Map<
        string,
        Set<EventListenerOrEventListenerObject>
      >()
      readonly abort = vi.fn(() => {
        this.readyState = ControlledFileReader.DONE
        this.emit("abort")
      })

      addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject | null
      ) {
        if (!listener) return
        const listeners = this.listeners.get(type) ?? new Set()
        listeners.add(listener)
        this.listeners.set(type, listeners)
      }

      removeEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject | null
      ) {
        if (listener) this.listeners.get(type)?.delete(listener)
      }

      readAsText() {
        this.readyState = ControlledFileReader.LOADING
      }

      private emit(type: string) {
        const event = new Event(type)
        for (const listener of this.listeners.get(type) ?? []) {
          if (typeof listener === "function") listener(event)
          else listener.handleEvent(event)
        }
      }
    }

    const readers: ControlledFileReader[] = []
    const Reader = class extends ControlledFileReader {
      constructor() {
        super()
        readers.push(this)
      }
    }
    vi.stubGlobal("FileReader", Reader)
    try {
      const controller = new AbortController()
      const reason = new DOMException("Import cancelled", "AbortError")
      const file = new File(["{}"], "document.json", {
        type: "application/json",
      })
      const pending = readBoundedDocumentImportText(file, controller.signal)

      controller.abort(reason)
      await expect(pending).rejects.toBe(reason)
      expect(readers[0]?.abort).toHaveBeenCalledOnce()
      expect(
        [...(readers[0]?.listeners.values() ?? [])].every(
          (listeners) => listeners.size === 0
        )
      ).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("classifies malformed JSON separately from schema-invalid JSON", async () => {
    await expect(
      parseDocumentImportFile(importFile('{"schemaVersion":'))
    ).resolves.toMatchObject({
      ok: false,
      failure: { kind: "malformed_json" },
    })

    await expect(
      parseDocumentImportFile(
        importFile(JSON.stringify({ schemaVersion: 2, id: "partial" }))
      )
    ).resolves.toMatchObject({
      ok: false,
      failure: { kind: "schema_invalid" },
    })
  })

  it.each([
    "asset:local/",
    "asset:local/../private",
    "asset:local/folder/private",
    "asset:managed/not-a-workspace-asset",
    "asset:managed/asset-short",
  ])(
    "rejects malformed Studio-owned identity %s before repository admission",
    async (source) => {
      const admission = resourceAdmission()
      const document = withImage(source)
      const image = document.nodes.find((node) => node.id === "import-image")
      if (!image || image.type !== "image") {
        throw new Error("Expected the malformed image fixture")
      }
      image.assetId = "malformed-owned-identity"

      await expect(
        parseDocumentImportFile(importFile(JSON.stringify(document)), admission)
      ).resolves.toMatchObject({
        ok: false,
        failure: {
          kind: "schema_invalid",
        },
      })
      expect(admission.inspectLocalAssets).not.toHaveBeenCalled()
      expect(admission.resolveLocalPromotions).not.toHaveBeenCalled()
      expect(admission.resolveManagedAsset).not.toHaveBeenCalled()
    }
  )

  it("classifies a canonical document with invalid relationships", async () => {
    const invalid = structuredClone(northstarSeed)
    invalid.nodes.push({ ...invalid.nodes[0], id: "orphan-import-node" })

    await expect(
      parseDocumentImportFile(importFile(JSON.stringify(invalid)))
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: "aggregate_invalid",
        issue: { code: "orphan_node" },
      },
    })
  })

  it("classifies a legacy document that cannot be migrated safely", async () => {
    const legacy = legacyDocument()
    legacy.nodes.push({
      ...withImage("https://assets.example.test/source.png").nodes.at(-1),
      id: "legacy-bound-image",
    })
    legacy.pages[0].nodeIds.push("legacy-bound-image")
    legacy.fields.push({
      id: "legacy_asset",
      key: "legacy_asset",
      label: "Legacy asset",
      type: "asset",
      required: true,
      defaultValue: "ftp://legacy.example.test/source.png",
    })
    legacy.fieldValues.legacy_asset = "ftp://legacy.example.test/source.png"
    legacy.bindings.push({
      id: "legacy_asset_binding",
      fieldId: "legacy_asset",
      nodeId: "legacy-bound-image",
      property: "src",
    })

    await expect(
      parseDocumentImportFile(importFile(JSON.stringify(legacy)))
    ).resolves.toMatchObject({
      ok: false,
      failure: { kind: "migration_failed" },
    })
  })

  it("applies renderer limits after canonical decoding", async () => {
    const oversizedPage = structuredClone(northstarSeed)
    oversizedPage.pages[0].width = 8_193

    await expect(
      parseDocumentImportFile(importFile(JSON.stringify(oversizedPage)))
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: "render_policy_failed",
        issue: { code: "render_limit_exceeded" },
      },
    })
  })

  it.each([
    {
      label: "an unmanaged remote image",
      document: withImage("https://assets.example.test/source.png"),
      code: "unmanaged_asset",
    },
    {
      label: "an unavailable renderer font",
      document: (() => {
        const document = structuredClone(northstarSeed)
        const textNode = document.nodes.find((node) => node.type === "text")
        if (!textNode) {
          throw new Error("Expected a text node in the canonical fixture")
        }
        textNode.fontFamily = "Unavailable Sans"
        return document
      })(),
      code: "unsupported_font",
    },
  ])(
    "rejects $label under editable resource policy",
    async ({ document, code }) => {
      await expect(
        parseDocumentImportFile(importFile(JSON.stringify(document)))
      ).resolves.toMatchObject({
        ok: false,
        failure: {
          kind: "resource_policy_failed",
          issue: { code },
        },
      })
    }
  )

  it("accepts a canonical current document without changing it", async () => {
    await expect(
      parseDocumentImportFile(importFile(JSON.stringify(northstarSeed)))
    ).resolves.toMatchObject({
      ok: true,
      document: northstarSeed,
      migrations: [],
      mediaPlan: { status: "not_required" },
      candidateDocument: null,
      recoveryManifest: { requiresReview: false, aliasCount: 0 },
    })
  })

  it("accepts and reports canonical migration of a valid legacy document", async () => {
    const legacy = legacyDocument()
    const result = await parseDocumentImportFile(
      importFile(JSON.stringify(legacy))
    )

    expect(result).toMatchObject({
      ok: true,
      document: { schemaVersion: 5 },
      migrations: expect.arrayContaining([
        expect.objectContaining({ code: "document_schema_upgraded" }),
      ]),
    })
  })

  it("round-trips a canonical local image when its metadata and bytes are readable", async () => {
    const assetId = "local-round-trip"
    const document = withImage(`asset:local/${assetId}`)
    const admission = resourceAdmission({
      local: async (requestedIds) =>
        requestedIds.map((requestedId) =>
          requestedId === assetId
            ? { status: "ready" as const, record: localAsset(assetId) }
            : { status: "absent" as const }
        ),
    })

    await expect(
      parseDocumentImportFile(importFile(JSON.stringify(document)), admission)
    ).resolves.toMatchObject({
      ok: true,
      document,
      migrations: [],
      mediaPlan: {
        status: "planned",
        plan: {
          safeMigrations: [],
          unresolved: [
            expect.objectContaining({
              localAssetId: assetId,
              outcome: "local_only",
            }),
          ],
        },
      },
      candidateDocument: null,
    })
    expect(admission.inspectLocalAssets).toHaveBeenCalledOnce()
    expect(admission.inspectLocalAssets).toHaveBeenCalledWith([assetId])
  })

  it("plans a missing local image for review without rejecting the valid document", async () => {
    const assetId = "local-missing"
    const admission = resourceAdmission()

    await expect(
      parseDocumentImportFile(
        importFile(JSON.stringify(withImage(`asset:local/${assetId}`))),
        admission
      )
    ).resolves.toMatchObject({
      ok: true,
      mediaPlan: {
        status: "planned",
        plan: {
          unresolved: [
            {
              localAssetId: assetId,
              outcome: "missing_unmapped",
              localStatus: "absent",
              mappingStatus: "unmapped",
              managedCandidate: null,
              localSource: `asset:local/${assetId}`,
              expectedReferenceKeys: ["node/import-image/src"],
            },
          ],
        },
      },
      candidateDocument: null,
      recoveryManifest: {
        requiresReview: true,
        aliasCount: 1,
        unresolvedCount: 1,
        items: [
          expect.objectContaining({
            localAssetId: assetId,
            state: "file_missing",
            transformed: false,
            nodeIds: ["import-image"],
          }),
        ],
      },
    })
    expect(admission.inspectLocalAssets).toHaveBeenCalledWith([assetId])
  })

  it("finishes canonical and render validation before any local mapping lookup", async () => {
    const document = withImage("asset:local/local-validation-order")
    document.pages[0].width = 8_193
    const admission = resourceAdmission()

    await expect(
      parseDocumentImportFile(importFile(JSON.stringify(document)), admission)
    ).resolves.toMatchObject({
      ok: false,
      failure: { kind: "render_policy_failed" },
    })
    expect(admission.inspectLocalAssets).not.toHaveBeenCalled()
    expect(admission.resolveLocalPromotions).not.toHaveBeenCalled()
    expect(admission.hashLocalAsset).not.toHaveBeenCalled()
  })

  it.each([
    { status: "ready" as const, state: "studio_copy" },
    { status: "archived" as const, state: "studio_backup" },
  ])(
    "returns an isolated exact $status mapping candidate and review manifest",
    async ({ status, state }) => {
      const localAssetId = `local-mapped-${status}`
      const source = `asset:local/${localAssetId}`
      const document = withImage(source)
      const original = structuredClone(document)
      const promotion = localPromotion(localAssetId, { status })
      const admission = resourceAdmission({
        local: async () => [{ status: "absent" }],
        mappings: async () => ({
          results: [{ localAssetId, promotion }],
          requestId: `request-mapped-${status}`,
        }),
      })

      const result = await parseDocumentImportFile(
        importFile(JSON.stringify(document)),
        admission
      )

      expect(result).toMatchObject({
        ok: true,
        document: original,
        mediaPlan: {
          status: "planned",
          mappingRequestIds: [`request-mapped-${status}`],
          plan: {
            safeMigrations: [
              expect.objectContaining({
                localAssetId,
                managedStatus: status,
                relationship: "no_local_bytes",
              }),
            ],
            unresolved: [],
          },
        },
        candidateDocument: {
          nodes: expect.arrayContaining([
            expect.objectContaining({
              id: "import-image",
              assetId: promotion.asset.id,
              src: `asset:managed/${promotion.asset.id}`,
            }),
          ]),
        },
        recoveryManifest: {
          requiresReview: true,
          transformedCount: 1,
          unresolvedCount: 0,
          archivedBackupCount: status === "archived" ? 1 : 0,
          items: [
            expect.objectContaining({
              localAssetId,
              state,
              transformed: true,
              requiresChoice: false,
              nodeIds: ["import-image"],
            }),
          ],
        },
      })
      expect(document).toEqual(original)
      expect(admission.hashLocalAsset).not.toHaveBeenCalled()
    }
  )

  it("accepts a healthy local file only when its exact hash matches the mapping", async () => {
    const localAssetId = "local-import-same-hash"
    const document = withImage(`asset:local/${localAssetId}`)
    const admission = resourceAdmission({
      local: async () => [
        { status: "ready", record: localAsset(localAssetId) },
      ],
      mappings: async () => ({
        results: [
          {
            localAssetId,
            promotion: localPromotion(localAssetId),
          },
        ],
        requestId: "request-import-same-hash",
      }),
      hash: async () => "a".repeat(64),
    })

    await expect(
      parseDocumentImportFile(importFile(JSON.stringify(document)), admission)
    ).resolves.toMatchObject({
      ok: true,
      mediaPlan: {
        status: "planned",
        plan: {
          safeMigrations: [
            expect.objectContaining({
              localAssetId,
              relationship: "same_hash",
            }),
          ],
          unresolved: [],
        },
      },
      candidateDocument: expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: "import-image",
            src: "asset:managed/asset-importcopy01",
          }),
        ]),
      }),
    })
    expect(admission.hashLocalAsset).toHaveBeenCalledOnce()
  })

  it("returns an identity-conflict decision without creating a candidate", async () => {
    const localAssetId = "local-import-conflict"
    const document = withImage(`asset:local/${localAssetId}`)
    const admission = resourceAdmission({
      local: async () => [
        { status: "ready", record: localAsset(localAssetId) },
      ],
      mappings: async () => ({
        results: [
          {
            localAssetId,
            promotion: localPromotion(localAssetId, {
              contentSha256: "b".repeat(64),
            }),
          },
        ],
        requestId: "request-import-conflict",
      }),
      hash: async () => "a".repeat(64),
    })

    await expect(
      parseDocumentImportFile(importFile(JSON.stringify(document)), admission)
    ).resolves.toMatchObject({
      ok: true,
      candidateDocument: null,
      mediaPlan: {
        status: "planned",
        plan: {
          unresolved: [
            expect.objectContaining({
              localAssetId,
              outcome: "identity_conflict",
              managedCandidate: expect.objectContaining({
                managedAssetId: "asset-importcopy01",
              }),
            }),
          ],
        },
      },
      recoveryManifest: {
        items: [
          expect.objectContaining({
            state: "identity_conflict",
            requiresChoice: true,
          }),
        ],
      },
    })
  })

  it.each([
    {
      label: "mapping timeout",
      local: async () => [{ status: "absent" as const }],
      mappings: async () => {
        throw new DOMException("Mapping timed out", "TimeoutError")
      },
      state: "backup_status_unknown",
      outcome: "mapping_unavailable",
    },
    {
      label: "local repository failure with an exact Studio copy",
      local: async () => {
        throw new Error("IndexedDB unavailable")
      },
      mappings: async (assetIds: readonly string[]) => ({
        results: assetIds.map((localAssetId) => ({
          localAssetId,
          promotion: localPromotion(localAssetId),
        })),
        requestId: "request-local-unknown",
      }),
      state: "device_status_unknown",
      outcome: "local_unavailable",
    },
  ])("represents $label as reviewable unknown state", async (fixture) => {
    const localAssetId = "local-import-unknown"
    const admission = resourceAdmission({
      local: fixture.local,
      mappings: fixture.mappings,
    })

    await expect(
      parseDocumentImportFile(
        importFile(JSON.stringify(withImage(`asset:local/${localAssetId}`))),
        admission
      )
    ).resolves.toMatchObject({
      ok: true,
      candidateDocument: null,
      mediaPlan: {
        status: "planned",
        plan: {
          unresolved: [expect.objectContaining({ outcome: fixture.outcome })],
        },
      },
      recoveryManifest: {
        items: [expect.objectContaining({ state: fixture.state })],
      },
    })
  })

  it("treats a malformed ordered mapping response as unknown, never unmapped", async () => {
    const localAssetId = "local-import-order-drift"
    const admission = resourceAdmission({
      mappings: async () => ({
        results: [
          {
            localAssetId: "local-other-alias",
            promotion: null,
          },
        ],
        requestId: "request-order-drift",
      }),
    })

    await expect(
      parseDocumentImportFile(
        importFile(JSON.stringify(withImage(`asset:local/${localAssetId}`))),
        admission
      )
    ).resolves.toMatchObject({
      ok: true,
      mediaPlan: {
        status: "planned",
        mappingRequestIds: [],
        plan: {
          unresolved: [
            expect.objectContaining({
              localAssetId,
              outcome: "mapping_unavailable",
              mappingStatus: "unavailable",
            }),
          ],
        },
      },
      recoveryManifest: {
        items: [expect.objectContaining({ state: "backup_status_unknown" })],
      },
    })
  })

  it("forwards mapping cancellation and waits for resolver acknowledgement", async () => {
    const localAssetId = "local-import-cancel"
    let receivedSignal: AbortSignal | undefined
    let acknowledgeAbort!: (reason: unknown) => void
    const resolver = new Promise<never>((_resolve, reject) => {
      acknowledgeAbort = reject
    })
    const admission = resourceAdmission({
      mappings: async (_assetIds, signal) => {
        receivedSignal = signal
        return resolver
      },
    })
    const controller = new AbortController()
    const reason = new DOMException("Import cancelled", "AbortError")
    const pending = parseDocumentImportFile(
      importFile(JSON.stringify(withImage(`asset:local/${localAssetId}`))),
      admission,
      { signal: controller.signal }
    )

    await vi.waitFor(() => expect(receivedSignal).toBe(controller.signal))
    controller.abort(reason)
    let settled = false
    void pending.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    await Promise.resolve()
    expect(settled).toBe(false)
    acknowledgeAbort(reason)
    await expect(pending).rejects.toBe(reason)
  })

  it.each([
    {
      label: "repository read failure",
      inspect: async () => {
        throw new Error("IndexedDB unavailable")
      },
    },
    {
      label: "missing bytes",
      inspect: async () => {
        const asset = localAsset("local-unreadable")
        const { blob: _blob, ...summary } = asset
        return [
          {
            status: "missing_bytes" as const,
            summary: { ...summary, integrity: "missing_bytes" as const },
            issue: {
              assetId: asset.id,
              code: "missing_bytes" as const,
              message: "The saved image bytes are missing.",
            },
          },
        ]
      },
    },
    {
      label: "metadata and byte mismatch",
      inspect: async () => {
        const asset = localAsset("local-unreadable")
        return [
          {
            status: "ready" as const,
            record: { ...asset, size: asset.size + 1 },
          },
        ]
      },
    },
  ])(
    "preserves an unreadable local image for review: $label",
    async ({ inspect }) => {
      const document = withImage("asset:local/local-unreadable")

      await expect(
        parseDocumentImportFile(
          importFile(JSON.stringify(document)),
          resourceAdmission({
            local: inspect,
          })
        )
      ).resolves.toMatchObject({
        ok: true,
        candidateDocument: null,
        recoveryManifest: { requiresReview: true, unresolvedCount: 1 },
      })
    }
  )

  it("admits canonical managed image identities only after an exact workspace lookup", async () => {
    const document = withImage("asset:managed/asset-abcdefghij")
    const admission = resourceAdmission({
      managed: async (assetId) => managedAsset(assetId),
    })

    await expect(
      parseDocumentImportFile(importFile(JSON.stringify(document)), admission)
    ).resolves.toMatchObject({
      ok: true,
      document: {
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: "import-image",
            assetId: "asset-abcdefghij",
          }),
        ]),
      },
    })
    expect(admission.resolveManagedAsset).toHaveBeenCalledOnce()
    expect(admission.resolveManagedAsset).toHaveBeenCalledWith(
      "asset-abcdefghij"
    )
  })

  it("forwards cancellation to managed resource admission without relabeling it", async () => {
    const document = withImage("asset:managed/asset-cancelled01")
    let receivedSignal: AbortSignal | undefined
    let acknowledgeAbort!: (reason: unknown) => void
    const resolver = new Promise<never>((_resolve, reject) => {
      acknowledgeAbort = reject
    })
    const admission = resourceAdmission({
      managed: async (_assetId, signal) => {
        receivedSignal = signal
        return resolver
      },
    })
    const controller = new AbortController()
    const reason = new DOMException("Import timed out", "TimeoutError")
    const pending = parseDocumentImportFile(
      importFile(JSON.stringify(document)),
      admission,
      { signal: controller.signal }
    )

    await vi.waitFor(() => expect(receivedSignal).toBe(controller.signal))
    controller.abort(reason)
    let settled = false
    void pending.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    await Promise.resolve()
    expect(settled).toBe(false)
    acknowledgeAbort(reason)
    await expect(pending).rejects.toBe(reason)
  })

  it("rejects a missing managed identity instead of accepting an arbitrary valid ID", async () => {
    const admission = resourceAdmission()

    await expect(
      parseDocumentImportFile(
        importFile(
          JSON.stringify(withImage("asset:managed/asset-unknown0000"))
        ),
        admission
      )
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: "resource_policy_failed",
        issue: { code: "missing_asset", nodeId: "import-image" },
      },
    })
    expect(admission.resolveManagedAsset).toHaveBeenCalledWith(
      "asset-unknown0000"
    )
  })

  it("round-trips an exact archived managed reference retained by the workspace", async () => {
    const assetId = "asset-archived001"
    const document = withImage(`asset:managed/${assetId}`)
    const admission = resourceAdmission({
      managed: async () => managedAsset(assetId, "archived"),
    })

    await expect(
      parseDocumentImportFile(importFile(JSON.stringify(document)), admission)
    ).resolves.toMatchObject({
      ok: true,
      document,
      migrations: [],
      mediaPlan: { status: "not_required" },
    })
  })

  it.each([
    {
      label: "mismatched lookup identity",
      resolve: async () => managedAsset("asset-different001"),
    },
    {
      label: "repository read failure",
      resolve: async () => {
        throw new Error("workspace unavailable")
      },
    },
  ])("rejects a managed image that is $label", async ({ resolve }) => {
    const document = withImage("asset:managed/asset-unavailable01")

    await expect(
      parseDocumentImportFile(
        importFile(JSON.stringify(document)),
        resourceAdmission({ managed: resolve })
      )
    ).resolves.toMatchObject({
      ok: false,
      failure: { kind: "resource_policy_failed" },
    })
  })

  it("resolves asset-field-only identities and deduplicates repeated references", async () => {
    const document = withImage("asset:managed/asset-fieldonly01")
    document.nodes = document.nodes.filter((node) => node.id !== "import-image")
    document.pages[0].nodeIds = document.pages[0].nodeIds.filter(
      (nodeId) => nodeId !== "import-image"
    )
    document.fields.push({
      id: "field-import-image",
      key: "import_image",
      label: "Import image",
      agentDescription: "Image used by the imported document",
      type: "asset",
      required: false,
      defaultValue: "asset:managed/asset-fieldonly01",
      validation: {},
    })
    document.fieldValues["field-import-image"] =
      "asset:managed/asset-fieldonly01"
    const admission = resourceAdmission({
      managed: async (assetId) => managedAsset(assetId),
    })

    await expect(
      parseDocumentImportFile(importFile(JSON.stringify(document)), admission)
    ).resolves.toMatchObject({ ok: true })
    expect(admission.resolveManagedAsset).toHaveBeenCalledOnce()
  })
})
