# Reference

Complete public API: plugin options, runtime exports, route config, virtual
modules, and types.

## Plugin — `solid-file-router/plugin`

```ts
import { fileRouter } from 'solid-file-router/plugin'

fileRouter(options?)
```

| Option     | Type                    | Default             | Notes                                                                  |
| ---------- | ----------------------- | ------------------- | ---------------------------------------------------------------------- |
| `pagesDir` | `string`                | `'src/pages'`       | Resolved against the Vite root; ignored when `router` is given         |
| `ignore`   | `readonly string[]`     | `[]`                | Globs matched relative to `pagesDir`; `_`-prefixed files never need it |
| `output`   | `string`                | `'src/routes.d.ts'` | Generated route types (`types`)                                        |
| `lazy`     | `boolean`               | `true`              | `false` disables route code splitting                                  |
| `mdx`      | `boolean \| MdxOptions` | `false`             | Satteri compile; see MDX guide                                         |
| `ssg`      | `SsgOptions`            | —                   | Start-handler prerender; see SSG guide                                 |
| `router`   | `BaseFileSystemRouter`  | —                   | Escape hatch: replaces the built-in router (and `pagesDir`/`ignore`)   |

### Plugin re-exports

`DefaultFileSystemRouter`, `routePathFromFile`, `createGlobMatcher`, plus
types `DefaultFileSystemRouterConfig`, `SsgOptions`, `PrerenderRoutesSource`,
`MdxOptions`, `RouteMetadata`, `RouteMetaTag`, `RouteMetadataLink`,
`Promisable`.

## Runtime — `solid-file-router`

| Export                                             | Signature                                                         | Notes                                                                                |
| -------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `createFileRouter`                                 | `(options?: { routes?, router? }) => FileRouter`                  | Creates the app router; attaches `fileRoutes`, `routeInfo`, `routeMetadata`, `paths` |
| `announceRoutes`                                   | `(extraPaths?, { header? }) => boolean`                           | Sets `x-prerender` on crawler requests — static manifest routes + `extraPaths`       |
| `announcePages`                                    | re-export of `prerender-crawler/announce`                         | Raw hint-header writer for custom request handlers                                   |
| `staticPathsOf`                                    | `(manifestPaths) => string[]`                                     | Group-stripped static paths of a manifest                                            |
| `adaptFileRoutes`                                  | `(entries: RouteEntry[]) => { routes, routeInfo, routeMetadata }` | Boundary/inheritance adapter over `fileRoutes()` output                              |
| `defineRoute`                                      | `(config: RouteConfig<T>) => RouteConfig<T>`                      | Identity helper for the `route` export                                               |
| `definePage`                                       | `(component: Component<RouteSectionProps<T>>) => same`            | Identity helper for the default export                                               |
| `RouteConfig`                                      | type                                                              | Official `route` keys + extension keys                                               |
| `SfrRouteConfig`                                   | type                                                              | Extension keys only                                                                  |
| `RouteMetadata`/`RouteMetaTag`/`RouteMetadataLink` | types                                                             | Declarative head config                                                              |
| `RouteInfo`                                        | interface                                                         | `route.info` shape — augment via `declare module 'solid-file-router'`                |
| `ErrorComponentProps`                              | `{ error: unknown; reset: () => void }`                           | `errorComponent` props                                                               |
| `RouteEntry`                                       | type                                                              | Adapted route-definition entry                                                       |

### Route config keys

Official `FileRouteConfig` keys (`preload`, `info`, `matchFilters`, `search`,
...) pass through to `@solidjs/router`. Extension keys:

| Key                | Type                                                | Notes                                                 |
| ------------------ | --------------------------------------------------- | ----------------------------------------------------- |
| `loadingComponent` | `Component<RouteSectionProps>`                      | `Loading` fallback; inherits                          |
| `errorComponent`   | `Component<ErrorComponentProps>`                    | `Errored` fallback; `props.error` is the thrown value |
| `inherit`          | `boolean \| { loading?: boolean; error?: boolean }` | `false`/per-key `false` blocks                        |
| `metadata`         | `RouteMetadata`                                     | `useHead` tags                                        |
| `draft`            | `boolean`                                           | dev-only route                                        |

`info` is typed by the augmentable `RouteInfo` interface:

```ts
declare module 'solid-file-router' {
  interface RouteInfo {
    title: string
    order?: number
  }
}
```

### `RouteMetadata`

```ts
interface RouteMetadata {
  title?: string
  description?: string
  canonical?: string
  meta?: Array<{ name?: string; property?: string; content: string }>
  links?: Array<{ rel: string; href: string }>
}
```

Key map: `title` → `key:'title'`, `description` → `key:'name:description'`,
`canonical` → `key:'rel:canonical'`, `meta` → `key:'name:<n>'/'property:<p>'`,
`links` → `key:'rel:<rel>:<href>'`.

## Virtual module — `virtual:routes`

```ts
import routes, { pageRoutes } from 'virtual:routes'
```

- **default** — flat manifest entries (`path`, `page`, `$component`, `$$route`)
- **`pageRoutes`** — nested tree; pass to `fileRoutes()` from `@solidjs/router/fs`

`solid-file-router/client` declares both plus `*.md`/`*.mdx` modules.

## MDX runtime — `solid-file-router/mdx`

| Export                                            | Notes                                                       |
| ------------------------------------------------- | ----------------------------------------------------------- |
| `MDXProvider`                                     | `components` prop overrides                                 |
| `useMDXComponents`                                | `useMDXComponents(local)` merges                            |
| `jsx`, `jsxs`, `Fragment`                         | Automatic jsx-runtime for Satteri output (`Dynamic`-backed) |
| `MDXComponent`, `MDXComponents`, `MdxRouteConfig` | types                                                       |

Subpath alias `solid-file-router/mdx/jsx-runtime` maps to the same module.

## Convention

One built-in convention — `DefaultFileSystemRouter`, a `PageFileSystemRouter`
subclass. Filename table: `_app`, `_layout`, `index`, `[id]`→`:id`,
`-[x]`/`[...x]`→`*x`, `(group)`, `x.y`→`x/y`, `404`→`*404`, `_`-prefixed
segments skipped. See the table in `src/convention.ts` or the guide.

To customize scanning (different filename rules, `toPath`/`toRoute`,
per-file overrides), pass your own router:

```ts
fileRouter({ router: new MyRouter({ dir: 'src/pages', extensions }) })
// or subclass: new DefaultFileSystemRouter({ dir, extensions, toPath })
```

## SSG options

| Key           | Type                                   | Default                       |
| ------------- | -------------------------------------- | ----------------------------- |
| `routes`      | `string[] \| (staticRoutes) => routes` | all static manifest routes    |
| `concurrency` | `number`                               | `4`                           |
| `outDir`      | `string`                               | `'dist/client'`               |
| `serverEntry` | `string`                               | start `dist/server/server.js` |

All other `prerender-crawler` engine options pass through: `crawlLinks`
(default `true` — linked pages, including dynamic ones, are discovered and
rendered too), `filter`, `retries`, `interval`, `failOnError`, `emitPages`,
`integrations` (`sitemap()`, `redirects()`, `report()`), `keepQuery`,
`redirectStubs`, `mode`, `buildId`, `hintHeader`, `origin`, `onRendered`.

## ErrorComponentProps

```ts
interface ErrorComponentProps {
  error: unknown // thrown value (ErrorAccessor already unwrapped)
  reset: () => void
}
```
