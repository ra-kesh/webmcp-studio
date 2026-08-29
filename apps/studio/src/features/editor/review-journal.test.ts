import { describe, expect, it } from "vitest"
import type { ChangeSet, DocumentCommand } from "@webmcp/document"
import { quotationStarter } from "./quotation-starter"
import {
  MAX_REVIEW_RESOLVED_ENTRIES,
  createEmptyReviewJournal,
  createReviewProposal,
  resolveAppliedReview,
  resolveDiscardedReview,
  reviewJournalForStorage,
  reviewJournalOrEmpty,
  updateAllReviewOperationDecisions,
  updateReviewOperationDecision,
} from "./review-journal"

const document = quotationStarter.document
const page = document.pages[0]
const node = document.nodes.find((candidate) =>
  page.nodeIds.includes(candidate.id)
)!

const command = (
  id: string,
  patch: Extract<DocumentCommand, { type: "update_node" }>["patch"]
): DocumentCommand => ({
  id: `command-${id}`,
  type: "update_node",
  actor: "agent",
  at: "2026-08-29T06:00:00.000Z",
  nodeId: node.id,
  patch,
})

const changeSet = (id = "proposal-1"): ChangeSet => ({
  id,
  documentId: document.id,
  baseRevision: document.revision,
  baseSnapshotId: "sha256-review-fixture",
  title: `Review ${id}`,
  createdAt: "2026-08-29T06:00:00.000Z",
  createdBy: "agent",
  status: "pending",
  operations: [
    {
      id: `operation-${id}-name`,
      status: "pending",
      summary: "Rename one layer",
      command: command(`${id}-name`, { name: "Reviewed layer" }),
    },
    {
      id: `operation-${id}-opacity`,
      status: "pending",
      summary: "Change the same layer opacity",
      command: command(`${id}-opacity`, { opacity: 0.8 }),
    },
  ],
})

const resolution = (index = 1) => ({
  resolvedAt: `2026-08-29T06:${String(index).padStart(2, "0")}:00.000Z`,
  resultRevision: document.revision + index,
  resultSnapshotId: `sha256-result-${index}`,
})

describe("review journal", () => {
  it("stores explicit proposal provenance and deduplicates affected targets", () => {
    const journal = createReviewProposal(
      createEmptyReviewJournal(),
      document,
      changeSet(),
      {
        source: "webmcp",
        actorLabel: "Proposal assistant",
        toolName: "execute_product_command",
        reason: "Make the hierarchy easier to scan",
        requestId: "request-42",
      }
    )

    expect(journal.pending?.provenance).toEqual({
      source: "webmcp",
      actorLabel: "Proposal assistant",
      toolName: "execute_product_command",
      reason: "Make the hierarchy easier to scan",
      requestId: "request-42",
    })
    expect(journal.pending?.affected).toEqual([
      {
        kind: "node",
        id: node.id,
        label: node.name,
        pageId: page.id,
      },
    ])
  })

  it("updates one operation decision and then all operation decisions", () => {
    const proposal = changeSet()
    const pending = createReviewProposal(
      createEmptyReviewJournal(),
      document,
      proposal
    )
    const firstOperationId = proposal.operations[0].id

    const partiallyAccepted = updateReviewOperationDecision(
      pending,
      firstOperationId,
      "accepted"
    )
    expect(partiallyAccepted.pending?.changeSet.status).toBe(
      "partially_accepted"
    )
    expect(
      partiallyAccepted.pending?.changeSet.operations.map(
        ({ status }) => status
      )
    ).toEqual(["accepted", "pending"])

    const rejected = updateAllReviewOperationDecisions(
      partiallyAccepted,
      "rejected"
    )
    expect(rejected.pending?.changeSet.status).toBe("rejected")
    expect(
      rejected.pending?.changeSet.operations.map(({ status }) => status)
    ).toEqual(["rejected", "rejected"])
  })

  it("resolves an applied review with exact accepted and rejected operation IDs", () => {
    const proposal = changeSet("applied")
    const pending = createReviewProposal(
      createEmptyReviewJournal(),
      document,
      proposal
    )
    const decided = updateReviewOperationDecision(
      pending,
      proposal.operations[0].id,
      "accepted"
    )

    const journal = resolveAppliedReview(decided, resolution())

    expect(journal.pending).toBeNull()
    expect(journal.resolved).toHaveLength(1)
    expect(journal.resolved[0]?.resolution).toEqual({
      status: "applied",
      ...resolution(),
      acceptedOperationIds: [proposal.operations[0].id],
      rejectedOperationIds: [proposal.operations[1].id],
    })
  })

  it("resolves a discarded review by rejecting every operation", () => {
    const proposal = changeSet("discarded")
    const pending = updateAllReviewOperationDecisions(
      createReviewProposal(createEmptyReviewJournal(), document, proposal),
      "accepted"
    )

    const journal = resolveDiscardedReview(pending, resolution(2))

    expect(journal.pending).toBeNull()
    expect(journal.resolved[0]?.changeSet.status).toBe("rejected")
    expect(journal.resolved[0]?.resolution).toMatchObject({
      status: "discarded",
      acceptedOperationIds: [],
      rejectedOperationIds: proposal.operations.map(({ id }) => id),
    })
  })

  it("retains only the newest 50 resolved reviews", () => {
    let journal = createEmptyReviewJournal()
    const total = MAX_REVIEW_RESOLVED_ENTRIES + 2

    for (let index = 0; index < total; index += 1) {
      const proposal = changeSet(`bounded-${index}`)
      journal = createReviewProposal(journal, document, proposal)
      journal = resolveDiscardedReview(journal, resolution(index + 1))
    }

    expect(journal.resolved).toHaveLength(MAX_REVIEW_RESOLVED_ENTRIES)
    expect(journal.resolved[0]?.changeSet.id).toBe(`bounded-${total - 1}`)
    expect(journal.resolved.at(-1)?.changeSet.id).toBe("bounded-2")
  })

  it("defaults only missing legacy journal data to an empty journal", () => {
    expect(reviewJournalOrEmpty(undefined)).toEqual(createEmptyReviewJournal())
    expect(reviewJournalOrEmpty(null)).toEqual(createEmptyReviewJournal())
    expect(reviewJournalForStorage(createEmptyReviewJournal())).toBeUndefined()
  })

  it("rejects malformed persisted journal data instead of erasing it", () => {
    expect(() =>
      reviewJournalOrEmpty({
        schemaVersion: 1,
        pending: null,
        resolved: [],
        unexpected: true,
      })
    ).toThrow()
  })
})
