#!/usr/bin/env bun

import assert from "node:assert/strict"
import {
  documentSchema,
  projectNodeForRender,
  renderConformanceDocument,
} from "@webmcp/document"
import {
  createFabricSyncObject,
  fabricObjectToNodePatch,
  projectFabricTextState,
} from "../packages/editor/src/fabric-adapter"
import { renderNodeStyle } from "../packages/render-view/src"
import { renderNodeToHtml } from "../apps/renderer/src/html"

let synchronousFabricObjectCount = 0
let fabricTextProjectionCount = 0

const serializedDocument = JSON.stringify(renderConformanceDocument)
const roundTrippedDocument = documentSchema.parse(
  JSON.parse(serializedDocument) as unknown
)
assert.equal(
  JSON.stringify(roundTrippedDocument),
  serializedDocument,
  "Conformance document must survive a byte-stable JSON and schema round trip"
)
assert.deepEqual(
  roundTrippedDocument.outputs.map(({ id, pageIds }) => ({ id, pageIds })),
  [
    {
      id: "mixed-document",
      pageIds: ["properties-page", "long-text-page"],
    },
    { id: "square-image", pageIds: ["square-page"] },
  ],
  "Conformance output and page order"
)
for (const output of roundTrippedDocument.outputs) {
  for (const pageId of output.pageIds) {
    const page = roundTrippedDocument.pages.find(
      (candidate) => candidate.id === pageId
    )
    assert.ok(page, `${output.id} references missing page ${pageId}`)
    assert.equal(page.outputId, output.id, `${pageId} output ownership`)
  }
}

for (const node of renderConformanceDocument.nodes) {
  const projection = projectNodeForRender(node)
  const style = renderNodeStyle(projection)
  const html = renderNodeToHtml(node)

  assert.equal(style.left, node.x, `${node.id} React x`)
  assert.equal(style.top, node.y, `${node.id} React y`)
  assert.equal(style.width, node.width, `${node.id} React width`)
  assert.equal(style.height, node.height, `${node.id} React height`)
  assert.equal(style.opacity, node.opacity, `${node.id} React opacity`)
  assert.equal(
    style.transform,
    `rotate(${node.rotation}deg)`,
    `${node.id} React rotation`
  )
  assert.equal(
    style.display,
    node.visible ? undefined : "none",
    `${node.id} React visibility`
  )

  for (const token of [
    `data-node-id="${node.id}"`,
    `data-node-locked="${node.locked}"`,
    `left:${node.x}px`,
    `top:${node.y}px`,
    `width:${node.width}px`,
    `height:${node.height}px`,
    `opacity:${node.opacity}`,
    `transform:rotate(${node.rotation}deg)`,
    `display:${node.visible ? "block" : "none"}`,
  ]) {
    assert.ok(html.includes(token), `${node.id} HTML is missing ${token}`)
  }

  if (node.type === "text") {
    const fabricText = projectFabricTextState(node)
    assert.deepEqual(
      {
        text: fabricText.text,
        width: fabricText.width,
        height: fabricText.height,
        sizingMode: fabricText.sizingMode,
        overflow: fabricText.overflow,
      },
      {
        text: projection.content.text,
        width: projection.frame.width,
        height: projection.frame.height,
        sizingMode: projection.content.sizingMode,
        overflow: projection.content.layout.overflow,
      },
      `${node.id} Fabric text property projection`
    )
    fabricTextProjectionCount += 1
    continue
  }
  if (node.type === "image") continue
  const object = createFabricSyncObject(node)
  assert.deepEqual(fabricObjectToNodePatch(object), {
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    rotation: node.rotation,
  })
  synchronousFabricObjectCount += 1
}

console.log(
  `Verified ${renderConformanceDocument.nodes.length} canonical nodes across React/HTML property mappings, ${fabricTextProjectionCount} Fabric text property projections, and ${synchronousFabricObjectCount} synchronous non-image Fabric objects. Browser text line breaks and pixels are outside this structural gate.`
)
