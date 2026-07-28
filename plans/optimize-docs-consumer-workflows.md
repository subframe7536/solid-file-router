# Optimize docs-consumer workflows

Status: Proposed
Priority: P1
Effort: L
Risk: Medium
Planned at: `7909fa6`

## Goal

Improve the package around behavior exercised by the Moraine documentation site:

1. Emit an SSR-rendered static-host fallback instead of an empty `404.html`.
2. Let custom route sources carry typed scan results into `load` without consumer-side caches and lookups.
3. Reduce custom-source HMR work by invalidating only the affected generated route module when possible.
4. Let consumers reuse an existing route-info interface in generated declarations.

Keep existing runtime compatibility and preserve the package's autocomplete-only router augmentation.

## Evidence

The reference consumer is `https://github.com/subframe7536/moraine`.

- `docs/build/routes.ts:187-233` keeps `cachedRoutes`, rescans it, and performs a `find()` in `load` because `RouteSourceEntry` cannot carry provider-private data.
- `docs/build/routes.ts:32-34` defines synthetic route IDs for `_app.tsx` and `404.tsx` because every custom entry currently requires `routeId`, even when it is derivable from `routePath`.
- `docs/build/routes.ts:232` watches the whole pages directory. In `src/utils/registry.ts:53-73`, any matching change invalidates every custom route module.
- `docs/vite.config.ts:41-50` repeats `DocsRouteInfo` as a string descriptor and loses the optionality of `group`, `badge`, and `api`.
- `src/index.ts:579-584` emits the unrendered client HTML template as `404.html`. The built Moraine `docs/dist/client/404.html` consequently contains an empty root rather than the `DocsNotFound` output.
- The current Moraine build contains 46 `*.solid-file-router-*.js` route facade chunks. A facade such as the button route performs another dynamic import for its MDX module, so navigation has two sequential lazy boundaries.

Baseline at the planned commit:

- `bun run test`: 95 tests passed.
- `bun run typecheck`: passed.
- `bun run lint`: passed.

## Public API design

### Typed custom-source data

Make the custom-source types generic and carry an opaque `data` value from `scan` to `load`:

```ts
export interface RouteSourceEntry<TData = unknown> {
  routeId?: string
  routePath: string
  sourcePath: string
  data?: TData
}

export interface RouteSourceLoadContext<TData = unknown> {
  routeId: string
  routePath: string
  sourcePath: string
  moduleId: string
  data?: TData
}

export interface RouteSourceProvider<TData = unknown> {
  scan:
    | string
    | ((
        glob: typeof import('tinyglobby').glob,
        root: string,
      ) => Promisable<RouteSourceEntry<TData>[]>)
  load: (
    entry: RouteSourceLoadContext<TData>,
  ) => Promisable<string | null | undefined | false | void>
  watchFiles?: string[]
}

export function defineRouteSource<TData>(
  provider: RouteSourceProvider<TData>,
): RouteSourceProvider<TData>
```

Propagate `TData` through `FileRouterOption`, the plugin factory, and `RouteRegistry` so `load(context.data)` is inferred without casts. Internally erase the generic only at the Vite plugin boundary, using `unknown` and narrowing rather than `any`.

`routeId` remains supported. When it is omitted, derive it with the same rule already used by string-glob sources:

1. Normalize `routePath`.
2. Use `getRoutePath(routePath, '')` when it produces a public route.
3. Otherwise use a stable internal ID based on the extensionless `routePath`, such as `/_app`.

Continue duplicate checks after derivation. Include the final normalized `routeId` in `RouteSourceLoadContext`.

The opaque `data` value must not participate in the structural snapshot. A metadata change should refresh the load context and invalidate generated code without forcing a route-tree rebuild when `routeId`, `routePath`, and `sourcePath` are unchanged.

### Watch-file matching

Keep `watchFiles?: string[]` source-compatible and expand its documented semantics:

- A literal path matches itself and descendants, preserving current directory behavior.
- A positive glob watches its non-glob root and filters events with Vite `createFilter`.
- A leading `!` is an exclusion pattern.
- A current route entry's exact `sourcePath` always matches, even without an explicit watch pattern.

Do not introduce a second watch option until this extension proves insufficient.

### Imported route-info type

Retain the current inline descriptor and add a discriminated import form:

```ts
type InfoTypeDefinition =
  | InlineInfoTypeDefinition
  | {
      type: 'import'
      from: string
      name: string
    }
```

For the import form, emit a top-level type-only import in the generated declaration and extend it from `FileRouteInfo`:

```ts
import type { DocsRouteInfo as FileRouteInfoDefinition } from './docs/build/routes'

declare module 'solid-file-router' {
  interface FileRouteInfo extends FileRouteInfoDefinition {}
}
```

Document that `from` is emitted verbatim and resolves relative to the generated declaration file. Require the imported symbol to be an object/interface-compatible type.

## Explicit non-goals

- Do not make generated `@solidjs/router` overloads reject arbitrary strings. The broad upstream overload is intentional: generated routes provide autocomplete and parameter hints, not closed-world navigation validation.
- Do not remove or deprecate `ssg.serverEntry`.
- Do not change route precedence, grouping, layout inheritance, or static-route discovery.
- Do not serialize, compare, clone, or expose provider-private `data` in generated route types.
- Do not add module-global route-loading signals in this change.
- Do not edit the Moraine repository as part of the package implementation; use it as acceptance evidence.

## Implementation plan

### 0. Check drift and isolate the work

Files:

- `plans/optimize-docs-consumer-workflows.md`
- Current Git worktree

Steps:

1. Run `git rev-parse --short HEAD` and compare it with `7909fa6`.
2. Run `git status --short` and preserve the existing `README.md` modification.
3. Re-read the referenced implementations before editing:
   - `src/index.ts`
   - `src/utils/source.ts`
   - `src/utils/registry.ts`
   - `src/utils/route-type.ts`
   - `tests/plugin.test.ts`
   - `tests/registry.test.ts`
   - `tests/route-type.test.ts`
4. If route-source normalization, SSG emission, or declaration generation changed materially, update this plan before implementation.

Done when:

- The implementation branch contains only the intended package changes plus the pre-existing README edit.
- The plan still matches the current code paths and public types.

Stop when:

- The planned commit is no longer an ancestor and the same behavior has been redesigned elsewhere.

### 1. Render the SSG fallback

Files:

- `src/index.ts`
- `tests/plugin.test.ts`

Steps:

1. Reserve `/404` as the fallback render URL.
2. Remove `/404` from the normal prerender list after normalization so only one `404.html` asset can be emitted.
3. After loading `serverRenderer`, render `{ url: '/404' }` and pass the result through `renderTemplate`.
4. Emit that rendered HTML as `404.html`.
5. Keep the fallback emission active when the normal prerender route list is empty.
6. Use the configured custom `serverEntry` renderer when one is present; the fallback must follow the same renderer contract as normal pages.
7. Preserve `/404` exclusion from automatic static-route discovery.

Tests:

- Extend the temporary SSG fixture with a `404.tsx` route whose rendered output is unique.
- Assert `dist/client/404.html` contains the route output and the client entry/hydration bootstrap.
- Assert root prerendering still succeeds.
- Configure `routes: ['/404', '/']` and assert the build does not emit a duplicate asset.
- Add a custom-server-entry case proving the custom renderer also produces `404.html`.
- Cover an empty normal route list and assert the rendered fallback still exists.

Done when:

- `404.html` is SSR-rendered through the selected server renderer.
- `/404` is emitted exactly once.
- Existing internal and custom server-entry builds still pass.

Stop when:

- Rendering `/404` cannot select the wildcard route in a real Vite build. In that case, add a small explicit fallback-render contract rather than guessing another URL or silently returning the raw template.

### 2. Carry typed source data and derive route IDs

Files:

- `src/utils/source.ts`
- `src/utils/registry.ts`
- `src/index.ts`
- `tests/registry.test.ts`
- `tests/plugin.test.ts` or a new type-focused test fixture

Steps:

1. Add the generic types and `defineRouteSource` helper described above.
2. Propagate the data type through plugin options and registry storage.
3. Normalize entries into two concerns:
   - Structural route fields used by definition generation and snapshots.
   - The full load context, including opaque `data`, stored in `routeSourceModuleMap`.
4. Derive missing `routeId` from normalized `routePath` using the established glob-source fallback.
5. Keep explicit IDs unchanged after existing normalization.
6. Refresh stored `data` on every scan even when the structural snapshot is unchanged.
7. Preserve all duplicate validation and improve errors so they report the derived ID and source path.

Tests:

- Infer a custom `data` shape through `defineRouteSource` and access it in `load` without a cast.
- Verify `load` receives the same object identity returned by `scan`; the registry must not clone it.
- Change only `data`, rescan, and verify the next load sees the new value while `structureChanged` remains `false`.
- Omit `routeId` for:
  - `index.tsx`
  - `(general)/button.tsx`
  - `[id].tsx`
  - `404.tsx`
  - `_app.tsx`
- Assert the derived IDs match string-glob source behavior.
- Assert explicit IDs remain supported.
- Assert duplicate derived IDs and duplicate source paths fail with actionable messages.
- Run a declaration/type fixture proving incompatible `data` use fails TypeScript.

Done when:

- A consumer can place its complete scanned route record in `data` and generate code directly in `load`.
- No consumer-side cache or `find()` is required.
- Existing non-generic providers compile unchanged.

Stop when:

- Generic propagation requires `any` in the public API. Rework the plugin/registry generic boundary instead of weakening inference.

### 3. Make custom-source invalidation selective

Files:

- `src/utils/registry.ts`
- `src/index.ts`
- `tests/registry.test.ts`
- `tests/plugin.test.ts`

Steps:

1. Compile `watchFiles` into:
   - Chokidar roots returned by `getWatchFiles()`.
   - A Vite `createFilter` used by `isCustomWatchedFile`.
2. Preserve literal-directory behavior and support positive/negative globs.
3. Before rescanning, capture:
   - The previous source-to-module match for the changed file.
   - The previous complete module ID set.
4. Rescan and refresh contexts.
5. Select invalidations:
   - Exact route source change with stable structure: union of its previous and next module IDs.
   - Shared watched dependency change: all current module IDs.
   - Structural change: union of all previous and next module IDs.
6. Call `invalidateCache` only for the selected IDs.
7. Preserve the current full reload behavior for structural changes and `reloadOnChange: true`.
8. Keep virtual route-definition invalidation where generated metadata can change, but verify through a plugin test that unrelated custom-source modules are not loaded or invalidated.

Tests:

- Changing one of two exact route source files returns only that route's generated module ID.
- Changing a shared watched file invalidates all generated route modules.
- Adding or unlinking a matching route source reports a structural change and includes old/new module IDs.
- A positive MDX glob ignores an unrelated TSX file under the same directory.
- A negated glob excludes its subtree.
- Existing literal `watchFiles: ['docs/pages']` behavior remains valid.
- `reloadOnChange: true` still forces full reload after a matched non-structural change.

Done when:

- Editing one Moraine MDX page does not invalidate all 46 generated route modules.
- Shared generator/config changes still invalidate every affected route.
- Unrelated files under a watched root are ignored when a glob narrows the source set.

Stop when:

- Vite watcher roots cannot represent the include patterns portably. Watch the nearest stable parent directory and keep filtering events in the registry; do not add one watcher per route.

### 4. Reuse external route-info types

Files:

- `src/utils/route-type.ts`
- `src/index.ts`
- `tests/route-type.test.ts`
- `README.md`

Steps:

1. Split the current recursive inline descriptor into a named inline type.
2. Add the discriminated import descriptor and export its public types.
3. Generate the type-only import outside module augmentation.
4. Extend `FileRouteInfo` from the imported alias.
5. Keep output byte-stable for existing inline descriptors to avoid needless generated-file churn.
6. Document both forms and explain relative module resolution.
7. Apply README edits around the user's existing uncommitted change without discarding or reformatting it.

Tests:

- Existing inline descriptor snapshots remain unchanged.
- An imported interface generates the expected type-only import and extension.
- A temporary TypeScript fixture preserves optional fields from the imported interface.
- Invalid descriptor combinations fail at compile time through the discriminated union.

Done when:

- Moraine can point `infoDts` at its existing `DocsRouteInfo` interface.
- Optional properties no longer need to be duplicated as lossy strings.
- Existing inline configuration remains compatible.

Stop when:

- TypeScript module augmentation rejects extending the imported type for supported object interfaces. If so, retain the inline API and open a focused design plan instead of emitting an unsound alias.

### 5. Document and validate the consumer migration

Files:

- `README.md`
- Test fixtures in this repository

Add an English custom-source example equivalent to:

```ts
interface DocsSourceData {
  info: DocsRouteInfo
  importPath: string
}

const routeSource = defineRouteSource<DocsSourceData>({
  scan: async () =>
    routes.map((route) => ({
      routePath: route.routePath,
      sourcePath: route.sourcePath,
      data: {
        info: route.info,
        importPath: route.importPath,
      },
    })),
  load: ({ data, moduleId }) => {
    if (!data) {
      return
    }
    return generateRouteModule(data, moduleId)
  },
  watchFiles: ['docs/pages/**/*.mdx', '!docs/pages/**/_*.mdx'],
})
```

The example must state that `data` is build-process memory only and must contain serializable source text itself if the generated module needs it. Avoid promising persistence across processes.

Done when:

- The documented example has no parallel route cache, no linear lookup, and no repeated public `routeId`.
- The migration is additive; existing consumers do not need to change.

## Deferred measured follow-up: one lazy boundary

The Moraine consumer currently generates a lazy route module whose component starts a second lazy MDX import. This produces 46 small facade chunks and a sequential import waterfall, but the second boundary also tracks a user-visible loading state that `useIsRouting` does not cover.

Create a separate design plan only after measuring:

1. Navigation with no preload.
2. Hover preload followed by navigation.
3. Hover preload without navigation.
4. A failed lazy import and retry.
5. SSR and hydration with client-only lazy mode.

The acceptable design must let the generated outer lazy boundary expose pending state without showing the loading bar for hover-only preload, must be scoped per router instance, and must not add a second dynamic import. Reject a module-global counter or an API that conflates preload with navigation.

## Verification

Run from `/Users/subf/Developer/front/solid-file-router`:

```sh
bun run test
bun run lint
bun run typecheck
bun run build
bun run play:ssg:build
bun run format --check
git status --short
```

Acceptance checks:

- All existing tests remain green.
- New SSG integration assertions read the emitted `404.html`, not generated config alone.
- Type tests cover generic inference and imported route-info optionality.
- Registry tests prove the exact changed module ID set for each HMR category.
- No package dependency is added.
- The pre-existing README work remains intact.

## Suggested delivery sequence

Use separate commits so correctness and API work remain reviewable:

1. `fix(ssg): render the static-host fallback`
2. `feat(route-source): carry typed scan data`
3. `perf(route-source): narrow watched-file invalidation`
4. `feat(types): import route info definitions`
5. `docs(route-source): document optimized custom sources`

Do not publish or bump the package version as part of implementation unless explicitly requested.
