import { describe, expect, test } from "vitest"
import {
  composeQuotationDocument,
  northstarQuotationPayload,
} from "@webmcp/document"
import {
  createDraftRecoveryRecord,
  decodeStoredDraft,
  parseDraftRecoveryRecord,
} from "./draft-recovery"

const validDocument = composeQuotationDocument(
  northstarQuotationPayload,
  "editorial-olive"
)

describe("local draft recovery boundary", () => {
  test("classifies malformed JSON without running migration", () => {
    let migrationCalls = 0
    const result = decodeStoredDraft('{"schemaVersion":', (document) => {
      migrationCalls += 1
      return document
    })

    expect(result).toMatchObject({
      ok: false,
      failure: { kind: "malformed_json" },
    })
    expect(migrationCalls).toBe(0)
  })

  test("classifies schema-invalid data without running migration", () => {
    let migrationCalls = 0
    const result = decodeStoredDraft(
      JSON.stringify({ schemaVersion: 1, id: "partial-draft" }),
      (document) => {
        migrationCalls += 1
        return document
      }
    )

    expect(result).toMatchObject({
      ok: false,
      failure: { kind: "schema_invalid" },
    })
    expect(migrationCalls).toBe(0)
  })

  test("validates relationships after the migration boundary", () => {
    const relationshipInvalid = {
      ...validDocument,
      nodes: [
        ...validDocument.nodes,
        { ...validDocument.nodes[0], id: "orphan-restored-node" },
      ],
    }
    const result = decodeStoredDraft(JSON.stringify(relationshipInvalid))

    expect(result).toMatchObject({
      ok: false,
      failure: {
        kind: "aggregate_invalid",
        issue: { code: "orphan_node" },
      },
    })
  })

  test("contains migration exceptions and does not trust their output", () => {
    const result = decodeStoredDraft(JSON.stringify(validDocument), () => {
      throw new Error("legacy migrator failed")
    })

    expect(result).toMatchObject({
      ok: false,
      failure: { kind: "migration_failed" },
    })
  })

  test("round-trips quarantined source bytes exactly", () => {
    const raw = '{\n  "unfinished": true,\n'
    const record = createDraftRecoveryRecord({
      sourceStorageKey: "production-key",
      raw,
      failure: {
        kind: "malformed_json",
        message: "The saved draft is not valid JSON.",
      },
      capturedAt: "2026-08-28T08:00:00.000Z",
    })

    expect(parseDraftRecoveryRecord(JSON.stringify(record))).toEqual(record)
    expect(parseDraftRecoveryRecord(JSON.stringify(record))?.raw).toBe(raw)
    expect(parseDraftRecoveryRecord("not json")).toBeNull()
  })

  test("restores a valid document only after schema, migration, and aggregate checks", () => {
    let migrated = false
    const result = decodeStoredDraft(
      JSON.stringify(validDocument),
      (document) => {
        migrated = true
        return { ...document, name: "Migrated quotation" }
      }
    )

    expect(migrated).toBe(true)
    expect(result).toMatchObject({
      ok: true,
      document: { name: "Migrated quotation" },
    })
  })

  test("migrates a real pre-FIELD v1 draft before applying the current schema", () => {
    const source = structuredClone(validDocument)
    const target = source.fields[0]
    const legacy = {
      ...source,
      schemaVersion: 1,
      groups: source.groups.map(({ role: _role, ...group }) => group),
      fields: source.fields.map((field) => {
        const {
          agentDescription: _description,
          validation: _validation,
          ...v1
        } = field
        return field.id === target.id
          ? {
              ...v1,
              type: "date" as const,
              defaultValue: "28 August 2026",
            }
          : v1
      }),
      fieldValues: {
        ...source.fieldValues,
        [target.id]: "28 August 2026",
      },
    }

    const result = decodeStoredDraft(JSON.stringify(legacy))

    expect(result).toMatchObject({
      ok: true,
      document: {
        fields: expect.arrayContaining([
          expect.objectContaining({ id: target.id, type: "date" }),
        ]),
        fieldValues: { [target.id]: "2026-08-28" },
      },
    })
  })

  test("preserves valid current-schema grouping instead of inferring provenance", () => {
    const flat = { ...structuredClone(validDocument), groups: [] }
    const topLevel = validDocument.groups.find(
      (group) => group.parentGroupId === undefined
    )!
    const partial = {
      ...structuredClone(validDocument),
      groups: [{ ...topLevel, name: "User-authored matching block" }],
    }
    const coincidental = structuredClone(validDocument)
    const firstGroup = coincidental.groups.at(0)
    if (!firstGroup) throw new Error("The quotation fixture has no groups")
    coincidental.groups = coincidental.groups.map((group, index) =>
      index === 0
        ? {
            ...group,
            id: "custom-coincidental-group",
            name: "My own section name",
          }
        : {
            ...group,
            parentGroupId:
              group.parentGroupId === firstGroup.id
                ? "custom-coincidental-group"
                : group.parentGroupId,
          }
    )

    for (const document of [flat, partial, coincidental, validDocument]) {
      const serialized = JSON.stringify(document)
      const result = decodeStoredDraft(serialized)
      expect(result).toEqual({ ok: true, document })
      if (result.ok) expect(JSON.stringify(result.document)).toBe(serialized)
    }
  })
})
