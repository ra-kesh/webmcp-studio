# Reference patterns

## Reference posture

References are used for behavior and architecture, not visual imitation. The target is a document/image product with Figma-like interaction integrity and Canva-like speed to a useful result.

Local reference root:

`/Users/rakesh/Documents/Codex/2026-08-26/https-openai-com-webmcp-challenge-https/outputs/reference-repos`

License observations below are not legal advice.

## OpenPencil: primary editor-quality north star

Local project: `editors/open-pencil`, local commit recorded by the reference review as `88c107...`, MIT license at `LICENSE:1-20`.

### Adopt

| Pattern                                                             | Exact files                                                                                                                                                       | Why it matters here                                                                                  |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| One command source for menus, toolbar, keyboard, and action buttons | `packages/vue/src/editor/commands/registry.ts`, `definitions.ts`, `actions.ts`, `use.ts`                                                                          | Direct answer to Studio's conflicting shell/hook shortcuts and caller-specific enablement            |
| Derived selection capabilities                                      | `packages/vue/src/editor/selection-capabilities/use.ts`                                                                                                           | Lets inspector, toolbar, menu, and WebMCP agree on what the current selection and review mode permit |
| Gesture/input decomposition                                         | `packages/vue/src/canvas/useCanvasInput.ts`; `packages/vue/src/shared/input/{wheel,gesture,pan-zoom,select}.ts`; `packages/vue/src/canvas/pointer/use.ts`         | Separates raw input from tool intent and document transaction                                        |
| Explicit selection state                                            | `packages/vue/src/editor/selection-state/use.ts`                                                                                                                  | Avoids clearing or inventing selection as a side effect of rejected document commands                |
| Scheduled renderer ownership                                        | `packages/vue/src/canvas/surface/render-loop.ts`                                                                                                                  | Establishes a place for viewport/render invalidation instead of React/Fabric event drift             |
| Resizable persisted workspace                                       | `src/components/editor/EditorWorkspace.vue:20-89`                                                                                                                 | Better shell behavior than fixed 236/320 px panels and a one-pixel breakpoint cliff                  |
| Component anatomy                                                   | `src/theme/control.ts`, `icon-button.ts`, `toolbar.ts`, `canvas-pane-header.ts`, `page-list.ts`                                                                   | Semantic recipes can replace scattered 9-10 px labels, 24-32 px controls, and inconsistent states    |
| Engine and visual oracles                                           | `tools/visual-oracles/src/{compare,bisect,analyze-pattern,update-report}.ts`; `tests/helpers/{layout,scene,properties,tools,assert}.ts`; `tests/engine/editor/**` | Studio needs geometry, property, and rendered-output evidence, not only DOM/unit checks              |

### Do not adopt wholesale

- OpenPencil's broad component/variables/auto-layout scope is a roadmap, not a challenge requirement.
- Do not copy Vue-specific state/component coupling into React.
- Do not equate feature count with editor quality. Adopt command, capability, gesture, selection, render, and test boundaries first.

## Official Figma behavior

Primary current references:

- [Explore design files](https://help.figma.com/hc/en-us/articles/15297425105303-Explore-design-files)
- [Layers 101](https://help.figma.com/hc/en-us/articles/26584819173271-Layers-101-Get-started-with-layers)
- [View layers and assets in the Layers panel](https://help.figma.com/hc/en-us/articles/360039831974-View-layers-and-assets-in-the-Layers-Panel)
- [Properties panel](https://help.figma.com/hc/en-us/articles/360039832014-Design-Prototype-and-view-Code-in-the-Properties-Panel)
- [Auto layout properties](https://help.figma.com/hc/en-us/articles/360040451373-Explore-auto-layout-properties)

### Adopt

- Stable relationship among canvas selection, layer hierarchy, and property capabilities.
- Hierarchy, order, visibility, lock, and grouping as layer-tree responsibilities.
- Selection-derived property sections and explicit mixed states.
- Viewport and tool behavior that preserves selection when switching to Select.
- A command structure that supports expert keyboard use without hiding discoverability.

### Do not adopt now

- Dev Mode, prototyping, variables, component systems, and auto-layout breadth are not required for a strong document/image MVP.
- Do not import Figma's density without its mature menus, shortcuts, resizable shell, state consistency, and accessibility alternatives.

## Official Canva behavior

Primary current references:

- [Templates](https://www.canva.com/templates/)
- [Editing and designing](https://www.canva.com/help/editing-designing/)
- [Layer, group, and align](https://www.canva.com/help/layer-group-align/)
- [Keyboard shortcuts](https://www.canva.com/help/canva-keyboard-shortcuts/)
- [Image upload](https://www.canva.com/features/image-upload/)
- [Add and edit text](https://www.canva.com/help/add-and-edit-text/)
- [Beginner guide](https://www.canva.com/learn/how-to-canva-beginners-guide/)

### Adopt

- Searchable, categorized, visual templates as a first-run route to useful work.
- Clear separation among starting from a template, blank format, upload, and recent design.
- Persistent, reusable uploads rather than one-time image insertion.
- Obvious page and layer actions close to the object being managed.
- Text presets that make a useful heading/body faster than manual property correction.

### Do not adopt

- Do not call a palette swap a template.
- Do not hide document structure to achieve apparent simplicity. Canva ease depends on progressive disclosure and robust defaults, not absence of capabilities.
- Do not destructively replace an edited document without explicit scope, confirmation, and undo.

## Avnac and Avnac Studio

### License boundary

- Avnac is `AGPL-3.0-only`: `editors/avnac/LICENSE:1+` and root package metadata.
- Avnac Studio is `GPL-3.0`: `editors/avnac-studio/LICENSE:1+`.

Treat both as read-only product/architecture research unless the target licensing obligations are intentionally accepted and reviewed. Reimplement behavior independently.

### Adopt independently from Avnac

| Pattern                                                              | Files                                                                                                               | Studio application                                                          |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Normalize, validate, migrate, and sort local document records        | `frontend/src/lib/avnac-editor-idb.ts:17-52,90-126`                                                                 | Draft/media repositories must not trust IndexedDB JSON                      |
| Explicit repository CRUD and duplication                             | Same file `:128-205`                                                                                                | Replace one-off save/load with list/get/put/rename/duplicate/delete/migrate |
| Pure document/layer transforms and visible reverse-order hit testing | `frontend/src/lib/avnac-vector-board-document.ts:144-181,257-265,371-697,821-831`                                   | Canonical z-order and reference-safe page/layer commands                    |
| Focused scene/snapping/object/file tests                             | `frontend/src/__tests__/{avnac-scene-render,scene-engine-snapping,scene-engine-objects,scene-engine-files}.test.ts` | Test engine behavior separately from React                                  |
| Validated backend document routes                                    | `backend/src/routes/documents.ts:9-143`                                                                             | Validate payloads and separate list/detail/save/claim repository operations |

Avoid Avnac's last-write-wins PUT and any route whose ownership invariant is not enforced at the repository boundary. Studio needs expected-version/ETag preconditions.

### Avnac Studio

Files such as `avnac-system/io/{appdata,export,workspace_sync}.go`, `avnac-system/server/{media,unsplash,rembg}.go`, and `docs/{saraswati-engine,saraswati-architecture-decisions}.md` illustrate a narrow desktop-host capability boundary. Adopt only if desktop becomes explicit scope. Adding Wails/Go/local services now would multiply deployment and security work without fixing the web editor's command model.

## Other local editor references

### Canva clone, `editors/canva-clone-fabric`

License: Apache-2.0 at `LICENSE:1+`.

**Adopt flow:** `src/app/(dashboard)/templates-section.tsx:13-99` creates a project from template JSON and dimensions, then navigates. `projects-section.tsx:130-178` includes loading/error/empty states. This is a better semantic than applying a whole-document quotation theme in place.

**Avoid state model:** `src/features/editor/hooks/use-canvas-events.ts:17-42` saves directly from Fabric add/remove/modify events. Studio should persist canonical transactions, not renderer events. Avoid the legacy `use-hotkeys.ts:13-67` keyCode/direct-Fabric approach and unguarded `loadJSON` replacement.

### react-design-editor, `editors/react-design-editor`

License: MIT at `LICENSE:1-20`.

**Adopt selectively:**

- `src/components/editor/editorShell.model.ts:1-54` derives UI summaries in pure functions.
- `src/theme/editorTheme.test.ts:11-212` covers corrupt/unavailable storage and semantic theme application.
- `components/editor/{inspector.model,palette.model,editorShell.model}.test.ts` demonstrate focused model tests beside complex UI.

**Avoid:** source-text assertions such as `editorNavigation.test.ts:7-21` as the primary UI contract; query rendered accessible behavior. Do not copy the legacy monolithic Fabric/Ant Design architecture.

### Polotno references

The local node sample declares MIT, but the SDK/service has separate licensing. The local site/examples repository has no clear repository license. Use behavior/docs as a checklist, not a code-copy source.

- `engines-and-rendering/polotno-site/examples/polotno-templates-library/src/templates-panel.js:10-45` shows a replaceable, paged template section with loading.
- `docs/side-panel-upload.md:1-17` explicitly distinguishes a simple upload control from production list/upload/delete APIs.
- Relevant contracts: `docs/{side-panel,side-panel-images,side-panel-size,page,templates-library,rich-text,text-overflow}.md`.

Avoid raw `store.loadJSON` template replacement unless it is wrapped in explicit validation, impact preview, and one canonical undoable transaction.

## Adopt/avoid summary

| Need             | Adopt                                                                  | Avoid                                                                    |
| ---------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Commands         | OpenPencil registry/capabilities                                       | Parallel toolbar, keyboard, menu, WebMCP implementations                 |
| Templates        | Canva start flow, catalog metadata, renderer previews                  | Calling three palette variants templates; silent current-doc replacement |
| Pages/layers     | Figma hierarchy and OpenPencil action model                            | Flat list, dead duplicate sidebar, Fabric-owned order                    |
| Inspector        | Capability-derived pure property models                                | Local fields that can display rejected values                            |
| Draft/media      | Avnac-style validated/migrated repositories, independently implemented | Trusted IndexedDB blobs and save/load-by-ID only                         |
| Gestures/history | Begin/preview/commit/cancel transaction                                | Full snapshot per input event and selection clearing                     |
| Rendering        | Canonical fixture and visual oracle suite                              | Assuming Fabric preview equals server PNG/PDF                            |
| Tests            | Engine, accessible interaction, visual, failure, route, artifact tests | Screenshot review or source-string tests alone                           |

## Recommended reference-driven sequence

1. OpenPencil-style command registry and selection/review capability projection.
2. One page/layer/template information architecture consuming those commands.
3. Transaction history and deterministic Fabric/document bridge.
4. Validated, versioned draft and media repositories inspired by Avnac behavior but independently implemented.
5. Canva-style start and template catalog with explicit create/apply semantics.
6. Pure inspector view models and typed controls.
7. OpenPencil-style rendered visual oracles plus API artifact smoke tests.
