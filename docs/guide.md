# solid-file-router Guide

This guide follows the normal integration path from installation to custom
route providers. Use the [reference](reference.md) for complete option tables and
API signatures.

## Installation

Install the package and the Solid/Vite dependencies:

```bash
bun add solid-file-router @solidjs/router solid-js
bun add -d vite vite-plugin-solid
```

`@babel/core` and `tinyglobby` are provided through `vite-plugin-solid` and
Vite, so applications do not need to install them directly.

The package is ESM only. It does not install or configure `vite-plugin-solid`
for the consuming application.

The project is pre-1.0 and under active development. Minor releases may contain
breaking changes, so review release notes before upgrading.

## Basic Setup

Register both Vite plugins:

```ts
// vite.config.ts
import { fileRouter } from 'solid-file-router/plugin'
import { defineConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'

export default defineConfig({
  plugins: [solidPlugin(), fileRouter()],
})
```

Add the virtual-module declaration to the application TypeScript config:

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "types": ["solid-file-router/client"],
  },
}
```

The plugin scans `src/pages` and writes `src/routes.d.ts` by default. The
generated declaration augments route paths and parameters in both
`solid-file-router` and `@solidjs/router`. Do not edit it manually.

Create the first page:

```tsx
// src/pages/index.tsx
import { createRoute } from 'solid-file-router'

export default createRoute({
  component: () => <h1>Home</h1>,
})
```

Render the generated router:

```tsx
// src/index.tsx
import { render } from 'solid-js/web'
import { FileRouter } from 'virtual:routes'

render(() => <FileRouter />, document.getElementById('root')!)
```

## File Conventions

File routing is built in and scans `.jsx` and `.tsx` files below `pagesDir`.
Route paths are derived from paths relative to `pagesDir`:

```text
src/pages/
  _app.tsx
  index.tsx
  about.tsx
  404.tsx
  blog/
    _layout.tsx
    index.tsx
    [slug].tsx
    -[...all].tsx
  docs/
    -[lang]/
      index.tsx
  (auth)/
    login.tsx
  account.settings.tsx
```

| File                     | URL                            | Meaning                   |
| ------------------------ | ------------------------------ | ------------------------- |
| `index.tsx`              | `/`                            | Root index                |
| `about.tsx`              | `/about`                       | Static segment            |
| `blog/index.tsx`         | `/blog`                        | Nested index              |
| `blog/[slug].tsx`        | `/blog/:slug`                  | Required parameter        |
| `docs/-[lang]/index.tsx` | `/docs/:lang?`                 | Optional parameter        |
| `blog/-[...all].tsx`     | `/blog/*?`                     | Optional splat            |
| `(auth)/login.tsx`       | `/login`                       | Pathless group            |
| `account.settings.tsx`   | `/account/settings`            | Dot-separated segments    |
| `blog/_layout.tsx`       | none                           | Wraps routes below `blog` |
| `404.tsx`                | `*` route, `/404` metadata key | Not-found component       |

Files or directories whose segment starts with `_` are private and do not
become pages. `_app.jsx`, `_app.tsx`, `_layout.jsx`, `_layout.tsx`, and the
special `404` route are handled separately.

Every page, layout, and app module must default-export a `createRoute(...)`
call. The top-level config cannot use a spread because the plugin extracts
selected properties at build time.

## Layouts

Use `_app.tsx` for an application-wide root:

```tsx
// src/pages/_app.tsx
import { createRoute } from 'solid-file-router'

export default createRoute({
  component: (props) => <main>{props.children}</main>,
})
```

`_app.tsx` is recommended, not required. If it is missing, the generated `Root`
passes through its children and the plugin logs a warning.

Use `_layout.tsx` to wrap descendant routes in one directory:

```tsx
// src/pages/settings/_layout.tsx
import { A } from '@solidjs/router'
import { createRoute } from 'solid-file-router'

export default createRoute({
  component: (props) => (
    <section>
      <nav>
        <A href="/settings/profile">Profile</A>
      </nav>
      {props.children}
    </section>
  ),
})
```

## Data Preloading

`preload` is passed through to `@solidjs/router`. Its return value is available
as `props.data` on the route component:

```tsx
// src/pages/users.tsx
import { createRoute } from 'solid-file-router'
import { For } from 'solid-js'

export default createRoute({
  preload: async () => {
    const response = await fetch('/api/users')
    return response.json() as Promise<Array<{ id: string; name: string }>>
  },
  component: (props) => (
    <ul>
      <For each={props.data}>{(user) => <li>{user.name}</li>}</For>
    </ul>
  ),
})
```

Use `matchFilters` for the parameter filtering behavior provided by
`@solidjs/router`.

## Navigation

The generated declaration narrows paths accepted by `A`, `Navigator`, and
`redirect` from `@solidjs/router`.

Use `generatePath` to substitute dynamic parameters and append query values:

```ts
import { generatePath } from 'solid-file-router'

const href = generatePath('/blog/:slug', {
  $slug: 'release-notes',
  ref: 'home',
})
// /blog/release-notes?ref=home
```

Keys prefixed with `$` replace matching `:param` segments. Other keys become
query parameters through `URLSearchParams`.

## Route Metadata

Add metadata through `info`:

```tsx
// src/pages/blog/index.tsx
import { createRoute } from 'solid-file-router'

export default createRoute({
  info: {
    title: 'Blog',
  },
  component: () => <h1>Blog</h1>,
})
```

Declare the metadata shape inline in Vite config:

```ts
fileRouter({
  infoDts: {
    title: 'string',
    auth: {
      required: 'boolean',
    },
  },
})
```

Or extend an existing object interface. `from` is emitted relative to the
generated declaration file:

```ts
fileRouter({
  infoDts: {
    type: 'import',
    from: '../types/routes',
    name: 'RouteInfo',
  },
})
```

Read metadata from the deepest current match:

```tsx
import { useCurrentMatches } from '@solidjs/router'
import { readRouteInfo } from 'solid-file-router'

const matches = useCurrentMatches()
const info = () => readRouteInfo(matches())
```

For direct access by generated route pattern, import `routeInfo` from
`virtual:routes`.

## Loading and Error Inheritance

Loading and error components resolve independently in this order:

1. The current route
2. The nearest ancestor `_layout.tsx`
3. More distant ancestor layouts
4. `_app.tsx`
5. No custom component

```tsx
// src/pages/_app.tsx
import { createRoute } from 'solid-file-router'

export default createRoute({
  component: (props) => <main>{props.children}</main>,
  loadingComponent: () => <p>Loading...</p>,
  errorComponent: (props) => (
    <section>
      <p>{props.error.message}</p>
      <button onClick={props.reset}>Retry</button>
    </section>
  ),
})
```

Disable both inherited channels for one route with `inherit: false`, or disable
one channel with `inherit: { loading: false }` or
`inherit: { error: false }`. A component declared on the current route still
applies when inheritance is disabled.

Disable inheritance globally:

```ts
fileRouter({
  inheritance: {
    enabled: false,
  },
})
```

## Custom Router Setup

`FileRouter` is the default integration and accepts the same props as
`@solidjs/router`'s `Router`:

```tsx
import { render } from 'solid-js/web'
import { FileRouter } from 'virtual:routes'

render(() => <FileRouter base="/app" />, document.getElementById('root')!)
```

For manual composition, use the generated `Root` and `fileRoutes`:

```tsx
import { Router } from '@solidjs/router'
import { render } from 'solid-js/web'
import { Root, fileRoutes } from 'virtual:routes'

render(
  () => (
    <Router root={Root} preload={true}>
      {fileRoutes}
    </Router>
  ),
  document.getElementById('root')!,
)
```

## Static Generation and MDX

These build workflows have dedicated guides:

- [Static Site Generation](ssg.md) covers route selection, output paths, HTML
  insertion markers, hydration, and custom server entries.
- [Markdown and MDX Routes](mdx.md) covers Satteri installation, built-in MDX
  discovery, component overrides, compiler options, and HMR.

## Route Providers

Use `routeProviders` for a CMS, documentation index, or generated modules. File
routes remain available automatically, and `mdx` can add Markdown routes. A
provider discovers source paths, maps logical route entries, and returns
complete route module source from `load`:

```ts
// vite.config.ts
import { defineRouteProvider, fileRouter } from 'solid-file-router/plugin'

interface DocsData {
  title: string
}

const provider = defineRouteProvider<DocsData>({
  filter: 'docs/**/*.mdx',
  transformPath: (path) => ({
    path: path.replace(/^docs\//, '').replace(/\.mdx$/, '.tsx'),
    data: {
      title: path
        .split('/')
        .at(-1)!
        .replace(/\.mdx$/, ''),
    },
  }),
  load: ({ data }) => {
    if (!data) {
      return
    }

    const title = JSON.stringify(data.title)
    return `import { createRoute } from 'solid-file-router'
export default createRoute({
  info: { title: ${title} },
  component: () => <h1>{${title}}</h1>,
})`
  },
  watch: ['!docs/**/_*.mdx'],
})

fileRouter({ routeProviders: [provider] })
```

`routeId` is optional and is derived from `path` when omitted. `path` controls
file-router semantics and inheritance; the original glob path identifies the
source for HMR; `data` is passed unchanged from `transformPath` to `load`.

`load` must return non-empty module source for every entry. A missing value
throws an error. For complete provider types and watcher matching rules, see
[Route Provider Reference](reference.md#route-provider-reference).

## Next Steps

- [Reference](reference.md) for every option and public export
- [Agent Guide](agents.md) for deterministic integration and maintenance tasks
- [Project README](../README.md) for the shortest setup path
