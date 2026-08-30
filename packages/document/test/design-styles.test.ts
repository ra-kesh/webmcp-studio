import { describe, expect, it } from "vitest"

import {
  applyCommand,
  designStyleUsage,
  northstarSeed,
  type Document,
  type DocumentCommand,
} from "../src"

const at = "2026-08-30T12:00:00.000Z"

type CommandDraft = DocumentCommand extends infer Command
  ? Command extends DocumentCommand
    ? Omit<Command, "id" | "at" | "actor">
    : never
  : never

const run = (document: Document, command: CommandDraft) =>
  applyCommand(document, {
    ...command,
    id: `command-${document.revision + 1}`,
    at,
    actor: "human",
  } as DocumentCommand)

describe("reusable design styles", () => {
  it("creates, applies, propagates, detaches, and protects typography styles", () => {
    let document = run(structuredClone(northstarSeed), {
      type: "create_typography_style",
      style: {
        id: "type-editorial-title",
        name: "Editorial / Title",
        fontFamily: "Geist Variable",
        fontSize: 54,
        fontWeight: 700,
        italic: true,
        lineHeight: 1.05,
        letterSpacing: -1.2,
        decoration: "none",
      },
    })
    document = run(document, {
      type: "apply_typography_style",
      styleId: "type-editorial-title",
      targets: [{ nodeId: "cover-title" }],
    })

    expect(
      document.nodes.find((node) => node.id === "cover-title")
    ).toMatchObject({
      typographyStyleId: "type-editorial-title",
      fontSize: 54,
      fontWeight: 700,
      italic: true,
      letterSpacing: -1.2,
    })
    expect(
      designStyleUsage(document, "typography", "type-editorial-title")
    ).toMatchObject({ nodeAttachmentCount: 1, rangeAttachmentCount: 0 })

    document = run(document, {
      type: "update_typography_style",
      styleId: "type-editorial-title",
      patch: { name: "Editorial / Hero", fontSize: 60, lineHeight: 1.1 },
    })
    expect(
      document.nodes.find((node) => node.id === "cover-title")
    ).toMatchObject({ fontSize: 60, lineHeight: 1.1 })

    expect(() =>
      run(document, {
        type: "delete_typography_style",
        styleId: "type-editorial-title",
      })
    ).toThrow("Detach it before deleting")

    document = run(document, {
      type: "detach_typography_style",
      targets: [{ nodeId: "cover-title" }],
    })
    const detached = document.nodes.find((node) => node.id === "cover-title")
    expect(detached).not.toHaveProperty("typographyStyleId")
    expect(detached).toMatchObject({ fontSize: 60, lineHeight: 1.1 })

    document = run(document, {
      type: "delete_typography_style",
      styleId: "type-editorial-title",
    })
    expect(document.typographyStyles).toEqual([])
  })

  it("supports range attachments and detaches them on direct formatting", () => {
    let document = run(structuredClone(northstarSeed), {
      type: "create_typography_style",
      style: {
        id: "type-emphasis",
        name: "Emphasis",
        fontFamily: "Geist Variable",
        fontSize: 22,
        fontWeight: 700,
        italic: false,
        lineHeight: 1.2,
        letterSpacing: 0,
        decoration: "underline",
      },
    })
    document = run(document, {
      type: "apply_typography_style",
      styleId: "type-emphasis",
      targets: [{ nodeId: "cover-eyebrow", range: { start: 0, end: 7 } }],
    })
    expect(
      document.nodes.find((node) => node.id === "cover-eyebrow")
    ).toMatchObject({
      runs: [
        {
          start: 0,
          end: 7,
          style: {
            typographyStyleId: "type-emphasis",
            fontWeight: 700,
            decoration: "underline",
          },
        },
      ],
    })

    document = run(document, {
      type: "update_node",
      nodeId: "cover-eyebrow",
      patch: {
        runs: [
          {
            start: 0,
            end: 7,
            style: { fontWeight: 400, decoration: "underline" },
          },
        ],
      },
    })
    expect(
      designStyleUsage(document, "typography", "type-emphasis")
        .totalAttachmentCount
    ).toBe(0)
  })

  it("applies one paint style to shapes and text ranges with protected deletion", () => {
    let document = run(structuredClone(northstarSeed), {
      type: "create_paint_style",
      style: {
        id: "paint-brand-accent",
        name: "Brand / Accent",
        color: "#b45309",
        opacity: 0.8,
      },
    })
    document = run(document, {
      type: "apply_paint_style",
      styleId: "paint-brand-accent",
      targets: [
        { nodeId: "cover-panel" },
        { nodeId: "cover-eyebrow", range: { start: 0, end: 7 } },
      ],
    })
    expect(
      document.nodes.find((node) => node.id === "cover-panel")
    ).toMatchObject({
      paintStyleId: "paint-brand-accent",
      fill: "#b45309",
      opacity: 0.8,
    })
    expect(
      designStyleUsage(document, "paint", "paint-brand-accent")
    ).toMatchObject({
      nodeAttachmentCount: 1,
      rangeAttachmentCount: 1,
      totalAttachmentCount: 2,
    })

    document = run(document, {
      type: "update_paint_style",
      styleId: "paint-brand-accent",
      patch: { color: "#0f766e", opacity: 0.65 },
    })
    expect(
      document.nodes.find((node) => node.id === "cover-panel")
    ).toMatchObject({ fill: "#0f766e", opacity: 0.65 })
    expect(() =>
      run(document, {
        type: "delete_paint_style",
        styleId: "paint-brand-accent",
      })
    ).toThrow("Detach it before deleting")
  })
})
