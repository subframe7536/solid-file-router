# solid-file-router Reference

This document describes the current public behavior of `solid-file-router`.
The project is pre-1.0; minor releases may introduce breaking changes.

## Package Entries

| Import                     | Contents                                               |
| -------------------------- | ------------------------------------------------------ |
| `solid-file-router`        | Runtime functions and route types                      |
| `solid-file-router/plugin` | Vite plugin, route-provider helpers, and plugin types  |
| `solid-file-router/mdx`    | MDX provider, frontmatter type, hooks, and component types |
| `solid-file-router/client` | Declaration for `virtual:routes`                       |
| `virtual:routes`           | Generated router components, definitions, and metadata |

The package is ESM only.

## File Route Reference

File routing is built in. It reads `**/*.{jsx,tsx}` below `pagesDir` and applies
`ignore`. Enable `mdx` to add `.md` and `.mdx` discovery, then use
`routeProviders` to add providers. All route inputs use the same file-to-route
conventions and uniqueness rules.
The plugin assembles the built-in `fsRouteProvider` and, when enabled, the
`mdxRouteProvider`; these factories are internal and are not exported.

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
| `draft`            | `boolean`                                           | no       | Development-only route        |
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

| Option           | Type                    | Default                    | Behavior                                                    |
| ---------------- | ----------------------- | -------------------------- | ----------------------------------------------------------- |
| `pagesDir`       | `string`                | `'src/pages'`              | Built-in JSX/TSX directory; inherited by MDX                |
| `output`         | `string`                | `'src/routes.d.ts'`        | Generated declaration path                                  |
| `routeProviders` | readonly provider array | `[]`                       | Adds route providers alongside file and optional MDX routes |
| `mdx`            | `boolean \| MdxOptions` | `false`                    | Adds Satteri-backed Markdown/MDX routes                     |
| `ignore`         | `string[]`              | see below                  | Globs ignored by discovery and watchers                     |
| `reloadOnChange` | `boolean`               | `false`                    | Full-reload escape hatch for nonstandard HMR                |
| `lazy`           | `boolean`               | client `true`, SSR `false` | Controls lazy component imports                             |
| `infoDts`        | `InfoTypeDefinition`    | `undefined`                | Metadata declaration shape                                  |
| `verboseLog`     | `boolean`               | `false`                    | Additional plugin logging                                   |
| `inheritance`    | `InheritanceConfig`     | `{ enabled: true }`        | Global component inheritance                                |
| `ssg`            | `SsgOptions`            | `undefined`                | Enables build-time prerendering                             |

Default ignores:

```ts
;['**/components/**', '**/node_modules/**', '**/dist/**']
```

Use `reloadOnChange` when generated route modules depend on external or
provider-specific state that Vite cannot invalidate through its normal HMR
module graph. Leave it disabled for ordinary route modules to preserve stateful
HMR. Structural route changes still trigger a full reload when required.

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
interface SsgOptions {
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

For setup, output examples, custom entries, and troubleshooting, see the
[SSG guide](ssg.md).

## MDX Options and Runtime

`mdx: true` adds `<pagesDir>/**/*.{md,mdx}` routes alongside the built-in
JSX/TSX routes. An options object accepts Satteri's `MdxCompileOptions` plus
`filter?: string` and `pagesDir?: string`. The plugin's `pagesDir` is inherited
unless the MDX object supplies its own. Satteri is an optional peer dependency,
and MDX requires program output. YAML frontmatter additionally requires the
optional `yaml` peer dependency.

Native Markdown/MDX routes use YAML frontmatter. Supported route fields are
`info`, `matchFilters`, `inherit`, and `draft`; other fields are exposed through
the generated `frontmatter` export. The legacy `export const route` configuration
is ignored. YAML frontmatter requires the optional `yaml` peer dependency.

`draft: true` routes are available in development and excluded from production
route matching and SSG output. A draft `_app` or `_layout` also excludes its
entire descendant subtree. Their generated path types remain available, while
the production `fileRoutes` and `routeInfo` exports omit draft entries.

MDX files are leaf routes. `_app.md(x)` and `_layout.md(x)` are rejected during
route discovery and layouts must use JSX/TSX files. `404.md(x)` remains a leaf
fallback. Duplicate normalized routes across JSX/TSX and MDX remain errors.

`solid-file-router/mdx` exports `MdxRouteConfig`, `MDXProvider`,
`useMDXComponents`, `MDXComponent`, and `MDXComponents`. `MDXComponents` preserves Solid intrinsic
HTML and SVG props while accepting arbitrary authored component names, including
`wrapper`; this typing provides compile-time assistance and does not perform
runtime prop validation. See the [MDX guide](mdx.md) for setup and component
override examples.

## Route Provider Reference

```ts
type Promisable<T> = T | Promise<T>

type RouteProviderGlob = (
  glob: typeof import('tinyglobby').glob,
  filter: string,
  root: string,
) => Promisable<string[]>

interface RouteProviderEntry<TData = unknown> {
  path: string
  routeId?: string
  data?: TData
}

interface RouteProviderLoadContext<TData = unknown> {
  path: string
  routeId: string
  sourcePath: string
  moduleId: string
  data?: TData
}

interface RouteProvider<TData = unknown> {
  filter: string
  glob?: RouteProviderGlob
  transformPath?: (path: string) => RouteProviderEntry<TData>
  load: (
    entry: RouteProviderLoadContext<TData>,
  ) => Promisable<string | null | undefined | false | void>
  watch?: string[]
}
```

`defineRouteProvider<TData>(provider)` defines a route provider, preserves
generic inference, and supplies the default glob and identity path transform.
File and MDX route discovery are configured through `fileRouter` with
`pagesDir`, `mdx`, and `MdxOptions`; the built-in providers are created
automatically and are not exported from the plugin entry.

| Field           | Behavior                                                                            |
| --------------- | ----------------------------------------------------------------------------------- |
| `filter`        | Discovery glob relative to the Vite root                                            |
| `glob`          | Optional discovery implementation; receives tinyglobby, filter, and root            |
| `transformPath` | Maps a discovered source path to its logical `path`, optional `routeId`, and `data` |
| `path`          | Logical file path controlling route conventions and layout ancestry                 |
| `routeId`       | Optional public ID; derived from the logical path when omitted                      |
| `sourcePath`    | Normalized absolute source path used for source identity and HMR                    |
| `moduleId`      | Generated facade module identity passed to `load`                                   |
| `data`          | In-process value passed unchanged from `transformPath` to `load`                    |
| `watch`         | Additional files/globs that cause the provider to rescan                            |

Normalized route IDs, logical paths, and source paths must be unique across all
route inputs. This applies to every route, including the generated `/_app` route.
Collisions are rejected instead of allowing a later provider to replace an
earlier one. `load` must return non-empty route module source for every provider
entry.

Watcher behavior:

- Literal `watch` paths match that path and descendants.
- Include globs react only to matching files; `!` patterns exclude matches.
- Discovered files always react to their exact `sourcePath`.
- Provider filter roots are registered with Vite's watcher.
- Paths resolve from the Vite root.

`data` is not serialized or cloned and does not survive a process restart.

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
- [SSG Guide](ssg.md)
- [MDX Guide](mdx.md)
- [Agent Guide](agents.md)
- [Project README](../README.md)
