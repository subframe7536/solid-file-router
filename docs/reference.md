# Reference

Complete public API: plugin options, runtime exports, route config, virtual
modules, and types.

## Plugin — `solid-file-router/plugin`

```ts
import { fileRouter } from 'solid-file-router/plugin'

fileRouter(options?)
```

| Option | Type | Default | Notes |
|---|---|---|---|
| `pagesDir` | `string` | `'src/pages'` | Resolved against the Vite root |
| `output` | `string` | `'src/routes.d.ts'` | Generated route types (`types`) |
| `moduleId` | `string` | `'virtual:routes'` | Manifest virtual module id |
| `convention` | `(config) => BaseFileSystemRouter` | `defaultConvention` | Filename→router adapter; mutually exclusive with `router`/`routers` |
| `router` | `BaseFileSystemRouter` | — | Custom router, passed to `fileRoutes` |
| `routers` | `Record<string, BaseFileSystemRouter>` | — | Per-environment routers |
| `toPath` / `toRoute` | upstream fns | — | Only when the convention builds the router |
| `ignore` | `readonly string[]` | `['**/components/**','**/node_modules/**','**/dist/**']` | Extra ignore globs |
| `lazy` | `boolean` | `true` | `false` disables route code splitting |
| `mdx` | `boolean \| MdxOptions` | `false` | Satteri compile; see MDX guide |
| `ssg` | `SsgOptions` | — | Start-handler prerender; see SSG guide |
| `routeProviders` | `RouteProvider[]` | — | Experimental CMS/virtual sources |
| `verboseLog` | `boolean` | `false` | Verbose logging |

### Plugin re-exports

`defaultConvention`, `solidStartConvention`, `flatConvention`,
`DefaultFileSystemRouter`, `DEFAULT_IGNORES`, `routePathFromFile`,
`defineRouteProvider`, plus types `FileRouterConvention`,
`DefaultFileSystemRouterConfig`, `RouteProvider`, `RouteProviderEntry`,
`RouteProviderLoadContext`, `SsgOptions`, `PrerenderRoutesSource`,
`MdxOptions`, `RouteMetadata`, `RouteMetaTag`, `RouteMetadataLink`.

## Runtime — `solid-file-router`

| Export | Signature | Notes |
|---|---|---|
| `createFileRouter` | `(options?: { routes?, router? }) => FileRouter` | Creates the app router; attaches `fileRoutes`, `routeInfo`, `routeMetadata`, `paths` |
| `adaptFileRoutes` | `(entries: RouteEntry[]) => { routes, routeInfo, routeMetadata }` | Boundary/inheritance adapter over `fileRoutes()` output |
| `defineRoute` | `(config: RouteConfig<T>) => RouteConfig<T>` | Identity helper for the `route` export |
| `definePage` | `(component: Component<RouteSectionProps<T>>) => same` | Identity helper for the default export |
| `RouteConfig` | type | Official `route` keys + extension keys |
| `SfrRouteConfig` | type | Extension keys only |
| `RouteMetadata`/`RouteMetaTag`/`RouteMetadataLink` | types | Declarative head config |
| `ErrorComponentProps` | `{ error: unknown; reset: () => void }` | `errorComponent` props |
| `RouteEntry` | type | Adapted route-definition entry |

### Route config keys

Official `FileRouteConfig` keys (`preload`, `info`, `matchFilters`, `search`,
...) pass through to `@solidjs/router`. Extension keys:

| Key | Type | Notes |
|---|---|---|
| `loadingComponent` | `Component<RouteSectionProps>` | `Loading` fallback; inherits |
| `errorComponent` | `Component<ErrorComponentProps>` | `Errored` fallback; `props.error` is the thrown value |
| `inherit` | `boolean \| { loading?: boolean; error?: boolean }` | `false`/per-key `false` blocks |
| `metadata` | `RouteMetadata` | `useHead` tags |
| `draft` | `boolean` | dev-only route |

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

| Export | Notes |
|---|---|
| `MDXProvider` | `components` prop overrides |
| `useMDXComponents` | `useMDXComponents(local)` merges |
| `jsx`, `jsxs`, `Fragment` | Automatic jsx-runtime for Satteri output (`Dynamic`-backed) |
| `MDXComponent`, `MDXComponents`, `MdxRouteConfig` | types |

Subpath alias `solid-file-router/mdx/jsx-runtime` maps to the same module.

## Conventions

| Adapter | Behavior |
|---|---|
| `defaultConvention` | v0.7 table: `_app`, `_layout`, `index`, `[id]`→`:id`, `-[x]`/`[...x]`→`*x`, `(group)`, `x.y`→`x/y`, `404`→`*404`, `_private`/`components` skipped |
| `solidStartConvention` | Stock `PageFileSystemRouter` (SolidStart-style) |
| `flatConvention` | `FlatFileSystemRouter` |

All produce a `BaseFileSystemRouter`; `router`/`routers` are the fully manual
seams. `convention` and `router`/`routers` are mutually exclusive.

## SSG options

| Key | Type | Default |
|---|---|---|
| `routes` | `string[] \| (staticRoutes) => routes` | all static manifest routes |
| `concurrency` | `number` | `4` |
| `outDir` | `string` | `'dist/client'` |
| `serverEntry` | `string` | start `dist/server/server.js` |

## Route provider contract (experimental)

```ts
interface RouteProvider<TData = unknown> {
  name: string
  glob: (filter: string, root: string) => Promisable<string[]>
  watch?: string | readonly string[]
  transformPath?: (path: string) => string | undefined
  load: (entry: RouteProviderLoadContext<TData>) => Promisable<string | false | null | undefined>
}
```

`load` returns module **source**; entries are served as virtual `?pick=`
modules and registered via the shared router's `_addRoute`.

## ErrorComponentProps

```ts
interface ErrorComponentProps {
  error: unknown   // thrown value (ErrorAccessor already unwrapped)
  reset: () => void
}
```

## Removed in v1

`createRoute`, `generatePath`, `createClientEntry`, `createServerEntry`,
`FileRouter` virtual export, `readRouteInfo`, `RouteMetadataManager`,
`__routeMetadataRoot__`, `reloadOnChange`, `infoDts`, `inheritance`,
`serverEntry`/`renderTemplate` (plugin level), `meta`/`?comp`/`?load` extraction
queries, `tinyglobby`-based provider glob, `bun-types`.
