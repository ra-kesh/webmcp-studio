# PERSIST-01B persistence layout and route plan

Date: 2026-08-28
Status: implementation-ready note; no production or test code changed

## Current routing facts

The lockfile currently resolves:

- `@tanstack/react-router` 1.170.32;
- `@tanstack/react-start` 1.168.49;
- `@tanstack/router-plugin` 1.168.35;
- the plugin's `@tanstack/router-generator` 1.167.33;
- Vite 8.2.2.

`apps/studio/vite.config.ts` uses `tanstackStart()` before `viteReact()`, with the default `src/routes` directory and `src/routeTree.gen.ts` output. `router.tsx` creates one router with intent preloading and scroll restoration. `__root.tsx` owns the document shell and global tooltip provider. The only UI route is `routes/index.tsx`, which is `ssr: false` and mounts `StudioShell`. API routes are siblings under the root.

The installed generator recognizes a directory whose leading segment starts with `_` and whose configuration file is `route.tsx` as a pathless layout. Use the directory convention already supported by this generator, not a route group.

## Exact route files

```text
apps/studio/src/routes/__root.tsx                         existing root shell
apps/studio/src/routes/_studio/route.tsx                  new pathless client layout
apps/studio/src/routes/_studio/index.tsx                  moved UI index route
apps/studio/src/routes/_studio/documents/$documentId.tsx  later exact editor route
apps/studio/src/routes/api/**                             unchanged root children
apps/studio/src/routes/v1/**                              unchanged root children
```

The route declarations are:

```ts
// _studio/route.tsx
export const Route = createFileRoute("/_studio")({
  ssr: false,
  component: StudioPersistenceLayout,
})

// _studio/index.tsx
export const Route = createFileRoute("/_studio/")({
  component: StudioLibraryRoute,
})

// _studio/documents/$documentId.tsx
export const Route = createFileRoute("/_studio/documents/$documentId")({
  component: StudioDocumentRoute,
})
```

`StudioPersistenceLayout` renders `StudioPersistenceProvider` around `<Outlet />`. Put `ssr: false` on the pathless parent and remove the duplicate flag from the index child. IndexedDB, legacy localStorage migration, BroadcastChannel, Fabric, and saved workspace geometry stay behind that inherited client boundary. Do not put the provider in `__root.tsx`, because API routes must not construct browser persistence.

The generated tree must show a pathless `/_studio` parent, `/` and `/documents/$documentId` full paths, and unchanged API parents. Never edit `routeTree.gen.ts` manually.

## Current persistence facts

`useDocumentEditor` currently creates the repository through a lazy `useState` factory. One large effect then migrates legacy bytes, lists 50 summaries, subscribes to repository events, projects lifecycle/start state, and schedules final controller flush plus repository close in a guarded microtask. The retained StrictMode test deliberately observes more than one discarded repository factory, but only one lazy channel, one active listener, no close during effect replay, and one close after real unmount. Preserve those guarantees while moving their owner above both UI routes.

## Route-tree generation

Add a direct CLI matching the installed generator, not an unpinned `bunx` download:

```json
// apps/studio/package.json
{
  "scripts": {
    "routes:generate": "tsr generate"
  },
  "devDependencies": {
    "@tanstack/router-cli": "1.167.33"
  }
}
```

Add `apps/studio/tsr.config.json` so CLI and plugin defaults cannot drift:

```json
{
  "routesDirectory": "./src/routes",
  "generatedRouteTree": "./src/routeTree.gen.ts",
  "quoteStyle": "single",
  "semicolons": false
}
```

The exact generation command from the repository root is:

```bash
bun --filter @webmcp/studio routes:generate
```

Run it only after the source route move/addition. Inspect imports, route IDs, parent functions, full paths, and the `FileRoutesBy*` maps before typecheck. This note did not run it.

## Persistence runtime and provider

Create these framework-independent and React owners:

```text
apps/studio/src/features/persistence/studio-persistence-runtime.ts
apps/studio/src/features/persistence/studio-persistence-provider.tsx
```

The runtime owns one retained `DocumentDraftRepository`, one memoized migration attempt per retry generation, one repository subscription, and final close. React owns only snapshot subscription and context.

```ts
export type StudioPersistenceState =
  | Readonly<{ status: "opening" }>
  | Readonly<{
      status: "ready"
      migration: Extract<
        CurrentDraftRepositoryMigrationResult,
        { status: "empty" | "migrated" | "collision" }
      >
      warning: string | null
    }>
  | Readonly<{
      status: "recovery_required"
      recovery: DraftRecoveryRecord
    }>
  | Readonly<{
      status: "blocked" | "unavailable"
      failure: Readonly<{ kind: string; message: string }>
      recoverableEnvelope: CurrentDraftEnvelope | null
    }>

export type StudioPersistenceApi = Readonly<{
  repository: DocumentDraftRepository
  state: StudioPersistenceState
  retry: () => void
  subscribeRepositoryEvents: (
    listener: (event: DraftRepositoryEvent) => void
  ) => () => void
  acquireLease: () => () => void
}>
```

`retry()` is accepted only from `blocked` or `unavailable`. It increments a generation, projects `opening`, and starts one new migration attempt. Late results from an older generation cannot change state. `ready` does not list recents; the library controller owns bounded metadata pages. Collision remains `ready` with its preserved conflict warning. Recovery remains higher priority than list/open actions.

`subscribeRepositoryEvents` fans out from one runtime-owned repository subscription. Consumers do not each construct a BroadcastChannel. Event delivery remains an invalidation hint.

`acquireLease` protects the repository during asynchronous child cleanup. The provider holds one lease while mounted. An editor session holds another until its exact controller flush and close finish. Final repository close occurs only when all leases are released.

## StrictMode lifecycle

Use a lazy `useState` factory in the provider to create the runtime. React may invoke that initializer more than once for discarded StrictMode renders; abandoned instances must not open IndexedDB or a channel because `start()` runs only from the retained effect.

The retained effect calls `runtime.retain()` and releases it in cleanup. Release schedules a microtask guarded by mount generation. A StrictMode cleanup/remount cancels the pending final close. A real unmount:

1. stops runtime state delivery;
2. removes the single repository subscription;
3. waits for child editor leases to release after flush/close;
4. closes the repository and its lazy channel exactly once.

`start()` memoizes the in-flight migration promise for its generation. StrictMode effect replay must not run legacy bootstrap, migration, cleanup, or initial open twice. Repository operations remain idempotent as defense, but idempotency is not a substitute for one owner.

Do not close the repository on `/` to `/documents/$documentId` navigation. The pathless layout remains mounted across both routes.

## Safe incremental adapter

Land the ownership move without changing the visible one-card Start workflow:

1. Add the runtime/provider and pathless layout.
2. Move `routes/index.tsx` to `_studio/index.tsx` without changing its rendered `StudioShell`.
3. In `StudioShell`, call `useStudioPersistence()` and pass the API into `useDocumentEditor({ persistence })`.
4. Remove repository construction, migration, repository close, and repository-level subscription from `useDocumentEditor` in the same commit. Two persistence owners must never coexist.
5. Keep a temporary hook adapter that reacts to provider state, performs the existing 50-row list projection, and fans in repository events to the current single-card `StudioStartModel`. This preserves behavior while proving ownership.
6. The hook continues to own the active save controller temporarily. It acquires a persistence lease when a controller is installed and releases it only after controller flush/close. Hook cleanup never calls `repository.close()`.
7. Keep `sessionMode`, Continue, and the private neutral bootstrap only until the later library and document-route slices replace them. Mark the adapter as transitional and do not add new behavior to it.
8. Add the document route only after the route/session coordinator can admit an exact record. Do not mount `StudioShell` under a document URL with the old private session mode.

This adapter gives one repository and migration owner first. It avoids combining provider extraction, real recents, route admission, navigation blockers, and editor-session replacement in one review boundary.

## Test owners

Add:

```text
studio-persistence-runtime.test.ts
studio-persistence-provider.strict-mode.test.tsx
studio-persistence-adapter.mounted.test.tsx
```

Runtime tests prove one in-flight migration per generation, retry generation rejection, exact state mapping for every migration result, one event fanout subscription, and lease-delayed close.

Provider StrictMode tests replace the repository-lifecycle portion of `use-document-editor.strict-mode.persistence.mounted.test.tsx`. They prove multiple discarded factories may exist, but only the retained runtime opens one lazy channel, has one active repository listener, runs migration once, survives effect replay, and closes once after the last lease. Add a deferred child lease to prove repository close waits for controller cleanup.

The adapter mounted suite proves current empty, migrated, collision, blocked, unavailable, recovery, and returning-draft projections remain byte/identity equivalent after ownership moves. Existing migration, start, persistence, Home/flush, publication, import, and StrictMode suites stay green. Update their harnesses to wrap the provider or inject a runtime; do not weaken exact identity or channel-count assertions.

Route generation acceptance is source plus generated-tree inspection and Studio typecheck. No test should rewrite the generated tree. The later route slice owns in-memory router tests for `/`, deep links, missing IDs, and stale admissions.

## Restricted-host gate

This slice may run focused Vitest, Studio typecheck, focused ESLint, Prettier check, and `git diff --check`. It must not start Vite, Workerd, Wrangler, Playwright, a browser, or a build on the restricted host.

Approval requires one persistence owner, one retained migration attempt, one repository event subscription, no close during child-route navigation, exact StrictMode cleanup, and no change to current visible Start/editor behavior.
