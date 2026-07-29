# solid-file-router Reference

This document describes the public behavior of `solid-file-router` 0.6.1. The
project is pre-1.0; minor releases may introduce breaking changes.

## Package Entries

| Import                     | Contents                                               |
| -------------------------- | ------------------------------------------------------ |
| `solid-file-router`        | Runtime functions and route types                      |
| `solid-file-router/plugin` | Vite plugin, route source helpers, and plugin types    |
| `solid-file-router/client` | Declaration for `virtual:routes`                       |
| `virtual:routes`           | Generated router components, definitions, and metadata |

The package is ESM only.

## File Route Reference

The built-in scanner reads `**/*.{jsx,tsx}` below `pagesDir` and applies
`ignore`. It does not scan `.mdx`; use `routeSource` for non-JSX sources.

| Input relative to `pagesDir` | Generated path          |
| ---------------------------- | ----------------------- |
| `index.tsx`                  | `/`                     |
| `about.tsx`                  | `/about`                |
| `blog/index.tsx`             | `/blog`                 |
| `blog/[slug].tsx`            | `/blog/:slug`           |
| `docs/-[lang]/index.tsx`     | `/docs/:lang?`          |
| `files/[...all].tsx`         | `/files/*`              |
| `files/-[...all].tsx`        | `/files/*?`             |
| `(auth)/login.tsx`           | `/login`                |
| `a.b.c.tsx`                  | `/a/b/c`                |
| `404.tsx`                    | special catch-all route |

Rules:

- `index` removes the final path segment.
- `[name]` becomes `:name`.
- `[...name]` becomes `*`; the generated parameter key is `'*'`.
- A segment prefixed with `-` becomes optional.
- `(group)` is omitted from the URL but remains part of route-tree placement.
- Dots become URL separators.
- Any ordinary file or directory segment starting with `_` is private.
- `_layout.jsx` and `_layout.tsx` wrap descendant routes without adding a URL
  segment.
- `_app.jsx` and `_app.tsx` provide the generated root. If absent, a pass-through
  root is generated.
- `404.jsx` or `404.tsx` supplies the catch-all component. If absent, the
  fallback renders `null`.

Every route module must default-export `createRoute(...)`. Supported forms are
a direct default export or a local identifier initialized by `createRoute` and
then exported as default. The top-level config must be an object literal and
must not contain spreads.

## `createRoute`

```ts
function createRoute<T>(config: RouteConfig<T>): RouteConfig<T>
```

`createRoute` returns its input unchanged at runtime. The Vite plugin extracts
selected properties at build time.

| Property           | Type                                                | Required | Behavior                      |
| ------------------ | --------------------------------------------------- | -------- | ----------------------------- |
| `component`        | `Component<RouteSectionProps<T>>`                   | yes      | Page or layout component      |
| `preload`          | `RouteDefinition['preload']`                        | no       | Router data preload function  |
| `matchFilters`     | `RouteDefinition['matchFilters']`                   | no       | Router parameter filters      |
| `info`             | `FileRouteInfo`                                     | no       | Generated route metadata      |
| `loadingComponent` | `Component<RouteSectionProps<T>>`                   | no       | Suspense fallback             |
| `errorComponent`   | `Component<{ error: Error; reset: VoidFunction }>`  | no       | Error fallback                |
| `inherit`          | `boolean \| { loading?: boolean; error?: boolean }` | no       | Per-route inheritance control |

`inherit` defaults to enabled. `false` disables both inherited channels;
`{ loading: false }` or `{ error: false }` disables one. Components declared on
the current route always take precedence.

## Plugin Options

Import `fileRouter` from `solid-file-router/plugin`:

```ts
import { fileRouter } from 'solid-file-router/plugin'
```

| Option           | Type                         | Default                    | Behavior                                     |
| ---------------- | ---------------------------- | -------------------------- | -------------------------------------------- |
| `pagesDir`       | `string`                     | `'src/pages'`              | Built-in route directory                     |
| `output`         | `string`                     | `'src/routes.d.ts'`        | Generated declaration path                   |
| `routeSource`    | `RouteSourceProvider<TData>` | `undefined`                | Replaces built-in directory scanning         |
| `ignore`         | `string[]`                   | see below                  | Globs ignored by scanning and watcher events |
| `reloadOnChange` | `boolean`                    | `false`                    | Deprecated full-reload escape hatch          |
| `lazy`           | `boolean`                    | client `true`, SSR `false` | Lazy component imports                       |
| `infoDts`        | `InfoTypeDefinition`         | `undefined`                | Metadata declaration shape                   |
| `verboseLog`     | `boolean`                    | `false`                    | Additional plugin logging                    |
| `inheritance`    | `InheritanceConfig`          | `{ enabled: true }`        | Global component inheritance                 |
| `ssg`            | SSG config                   | `undefined`                | Enables build-time prerendering              |

Default ignores:

```ts
;['**/components/**', '**/node_modules/**', '**/dist/**']
```

`reloadOnChange` is deprecated. Prefer Vite's normal HMR behavior. Structural
route changes still trigger a full reload when required.

`lazy` can explicitly override either environment default. Loading and error
boundaries are generated in both lazy and eager modes.

### Inheritance Config

```ts
interface InheritanceConfig {
  enabled?: boolean
  inheritLoading?: boolean
  inheritError?: boolean
}
```

All fields resolve to `true` when omitted. `enabled: false` prevents generation
of inherited component chains. The two channel options disable only loading or
error inheritance globally.

### Metadata Type Config

Inline descriptors are TypeScript type strings:

```ts
fileRouter({
  infoDts: {
    title: 'string',
    tags: 'string[]',
    auth: {
      required: 'boolean',
    },
  },
})
```

An imported metadata type must be compatible with an object interface:

```ts
fileRouter({
  infoDts: {
    type: 'import',
    from: '../types/routes',
    name: 'RouteInfo',
  },
})
```

The `from` value is emitted as written in the generated declaration, so make it
relative to `output` when using a relative module path.

### SSG Config

```ts
interface SsgConfig {
  serverEntry?: string
  id?: string
  routes?: readonly string[] | (() => readonly string[] | Promise<readonly string[]>)
  concurrency?: number
}
```

| Field         | Default                    | Behavior                                               |
| ------------- | -------------------------- | ------------------------------------------------------ |
| `serverEntry` | internal renderer          | Custom build-time renderer entry                       |
| `id`          | `'root'`                   | Mount element ID created or replaced in HTML           |
| `routes`      | all concrete static routes | Route paths to prerender                               |
| `concurrency` | `4`                        | Maximum parallel render tasks; values below 1 become 1 |

SSG behavior:

- Requires `vite-plugin-solid({ ssr: true })`.
- Produces client output under `<outDir>/client` and server build output under
  `<outDir>/server`.
- Normalizes leading and trailing slashes, rejects `.` and `..` path segments,
  deduplicates routes, and excludes `/404` from normal prerender output.
- Emits `/` as `index.html`, other routes as their path plus `.html`, and always
  emits `404.html` using the `/404` renderer.
- Uses `<!--solid-file-router-outlet-->` when present; otherwise replaces the
  contents of the element whose ID matches `id`.
- Uses `<!--solid-file-router-head-->` when present; otherwise inserts Solid's
  hydration bootstrap immediately before `</head>`.
- Rejects duplicate outlet markers and missing outlet/head insertion points.

## Custom Route Source Reference

```ts
type Promisable<T> = T | Promise<T>

interface RouteSourceEntry<TData = unknown> {
  path: string
  routeId?: string
  data?: TData
}

interface RouteSourceLoadContext<TData = unknown> {
  routeId: string
  path: string
  sourcePath: string
  moduleId: string
  data?: TData
}

interface RouteSourceProvider<TData = unknown> {
  filter: string
  glob?: (
    glob: typeof import('tinyglobby').glob,
    filter: string,
    root: string,
  ) => Promisable<string[]>
  transformPath?: (path: string) => RouteSourceEntry<TData>
  load: (
    entry: RouteSourceLoadContext<TData>,
  ) => Promisable<string | null | undefined | false | void>
  watch?: string[]
}
```

Use `defineRouteSource<TData>(provider)` to preserve generic inference between
`scan` and `load`.

| Field        | Behavior                                                       |
| ------------ | -------------------------------------------------------------- |
| `routeId`    | Public route ID and URL; derived from `routePath` when omitted |
| `routePath`  | File-router semantics, layout ancestry, and default route ID   |
| `sourcePath` | Source identity used for HMR and generated facade modules      |
| `moduleId`   | Generated module identity passed only to `load`                |
| `data`       | Build-process data passed unchanged from `scan` to `load`      |
| `watchFiles` | Additional HMR paths relative to Vite root                     |

`path` and source path must be unique after normalization. `load` must return module source for
every entry or the plugin throws.

Watcher behavior:

- Literal `watchFiles` paths match that path and descendants.
- Include globs react only to matching files.
- Patterns prefixed with `!` exclude matches.
- Route source files always react to their exact `sourcePath`.
- A string `scan` value also becomes a watched glob.
- Paths resolve from the Vite root.

`data` is not serialized or cloned and does not survive a process restart.
Return all data needed by `load` from the current `scan` call.

## Generated Virtual Module

Enable its declaration with `"types": ["solid-file-router/client"]`, then
import from `virtual:routes`:

```ts
import { FileRouter, Root, fileRoutes, routeInfo } from 'virtual:routes'
```

| Export       | Declared type      | Behavior                                             |
| ------------ | ------------------ | ---------------------------------------------------- |
| `FileRouter` | `typeof Router`    | Router with generated `root` and `children` defaults |
| `Root`       | `Component`        | `_app` component or generated pass-through root      |
| `fileRoutes` | `RouteDefinition`  | Generated route definition tree                      |
| `routeInfo`  | `FileRouteInfoMap` | Metadata keyed by generated route pattern            |

Props passed to `FileRouter` are merged after generated defaults and therefore
can customize normal `Router` behavior.

## Generated Route Types

The plugin writes `output` when the generated declaration changes. By default
this is `src/routes.d.ts`.

The declaration:

- Augments `FileRoutePath` in `solid-file-router`.
- Optionally augments `FileRouteInfo` from `infoDts`.
- Narrows `A.href`, `Navigator`, and `redirect` in `@solidjs/router` to generated
  paths.
- Includes `/404` even when no custom `404` module exists.

Dynamic parameter keys use a `$` prefix. Optional route parameters become
optional object properties. Splat paths use the `'*'` key.

## Runtime API

### `generatePath`

```ts
function generatePath<T extends keyof FileRoutePath & string>(
  path: T,
  params: FileRoutePath[T] extends never
    ? Record<string, unknown>
    : FileRoutePath[T] & Record<string, unknown>,
): string
```

Replaces `:name` with `$name` values. Every non-`$` key is appended as a query
parameter with `URLSearchParams`. Values should be string-compatible.

### `readRouteInfo`

```ts
function readRouteInfo<T extends FileRouteInfo = FileRouteInfo>(
  matches: readonly FileRouteMatch[],
): T | undefined
```

Returns metadata from the last match. It prefers `match.route.info` and falls
back to `match.info`.

### `createClientEntry`

```ts
function createClientEntry(
  component: Parameters<typeof render>[0],
  mount: Parameters<typeof render>[1],
): void
```

Uses `render` in development. In production it hydrates when Solid hydration
state exists on `window`; otherwise it renders normally.

### `createServerEntry`

```ts
async function createServerEntry(
  component: Component<{ url: string; base: string }>,
): Promise<(props: { url: string }) => Promise<string>>
```

Creates a build-time SSG renderer with `renderToStringAsync`. It throws outside
SSR. The component receives the requested URL and `import.meta.env.BASE_URL`.

## Related Documentation

- [Guide](guide.md)
- [Agent Guide](agents.md)
- [Project README](../README.md)
