import { describe, expect, it } from "vitest"
import {
  applyAcceptedChangeSet,
  decideAllChangeOperations,
  decideChangeOperation,
  getChangeSetConflict,
  northstarSeed,
  previewChangeSet,
  type ChangeSet,
} from "../src"

const changeSet = (): ChangeSet => ({
  id: "change-set-1",
  documentId: northstarSeed.id,
  baseRevision: northstarSeed.revision,
  title: "Adapt the proposal for the new brief",
  createdAt: "2026-08-26T10:00:00.000Z",
  createdBy: "agent",
  status: "pending",
  operations: [
    {
      id: "operation-name",
      summary: "Rename the package across two outputs",
      status: "pending",
      command: {
        id: "command-name",
        type: "set_field",
        actor: "agent",
        at: "2026-08-26T10:00:00.000Z",
        fieldId: "package_name",
        value: "The Saffron Weekend",
      },
    },
    {
      id: "operation-price",
      summary: "Update the package price across two outputs",
      status: "pending",
      command: {
        id: "command-price",
        type: "set_field",
        actor: "agent",
        at: "2026-08-26T10:00:01.000Z",
        fieldId: "package_price",
        value: "₹4,10,000",
      },
    },
  ],
})

describe("change sets", () => {
  it("previews pending operations without mutating the source document", () => {
    const source = northstarSeed
    const preview = previewChangeSet(source, changeSet())

    expect(source.fieldValues.package_name).toBe("The Heirloom Weekend")
    expect(preview.fieldValues.package_name).toBe("The Saffron Weekend")
    expect(preview.fieldValues.package_price).toBe("₹4,10,000")
  })

  it("removes rejected operations from the preview and applies accepted ones", () => {
    let proposal = decideChangeOperation(
      changeSet(),
      "operation-name",
      "accepted"
    )
    proposal = decideChangeOperation(proposal, "operation-price", "rejected")

    expect(proposal.status).toBe("partially_accepted")
    expect(previewChangeSet(northstarSeed, proposal).fieldValues).toMatchObject(
      {
        package_name: "The Saffron Weekend",
        package_price: "₹3,85,000",
      }
    )
    expect(
      applyAcceptedChangeSet(northstarSeed, proposal).fieldValues
    ).toMatchObject({
      package_name: "The Saffron Weekend",
      package_price: "₹3,85,000",
    })
  })

  it("supports bulk decisions and detects stale proposals", () => {
    expect(decideAllChangeOperations(changeSet(), "accepted").status).toBe(
      "accepted"
    )
    const edited = { ...northstarSeed, revision: northstarSeed.revision + 1 }
    expect(getChangeSetConflict(edited, changeSet())).toMatchObject({
      code: "revision_mismatch",
      expectedRevision: northstarSeed.revision,
      actualRevision: northstarSeed.revision + 1,
    })
    expect(() => previewChangeSet(edited, changeSet())).toThrow(
      "The document changed"
    )
  })
})
