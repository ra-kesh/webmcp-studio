import { describe, expect, test } from "vitest"
import { createEditorWorkspaceRecord } from "@webmcp/editor/page-guides"
import type { EditorWorkspaceRecordV1 } from "@webmcp/editor/page-guides"
import {
  EDITOR_WORKSPACE_STORAGE_KEY,
  EditorWorkspaceRepository,
  getPageGuides,
  parseEditorWorkspaceQuarantineRecord,
  pruneEditorWorkspaceRecord,
  setEditorWorkspacePreferences,
  setPageGuides,
} from "./editor-workspace-state"

class MemoryStorage implements Storage {
  #items = new Map<string, string>()
  failGet = false
  failSet = false

  get length() {
    return this.#items.size
  }

  clear() {
    this.#items.clear()
  }

  getItem(key: string) {
    if (this.failGet) throw new Error("read unavailable")
    return this.#items.get(key) ?? null
  }

  key(index: number) {
    return [...this.#items.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.#items.delete(key)
  }

  setItem(key: string, value: string) {
    if (this.failSet) throw new Error("write unavailable")
    this.#items.set(key, value)
  }
}

function populatedRecord() {
  let record = createEditorWorkspaceRecord()
  record = setPageGuides(record, "document-a", "cover", [
    { id: "cover-x", axis: "x", position: 100 },
  ])
  record = setPageGuides(record, "document-a", "details", [
    { id: "details-y", axis: "y", position: 200 },
  ])
  return setPageGuides(record, "document-b", "cover", [
    { id: "other-x", axis: "x", position: 300 },
  ])
}

describe("editor workspace state", () => {
  test("isolates guides by document and page and removes empty records", () => {
    const record = populatedRecord()
    expect(getPageGuides(record, "document-a", "cover")).toEqual([
      { id: "cover-x", axis: "x", position: 100 },
    ])
    expect(getPageGuides(record, "document-a", "details")).toEqual([
      { id: "details-y", axis: "y", position: 200 },
    ])
    expect(getPageGuides(record, "document-b", "cover")).toEqual([
      { id: "other-x", axis: "x", position: 300 },
    ])
    const withoutCover = setPageGuides(record, "document-b", "cover", [])
    expect(withoutCover.documents["document-b"]).toBeUndefined()
    expect(() =>
      setPageGuides(record, "__proto__", "cover", [
        { id: "unsafe", axis: "x", position: 1 },
      ])
    ).toThrow(/safe record key/)
  })

  test("updates stable preferences without changing guide records", () => {
    const record = populatedRecord()
    const updated = setEditorWorkspacePreferences(record, {
      rulersVisible: false,
      guidesVisible: false,
    })
    expect(updated.preferences).toEqual({
      rulersVisible: false,
      guidesVisible: false,
    })
    expect(updated.documents).toEqual(record.documents)
  })

  test("prunes deleted pages and replaced documents from the sidecar", () => {
    const pruned = pruneEditorWorkspaceRecord(populatedRecord(), [
      { id: "document-a", pageIds: ["details"] },
    ])
    expect(Object.keys(pruned.documents)).toEqual(["document-a"])
    expect(
      Object.keys(Object.values(pruned.documents)[0]?.pages ?? {})
    ).toEqual(["details"])
  })
})

describe("editor workspace local repository", () => {
  test("reports empty storage, then persists and restores exact state", () => {
    const storage = new MemoryStorage()
    const repository = new EditorWorkspaceRepository(storage)
    expect(repository.load()).toMatchObject({ status: "empty" })

    const record = populatedRecord()
    expect(repository.save(record)).toEqual({ ok: true })
    expect(repository.load()).toEqual({ status: "restored", record })
  })

  test("quarantines corrupt bytes exactly and resets only workspace state", () => {
    const storage = new MemoryStorage()
    const raw = '{\n  "version": 1,\n'
    storage.setItem(EDITOR_WORKSPACE_STORAGE_KEY, raw)
    const repository = new EditorWorkspaceRepository(storage, {
      now: () => "2026-08-28T12:30:45.000Z",
    })

    const result = repository.load()
    expect(result).toMatchObject({
      status: "recovered",
      record: createEditorWorkspaceRecord(),
      rawPreservedAt: "quarantine",
    })
    if (result.status !== "recovered" || !result.quarantineKey)
      throw new Error("Expected quarantined workspace recovery")
    expect(storage.getItem(EDITOR_WORKSPACE_STORAGE_KEY)).toBeNull()
    expect(
      parseEditorWorkspaceQuarantineRecord(
        storage.getItem(result.quarantineKey)
      )
    ).toMatchObject({ raw, failure: { code: "invalid_json" } })
  })

  test("keeps corrupt source bytes in place if a quarantine copy cannot be written", () => {
    const storage = new MemoryStorage()
    const raw = "not json"
    storage.setItem(EDITOR_WORKSPACE_STORAGE_KEY, raw)
    storage.failSet = true
    const result = new EditorWorkspaceRepository(storage).load()
    expect(result).toMatchObject({
      status: "recovered",
      rawPreservedAt: "source",
      quarantineKey: null,
    })
    expect(storage.getItem(EDITOR_WORKSPACE_STORAGE_KEY)).toBe(raw)
  })

  test("contains unavailable storage and validation failures", () => {
    const storage = new MemoryStorage()
    storage.failGet = true
    expect(new EditorWorkspaceRepository(storage).load()).toMatchObject({
      status: "unavailable",
      error: { message: "read unavailable" },
    })

    storage.failGet = false
    const invalid = {
      ...createEditorWorkspaceRecord(),
      preferences: { rulersVisible: "yes", guidesVisible: true },
    } as unknown as EditorWorkspaceRecordV1
    expect(new EditorWorkspaceRepository(storage).save(invalid)).toMatchObject({
      ok: false,
    })
  })

  test("prunes and persists in one repository operation", () => {
    const storage = new MemoryStorage()
    const repository = new EditorWorkspaceRepository(storage)
    const pruned = repository.prune(populatedRecord(), [
      { id: "document-a", pageIds: ["cover"] },
    ])
    expect(repository.load()).toEqual({ status: "restored", record: pruned })
  })
})
