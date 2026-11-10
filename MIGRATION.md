# Migration to v1.0.0

solid-file-router v1 is a **thin preset over the official Solid 2 stack**. Custom
route scanning, extraction, code generation, registry, and metadata machinery
were removed; `filesystem-routing`, `@solidjs/router`, `@solidjs/web`, and
`@solidjs/vite-plugin` now provide that foundation. This package keeps only the
features the official stack does not have: filename conventions, inherited
loading/error components, declarative `metadata`, `draft` routes, MDX routes,
route providers, and SSG prerendering.

## Requirements

| Dependency             | Version       |
| ---------------------- | ------------- |
| `solid-js`             | `^2.0.0-rc`   |
| `@solidjs/web`         | `^2.0.0-rc`   |
| `@solidjs/router`      | `^2.0.0-next` |
| `filesystem-routing`   | `^0.5.0`      |
| `vite`                 | `^8`          |
| `@solidjs/vite-plugin` | `^3.0.0-next` |

All upstream packages are **prereleases** — pin exact versions and expect
breaking changes between RC/next releases.

## Package manager

pnpm is now the package manager (`packageManager` is set; `bun.lock` was
removed). Replace `bun run x` with `pnpm x`.

## Vite config

```ts
import { fileRouter } from 'solid-file-router/plugin'
// before
import solidPlugin from 'vite-plugin-solid'

export default defineConfig({
  plugins: [solidPlugin(), fileRouter({ mdx: true })],
})

// after
import solid from '@solidjs/vite-plugin'
import { fileRouter } from 'solid-file-router/plugin'

export default defineConfig({
  plugins: [solid({ extensions: ['.jsx', '.tsx', '.mdx'] }), fileRouter({ mdx: true })],
})
```

### Option mapping

| v0.7                                                                                            | v1                                                 |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `pagesDir`                                                                                      | same                                               |
| `ignore`                                                                                        | same (appended to the built-in ignore list)        |
| `output`                                                                                        | same (now produces a `routes.d.ts` via upstream)   |
| `lazy`                                                                                          | same (`false` disables code splitting)             |
| `mdx`                                                                                           | same                                               |
| `ssg`                                                                                           | same shape, new implementation (below)             |
| `routeProviders`                                                                                | same (experimental)                                |
| `router` / `routers`                                                                            | now take official `BaseFileSystemRouter` instances |
| `convention`                                                                                    | **new** — filename-convention adapter (see below)  |
| `toPath` / `toRoute`                                                                            | same official seams                                |
| `reloadOnChange`, `infoDts`, `inheritance`, `serverEntry` (top level), `renderTemplate`, `meta` | **removed**                                        |

`convention`, `router`, and `routers` are **mutually exclusive**.

```ts
fileRouter({
  convention: defaultConvention, // this package's old conventions (default)
  // solidStartConvention,          // stock SolidStart-style conventions
  // flatConvention,                // official flat router
  // (config) => new MyRouter(config),
})
```

`pagesDir` is resolved relative to the Vite **root**, not cwd.

## Route modules

```tsx
// before
export default createRoute({
  info: { title: 'Home' },
  matchFilters: { id: /^\d+$/ },
  loadingComponent: Loading,
  errorComponent: Catch,
  component: (props) => <div>{props.children}</div>,
})

// after
export const route = {
  info: { title: 'Home' },
  matchFilters: { id: /^\d+$/ },
  loadingComponent: Loading,
  errorComponent: Catch,
}

export default function Page(props: RouteSectionProps) {
  return <div>{props.children}</div>
}
```

`defineRoute(config)` and `definePage(component)` are identity helpers for
typing the two exports — they add `RouteSectionProps` typing to the default
export without `any`, and are safe with the scanner (it checks export
presence only, so wrapping does not affect extraction).

## Entry / mount

```tsx
// before
import { createClientEntry } from 'solid-file-router'
import { FileRouter } from 'virtual:routes'
createClientEntry(() => <FileRouter />, document.getElementById('root')!)

// after
import { render } from '@solidjs/web'
import { createFileRouter } from 'solid-file-router'

const Router = createFileRouter()
render(() => <Router>{(props) => <>{props.children}</>}</Router>, document.getElementById('root')!)
```

`createFileRouter` also exposes `Router.fileRoutes`, `Router.routeInfo`, and
`Router.routeMetadata` (keyed by group-stripped path).

Under `solid({ start: true })` no entry files are needed — provide `src/App.tsx`
that renders `createFileRouter()`.

## Navigation / paths

- `<A>` was removed upstream — use `<a>` (start intercepts internal links).
- `generatePath` is removed. Use `Router.paths`:
  `nav(Router.paths.blog('1'))` / `Router.paths.blog('1')()` for the string.
- `onMount` → `onSettled`, `mergeProps` → `merge`,
  `Suspense`/`ErrorBoundary` → `Loading`/`Errored` (Solid 2).
- `isServer`, `Dynamic`, `lazy`, JSX types now come from `@solidjs/web`.

## Filename conventions

`defaultConvention` reproduces the v0.7 filename table (`_app`/`_layout`/
`index`/`*404`/`-[x]` optional/`[...x]` splats/`(group)`/dot separators/private
`_x`/`components/`).

Difference: old `-` optional segments and `[...all]` now emit official `*name`
splats. `*all` matches `/blog`, `/blog/`, and `/blog/a/b` — the same reachable
surface, but path shape is a splat, not optional params.

## Loading / error / metadata / draft

- `loadingComponent`/`errorComponent` still inherit down the tree; `inherit`
  blocks it (`false`, or `{ loading: false }`, `{ error: false }`).
- They compile to real Solid 2 `Loading`/`Errored` boundaries. Without an
  `errorComponent` the error is re-logged in development (previous behavior).
- `metadata` now goes through `useHead` — the `<!--ssr-head-->` template marker
  and baseline `<script data-solid-file-router-head-default>` are gone.
- `draft: true` keeps the route in development and drops it (and its subtree)
  from production builds.
- `readRouteInfo`/`useCurrentMatches` removed — collect `info` via
  `Router.routeInfo` or official `useMatch`.

## SSG

`solid({ start: true, ssr: true })` + `fileRouter({ ssg: {} })`. The plugin
collects static manifest routes, calls the built `handleRequest`, and writes
`/` → `index.html`, `/x` → `x.html`, `/x/` → `x/index.html`, plus `404.html`.
`concurrency` (default `4`), `routes`, `outDir`, and `serverEntry` (custom
handler for non-start setups) are supported. HTML template/head markers are
removed — `<head>` content is owned by `useHead`.

## MDX

- `createRoute` in MDX frontmatter is replaced by top-level frontmatter keys
  (`draft`, `metadata`, `matchFilters`, `inherit`, `info`); compiled modules
  export `route` + `frontmatter` + default `MDXContent`.
- `mdxRouteProvider` was removed — `.md`/`.mdx` are first-class extensions of
  the convention router; `$$route` is served by a virtual module so route
  configs never eagerly bundle the component.
- `extendLoad` still works; `filter`/`pagesDir`/`transformPath` MDX options were
  removed (use plugin-level `ignore`/`pagesDir`/`toPath`).

## Removed / replaced API

| v0.7                                                          | v1                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------ |
| `createRoute`                                                 | `export const route` + `defineRoute` + `definePage` default export |
| `generatePath`                                                | `Router.paths`                                                     |
| `createClientEntry` / `createServerEntry`                     | `render` / start `App.tsx`                                         |
| `FileRouter` (virtual export)                                 | `createFileRouter()`                                               |
| `readRouteInfo` / `routeInfo` virtual export                  | `Router.routeInfo`                                                 |
| `RouteMetadataManager`, `__routeMetadataRoot__`, head markers | `useHead`                                                          |
| `reloadOnChange`                                              | upstream HMR                                                       |
| `infoDts`                                                     | upstream `types` (`output`)                                        |
| `inheritance` option                                          | per-route `inherit`                                                |
| `serverEntry` + `renderTemplate` (plugin)                     | `ssg.serverEntry` + start handler                                  |
| `route/path.ts` helpers                                       | `routePathFromFile` export                                         |
| `A` component                                                 | `<a>`                                                              |
| `createResource`                                              | Solid 2 async signals / `query`                                    |
