# Reference repositories

These projects answer specific architecture and interaction questions. They are not starter code. This repository uses original implementation and published dependencies with compatible licenses.

| Reference                                                                         | Use                                                                            | License rule                 |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------- |
| [WebMCP specification](https://github.com/webmachinelearning/webmcp)              | tool lifecycle, annotations, cancellation, dynamic registration, and security  | W3C notices apply            |
| [GoogleChromeLabs webmcp-tools](https://github.com/GoogleChromeLabs/webmcp-tools) | inspector, examples, evaluation, and browser support                           | Apache 2.0                   |
| [webmcp-react](https://github.com/agentcathq/webmcp-react)                        | React registration lifecycle and Strict Mode behavior                          | MIT                          |
| [Avnac](https://github.com/xt42io/avnac)                                          | local documents, scenes, autosave, pages, and assistant panel behavior         | AGPL, inspect behavior only  |
| [Avnac Studio](https://github.com/striker561/Avnac-Studio)                        | command reducer, scene graph, and renderer separation                          | GPL, inspect behavior only   |
| [canva-clone](https://github.com/git-adventures/canva-clone)                      | Fabric lifecycle, sidebar composition, history, templates, and export          | Apache 2.0                   |
| [react-design-editor](https://github.com/salgum1114/react-design-editor)          | rulers, zoom, object controls, layer order, and Fabric command behavior        | MIT                          |
| [Fabric.js](https://github.com/fabricjs/fabric.js)                                | transforms, grouping, serialization semantics, text measurement, and events    | MIT                          |
| [Konva](https://github.com/konvajs/konva)                                         | comparison point for declarative nodes, layers, hit testing, and caching       | check before reuse           |
| [OG Image Studio MVP](https://github.com/bensblueprints/og-image-studio-mvp)      | template variables, render endpoints, bulk jobs, and render logs               | MIT                          |
| [Polotno Studio](https://github.com/polotno-project/polotno-studio)               | visual product behavior, pages, templates, and assets                          | inspect license before reuse |
| [TanStack Router](https://github.com/TanStack/router)                             | TanStack Start on Workers, file routes, server boundaries, and tests           | MIT                          |
| [Cloudflare templates](https://github.com/cloudflare/templates)                   | current Worker, binding, D1, R2, and deployment patterns                       | MIT                          |
| [shadcn/ui](https://github.com/shadcn-ui/ui)                                      | owned component source, Radix composition, and design tokens                   | MIT                          |
| [OpenPencil](https://github.com/open-pencil/open-pencil)                          | Figma-level editor interactions, selection, panels, menus, and visual polish   | inspect behavior only        |
| [Loora](https://github.com/lassejlv/loora)                                        | transactions, shared human/agent commands, gestures, history, sync, and export | AGPL, inspect behavior only  |

The private `studio-saas-monorepo` informed the broad `apps/` and `packages/` organization only. Its code, history, settings, and datasets stay outside this repository.

## Clean implementation procedure

For a new decision:

1. Write the constraint and observable behavior.
2. Inspect two or three references that answer it.
3. Record the decision in an ADR.
4. Implement from a clean file against this project's canonical types.
5. Add a regression test for behavior that could be confused with a reference implementation.

Repositories without a detected license remain read-only references. No source from the archived private course repository may be copied.
