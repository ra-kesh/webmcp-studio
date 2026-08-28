# Loora editor reference

Loora is a primary technical reference beside OpenPencil. It is not a dependency or starter code. We inspect its product workflows and architecture, then implement Studio's behavior independently against Studio's own document contract.

Reference checkout: `/Users/rakesh/Documents/Codex/2026-08-26/https-openai-com-webmcp-challenge-https/outputs/reference-repos/editors/loora` (`lassejlv/loora`, AGPL-3.0). No Loora source is imported, copied, or linked into Studio.

## Division of responsibility between references

- **OpenPencil:** Figma-level interaction fidelity and editor feel.
- **Loora:** transaction architecture, agent/API control, gestures, command and context menus, history, synchronization, and renderer verification.
- **Canva:** templates, accessibility, and ease of use.
- **Orshot:** external generation API and render-job workflow.
- **Studio:** quotation and Stuwiz contracts, deterministic multi-page documents, document/image templates, PDF and image exports, and batch generation.

## Code areas to revisit by phase

| Studio phase                  | Loora reference area                                                                                       | Pattern to study                                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Canvas gestures               | `packages/canvas/src/react.tsx`                                                                            | pointer-centred zoom, touch pinch, panning, native non-passive wheel prevention, `touchAction: none`, fit and zoom-to-selection  |
| Commands, history, and WebMCP | `packages/canvas/src/engine.ts`, `packages/agent/src/canvas-tools.ts`, `crates/mcp-server/src/tools.json`  | validated typed operations, inverse operations, undo coalescing, and one transaction vocabulary shared by people and agents      |
| Menus and discovery           | `packages/editor/src/components/canvas-menu.tsx`, `packages/editor/src/components/editor-command-menu.tsx` | selection-aware context commands and command-palette projection from live capability state                                       |
| Persistence and collaboration | `packages/editor/src/lib/canvas-client.ts`                                                                 | optimistic transactions, IndexedDB persistence, synchronization, and presence boundaries                                         |
| Render verification           | `packages/canvas/src/export.ts`, `packages/editor/src/lib/canvas-capture.tsx`                              | export derived from canonical document data and offscreen PNG capture                                                            |
| Document model                | `packages/canvas/src/model.ts`                                                                             | normalized identity, parent/order relationships, themes, components, and interactions without adopting its website-builder scope |

## Architectural conclusion

Loora supports the package direction already in use:

- `packages/document` owns canonical data.
- `packages/editor` owns typed commands, history, geometry, and Fabric integration.
- `packages/render-view` owns deterministic document-derived rendering.
- `packages/webmcp` exposes the same product commands used by the UI.
- Studio surfaces those commands through toolbar controls, shortcuts, menus, the palette, sidebars, and inspector.

This does not justify an architectural restart. The product remains document-, image-, quotation-, and output-focused instead of inheriting Loora's responsive website-builder scope.
