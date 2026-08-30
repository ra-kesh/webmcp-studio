import { describe, expect, it } from "vitest"
import {
  applyCommand,
  decodeDocument,
  northstarSeed,
  validateDocument,
} from "../src"

const at = "2026-08-30T12:00:00.000Z"
const meta = (id: string) => ({ id, actor: "human" as const, at })

describe("typed design variables", () => {
  it("binds and atomically propagates a color value", () => {
    const created = applyCommand(northstarSeed, {
      type: "create_variable",
      ...meta("command-create-brand-color"),
      variable: {
        id: "variable-brand-color",
        name: "Brand / Primary",
        type: "color",
        value: "#335c4a",
      },
    })
    const bound = applyCommand(created, {
      type: "bind_variable",
      ...meta("command-bind-brand-color"),
      binding: {
        id: "variable-binding-cover-panel",
        variableId: "variable-brand-color",
        target: { kind: "node", nodeId: "cover-panel", property: "fill" },
      },
    })
    expect(bound.nodes.find((node) => node.id === "cover-panel")).toMatchObject(
      {
        fill: "#335c4a",
      }
    )

    const updated = applyCommand(bound, {
      type: "update_variable",
      ...meta("command-update-brand-color"),
      variableId: "variable-brand-color",
      patch: { value: "#c46545" },
    })
    expect(
      updated.nodes.find((node) => node.id === "cover-panel")
    ).toMatchObject({
      fill: "#c46545",
    })
    expect(
      validateDocument(updated).filter((issue) => issue.severity === "error")
    ).toEqual([])
  })

  it("detaches a variable when its controlled property is edited directly", () => {
    const created = applyCommand(northstarSeed, {
      type: "create_variable",
      ...meta("command-create-title-size"),
      variable: {
        id: "variable-title-size",
        name: "Type / Hero size",
        type: "number",
        value: 96,
      },
    })
    const bound = applyCommand(created, {
      type: "bind_variable",
      ...meta("command-bind-title-size"),
      binding: {
        id: "variable-binding-title-size",
        variableId: "variable-title-size",
        target: {
          kind: "node",
          nodeId: "cover-title",
          property: "fontSize",
        },
      },
    })
    const edited = applyCommand(bound, {
      type: "update_node",
      ...meta("command-edit-title-size"),
      nodeId: "cover-title",
      patch: { fontSize: 72 },
    })

    expect(edited.variableBindings).toEqual([])
    expect(
      edited.nodes.find((node) => node.id === "cover-title")
    ).toMatchObject({
      fontSize: 72,
    })
  })

  it("protects field-controlled properties and variables that remain in use", () => {
    const created = applyCommand(northstarSeed, {
      type: "create_variable",
      ...meta("command-create-title-copy"),
      variable: {
        id: "variable-title-copy",
        name: "Copy / Couple names",
        type: "string",
        value: "Mira & Dev",
      },
    })
    expect(() =>
      applyCommand(created, {
        type: "bind_variable",
        ...meta("command-bind-title-copy"),
        binding: {
          id: "variable-binding-title-copy",
          variableId: "variable-title-copy",
          target: { kind: "node", nodeId: "cover-title", property: "text" },
        },
      })
    ).toThrow("already controlled by a shared field")

    const colorCreated = applyCommand(created, {
      type: "create_variable",
      ...meta("command-create-panel-color"),
      variable: {
        id: "variable-panel-color",
        name: "Brand / Panel",
        type: "color",
        value: "#233128",
      },
    })
    const colorBound = applyCommand(colorCreated, {
      type: "bind_variable",
      ...meta("command-bind-panel-color"),
      binding: {
        id: "variable-binding-panel-color",
        variableId: "variable-panel-color",
        target: { kind: "node", nodeId: "cover-panel", property: "fill" },
      },
    })
    expect(() =>
      applyCommand(colorBound, {
        type: "delete_variable",
        ...meta("command-delete-panel-color"),
        variableId: "variable-panel-color",
      })
    ).toThrow("Unbind it before deleting")
  })

  it("migrates early version-three documents without losing content", () => {
    const legacy = structuredClone(northstarSeed) as any
    delete legacy.typographyStyles
    delete legacy.paintStyles
    delete legacy.variables
    delete legacy.variableBindings
    const titleBefore = legacy.nodes.find(
      (node: any) => node.id === "cover-title"
    )

    const decoded = decodeDocument(legacy)

    expect(
      decoded.document.nodes.find((node) => node.id === "cover-title")
    ).toEqual(titleBefore)
    expect(decoded.document.variableBindings).toEqual([])
  })
})
