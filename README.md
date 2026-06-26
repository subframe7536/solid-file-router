# solid-file-router

Type-safe file-based routing for Solid. It scans route modules, generates
`@solidjs/router` route definitions, exposes a ready-to-render `<FileRouter />`,
and writes route path types for navigation helpers.

ESM only.

## What It Does

- Generates routes from `src/pages/**`
- Generates `src/routes.d.ts` with typed paths, params, and route metadata
- Exposes `virtual:routes` with `FileRouter`, `fileRoutes`, `Root`, and `routeInfo`
- Supports `_app.tsx` root layout and nested `_layout.tsx` layouts
- Inherits loading and error components from app/layout routes
- Supports route `preload`, `matchFilters`, metadata, lazy loading, and SSG
- Supports custom route providers for MDX, CMS, docs, or generated modules

## When To Use It

Use `solid-file-router` when you want file-based routing while keeping direct
control over your Solid and Vite setup.

This package does not configure `vite-plugin-solid` for you. Add it in your app
Vite config.

## Quick Start

Install:

```bash
bun add solid-file-router vite-plugin-solid
```

Configure Vite:

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'
import { fileRouter } from 'solid-file-router/plugin'

export default defineConfig({
  plugins: [solidPlugin(), fileRouter()],
})
```

Add generated route types:

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "types": ["solid-file-router/client"],
  },
}
```

Create the required root route:

```tsx
// src/pages/_app.tsx
import { createRoute } from 'solid-file-router'

export default createRoute({
  component: (props) => <main>{props.children}</main>,
})
```

Create a page:

```tsx
// src/pages/index.tsx
import { createRoute } from 'solid-file-router'

export default createRoute({
  component: () => <h1>Hello</h1>,
})
```

Render the generated router:

```tsx
// src/index.tsx
import { render } from 'solid-js/web'
import { FileRouter } from 'virtual:routes'

render(() => <FileRouter />, document.getElementById('app')!)
```

## Agent Map

Use this section when editing or integrating the package.

| Task                                | Read                                                         |
| ----------------------------------- | ------------------------------------------------------------ |
| Add a route                         | [Route Files](#route-files), [Route Modules](#route-modules) |
| Understand generated URLs           | [File Conventions](#file-conventions)                        |
| Use generated route output          | [Generated Virtual Module](#generated-virtual-module)        |
| Add route metadata                  | [Route Metadata](#route-metadata)                            |
| Add loading/error fallbacks         | [Component Inheritance](#component-inheritance)              |
| Configure the Vite plugin           | [Plugin Options](#plugin-options)                            |
| Build static HTML                   | [SSG Prerendering](#ssg-prerendering)                        |
| Generate routes from another source | [Custom Route Sources](#custom-route-sources)                |

## Core Concepts

### Route Files

Routes live in `src/pages` by default. Every route, layout, and app file must
default-export `createRoute(...)`.

```tsx
import { createRoute } from 'solid-file-router'

export default createRoute({
  component: () => <div>Page</div>,
})
```

### Generated Virtual Module

Import generated routes from `virtual:routes`:

```tsx
import { FileRouter, Root, fileRoutes, routeInfo } from 'virtual:routes'
```

| Export       | Use                                             |
| ------------ | ----------------------------------------------- |
| `FileRouter` | Ready-to-render router component                |
| `fileRoutes` | Raw `RouteDefinition[]` for custom router setup |
| `Root`       | Generated root component from `_app.tsx`        |
| `routeInfo`  | Metadata keyed by route pattern                 |

### Generated Types

The plugin writes `src/routes.d.ts` by default. It augments:

- `solid-file-router` route path and metadata types
- `@solidjs/router` `A`, `Navigator`, and `redirect` path types

## File Conventions

```txt
src/pages/
  _app.tsx              # required root layout
  index.tsx             # /
  about.tsx             # /about
  404.tsx               # catch-all route

  blog/
    _layout.tsx         # wraps /blog/*
    index.tsx           # /blog
    [id].tsx            # /blog/:id

  -[lang]/
    index.tsx           # /:lang?

  (auth)/
    login.tsx           # /login

  path.to.some.url.tsx  # /path/to/some/url
```

| Convention       | File                      | URL               |
| ---------------- | ------------------------- | ----------------- |
| Root app         | `pages/_app.tsx`          | wraps every route |
| Index            | `pages/index.tsx`         | `/`               |
| Nested index     | `pages/blog/index.tsx`    | `/blog`           |
| Static segment   | `pages/about.tsx`         | `/about`          |
| Dynamic param    | `pages/blog/[id].tsx`     | `/blog/:id`       |
| Optional segment | `pages/-[lang]/index.tsx` | `/:lang?`         |
| Dot notation     | `pages/a.b.c.tsx`         | `/a/b/c`          |
| Pathless group   | `pages/(auth)/login.tsx`  | `/login`          |
| 404              | `pages/404.tsx`           | `*`               |
| Layout           | `pages/blog/_layout.tsx`  | wraps `/blog/*`   |

## Route Modules

`createRoute(config)` returns the route config unchanged. The plugin extracts
specific properties at build time.

```tsx
import { createRoute } from 'solid-file-router'

export default createRoute({
  info: {
    title: 'Dashboard',
  },
  preload: async () => fetch('/api/stats').then((res) => res.json()),
  loadingComponent: () => <div>Loading...</div>,
  errorComponent: (props) => (
    <section>
      <p>{props.error.message}</p>
      <button onClick={props.reset}>Retry</button>
    </section>
  ),
  component: (props) => <pre>{JSON.stringify(props.data)}</pre>,
})
```

| Property           | Required | Use                                                   |
| ------------------ | -------- | ----------------------------------------------------- |
| `component`        | yes      | Page or layout component                              |
| `preload`          | no       | Async data loader passed to `@solidjs/router`         |
| `loadingComponent` | no       | Suspense fallback for this route or descendants       |
| `errorComponent`   | no       | Error boundary fallback for this route or descendants |
| `info`             | no       | Route metadata                                        |
| `matchFilters`     | no       | Param validation                                      |
| `inherit`          | no       | Per-route loading/error inheritance control           |

## Navigation

Use generated path types with router APIs, or build paths with `generatePath`.

```tsx
import { generatePath } from 'solid-file-router'

const href = generatePath('/blog/:id', {
  $id: '42',
  ref: 'home',
})
// /blog/42?ref=home
```

Param keys use a `$` prefix. Other keys become query parameters.

## Route Metadata

Add metadata in route modules:

```tsx
export default createRoute({
  info: {
    title: 'Blog',
    auth: { required: false },
  },
  component: () => <h1>Blog</h1>,
})
```

Define metadata types in the plugin config:

```ts
fileRouter({
  infoDts: {
    title: 'string',
    description: 'string',
    auth: {
      required: 'boolean',
    },
    tags: 'string[]',
  },
})
```

Read metadata from router matches:

```tsx
import { useCurrentMatches } from '@solidjs/router'
import { readRouteInfo } from 'solid-file-router'

const matches = useCurrentMatches()
const info = () => readRouteInfo(matches())
```

Or read generated metadata directly:

```ts
import { routeInfo } from 'virtual:routes'

const home = routeInfo['/']
```

## Layouts

`_app.tsx` is required and wraps every route.

```tsx
// src/pages/_app.tsx
import { createRoute } from 'solid-file-router'

export default createRoute({
  component: (props) => <main>{props.children}</main>,
})
```

`_layout.tsx` wraps child routes in its directory.

```tsx
// src/pages/settings/_layout.tsx
import { A } from '@solidjs/router'
import { createRoute } from 'solid-file-router'

export default createRoute({
  component: (props) => (
    <section>
      <nav>
        <A href="/settings/profile">Profile</A>
        <A href="/settings/account">Account</A>
      </nav>
      {props.children}
    </section>
  ),
})
```

## Component Inheritance

Loading and error components cascade from app to layout to route:

```txt
route component
nearest _layout.tsx
src/pages/_app.tsx
none
```

Define app-wide defaults:

```tsx
// src/pages/_app.tsx
import { createRoute } from 'solid-file-router'

export default createRoute({
  component: (props) => <main>{props.children}</main>,
  loadingComponent: () => <div>Loading...</div>,
  errorComponent: (props) => (
    <section>
      <h1>Error</h1>
      <p>{props.error.message}</p>
      <button onClick={props.reset}>Retry</button>
    </section>
  ),
})
```

Override at layout or route level:

```tsx
export default createRoute({
  component: (props) => <section>{props.children}</section>,
  loadingComponent: () => <div>Loading dashboard...</div>,
})
```

Disable inheritance per route:

```tsx
export default createRoute({
  component: () => <SpecialPage />,
  inherit: false,
})
```

Disable only one channel:

```tsx
export default createRoute({
  component: () => <SpecialPage />,
  inherit: { error: false },
})
```

Configure inheritance globally:

```ts
fileRouter({
  inheritance: {
    enabled: true,
    inheritLoading: true,
    inheritError: true,
  },
})
```

## Custom Router Setup

`FileRouter` is the default integration:

```tsx
import { render } from 'solid-js/web'
import { FileRouter } from 'virtual:routes'

render(() => <FileRouter base="/app" />, document.getElementById('app')!)
```

Use `fileRoutes` and `Root` for manual `@solidjs/router` setup:

```tsx
import { Router } from '@solidjs/router'
import { render } from 'solid-js/web'
import { Root, fileRoutes } from 'virtual:routes'

render(
  () => (
    <Router root={(props) => <Root>{props.children}</Root>} preload={true}>
      {fileRoutes}
    </Router>
  ),
  document.getElementById('app')!,
)
```

## SSG Prerendering

Enable SSG with `fileRouter({ ssg })`.

Requirements:

- Use `vite-plugin-solid({ ssr: true })`
- Use `createClientEntry(...)` in the browser entry
- Add a server entry that exports `createServerEntry(...)`
- Ensure `index.html` contains the configured root element, default `root`

Client entry:

```tsx
// src/index.tsx
import { FileRouter } from 'virtual:routes'
import { createClientEntry } from 'solid-file-router'

createClientEntry(() => <FileRouter />, document.getElementById('root')!)
```

Server entry:

```tsx
// src/entry-server.tsx
import { createServerEntry } from 'solid-file-router'

export default createServerEntry()
```

Vite config:

```ts
import { defineConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'
import { fileRouter } from 'solid-file-router/plugin'

export default defineConfig({
  plugins: [
    solidPlugin({ ssr: true }),
    fileRouter({
      ssg: {
        serverEntry: 'src/entry-server.tsx',
        id: 'root',
        routes: ['/', '/about'],
        concurrency: 4,
      },
    }),
  ],
})
```

Custom server router:

```tsx
import { FileRouter } from 'virtual:routes'
import { createServerEntry } from 'solid-file-router'

export default createServerEntry((props) => <FileRouter base="/docs" url={props.url} />)
```

See `playground/vite.ssg.config.ts` for a runnable example.

## Custom Route Sources

Use `routeSource` when route modules come from MDX, a CMS, docs, or generated
files. When `routeSource` is provided, `pagesDir` scanning is disabled.

```ts
import { fileRouter } from 'solid-file-router/plugin'

fileRouter({
  routeSource: {
    scan: () => [
      {
        routeId: '/',
        routePath: '_app.tsx',
        sourcePath: 'docs/routes/_app.tsx',
      },
      {
        routeId: '/button',
        routePath: '(general)/button.tsx',
        sourcePath: 'docs/button.mdx',
      },
      {
        routeId: '/404',
        routePath: '404.tsx',
        sourcePath: 'docs/routes/404.tsx',
      },
    ],
    load(entry) {
      if (entry.routePath === '_app.tsx') {
        return `import { createRoute } from 'solid-file-router'
export default createRoute({ component: (props) => <main>{props.children}</main> })`
      }

      if (entry.routeId === '/button') {
        return `import { createRoute } from 'solid-file-router'
export default createRoute({ info: { title: 'Button' }, component: () => <h1>Button</h1> })`
      }

      return `import { createRoute } from 'solid-file-router'
export default createRoute({ component: () => <h1>Not found</h1> })`
    },
    watchFiles: ['docs'],
  },
})
```

Provider types:

```ts
interface RouteSourceEntry {
  routeId: string
  routePath: string
  sourcePath: string
}

interface RouteSourceLoadContext {
  routeId: string
  routePath: string
  sourcePath: string
  moduleId: string
}

interface RouteSourceProvider {
  scan: string | ((glob, root: string) => Promisable<RouteSourceEntry[]>)
  load: (entry: RouteSourceLoadContext) => Promisable<string | null | undefined | false | void>
  watchFiles?: string[]
}
```

| Field        | Controls                                                                 |
| ------------ | ------------------------------------------------------------------------ |
| `routeId`    | Public URL, route types, `routeInfo`, and route ID                       |
| `routePath`  | File-router semantics such as `_app`, `_layout`, groups, and inheritance |
| `sourcePath` | Source identity used for generated facade modules                        |
| `load`       | Full route module source                                                 |
| `watchFiles` | Extra HMR invalidation paths relative to Vite root                       |

## Plugin Options

Pass options to `fileRouter(options)` in `vite.config.ts`.

| Option           | Default                                                    | Use                                       |
| ---------------- | ---------------------------------------------------------- | ----------------------------------------- |
| `pagesDir`       | `'src/pages'`                                              | Route file directory                      |
| `output`         | `'src/routes.d.ts'`                                        | Generated type declaration path           |
| `ignore`         | `['**/components/**', '**/node_modules/**', '**/dist/**']` | Glob patterns to skip                     |
| `reloadOnChange` | `true`                                                     | Full page reload on route file HMR        |
| `lazy`           | client: `true`, SSR: `false`                               | Lazy route component imports              |
| `infoDts`        | `undefined`                                                | Generated metadata type shape             |
| `verboseLog`     | `false`                                                    | Extra plugin logging                      |
| `inheritance`    | `{ enabled: true }`                                        | Global loading/error inheritance behavior |
| `routeSource`    | `undefined`                                                | Custom route provider                     |
| `ssg`            | `undefined`                                                | Static prerender config                   |

## Runtime API

### `createRoute(config)`

Defines a route module. It must be the default export of route, layout, and app
files.

```ts
function createRoute<T>(config: RouteConfig<T>): RouteConfig<T>
```

### `generatePath(path, params)`

Builds a typed URL from a route pattern.

```ts
generatePath('/blog/:id', { $id: '42', ref: 'home' })
```

### `readRouteInfo(matches)`

Returns metadata from the deepest route match.

```ts
const info = readRouteInfo(matches)
```

### `createClientEntry(component, mount)`

Client render helper for SSG-aware hydration.

```ts
createClientEntry(() => <FileRouter />, document.getElementById('root')!)
```

### `createServerEntry(component?)`

Creates the server renderer used by SSG.

```ts
export default createServerEntry()
```

## Development

This repository uses Bun.

```bash
bun run build
bun run test
bun run lint
bun run typecheck
bun run qa
```

Run the playground:

```bash
bun run play
```

## License

MIT

## Credit

Inspired by [`generouted`](https://github.com/oedotme/generouted).
