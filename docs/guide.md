# Guide

Routes, layouts, data, navigation, metadata, and route providers on the
Solid 2 official stack.

## File conventions

Route files live under `pagesDir` (`src/pages` by default). The built-in
`defaultConvention` maps filenames to paths:

| File                         | Path                               |
| ---------------------------- | ---------------------------------- |
| `_app.tsx`                   | root layout                        |
| `index.tsx`                  | `/`                                |
| `about.tsx`                  | `/about`                           |
| `blog/index.tsx`             | `/blog/`                           |
| `blog/_layout.tsx`           | `/blog` (pathless layout)          |
| `blog/[id].tsx`              | `/blog/:id`                        |
| `blog/-[id].tsx`             | `/blog/*id` (optional splat)       |
| `blog/[...all].tsx`          | `/blog/*all`                       |
| `docs/-[lang]/index.tsx`     | `/docs/*lang`                      |
| `(auth)/login.tsx`           | `/login` (group stripped from URL) |
| `account.settings.tsx`       | `/account/settings`                |
| `404.tsx`                    | `*404` catch-all                   |
| `_util.tsx`, `components/**` | not routes                         |

`-(group)` segments appear in the neutral manifest path (`/(app)/...`) and
are stripped by route-tree emission. Layouts and `_app` nest children through
`props.children`.

Swap or build a convention with `fileRouter({ convention })`:

```ts
import {
  fileRouter,
  defaultConvention,
  solidStartConvention,
  flatConvention,
} from 'solid-file-router/plugin'

fileRouter({ convention: flatConvention })
// or fully custom — mutually exclusive with router/routers
fileRouter({ convention: (config) => new MyRouter(config) })
```

`ignore` adds glob patterns on top of `['**/components/**', '**/node_modules/**', '**/dist/**']`.

## Route modules

A route module uses a `route` export for config and a default export for the
component:

```tsx
// src/pages/about.tsx
import { definePage, defineRoute } from 'solid-file-router'

export const route = defineRoute({
  info: { title: 'About' },
  matchFilters: { id: /^\d+$/ },
})

export default definePage((props) => <main>{props.children}</main>)
```

`defineRoute` and `definePage` are identity helpers — they add typing without
wrapping. The scanner only checks that the exports exist, so the helpers do
not affect extraction.

### Official `route` keys

`preload`, `info`, `matchFilters`, `search`, and other upstream
`FileRouteConfig` keys pass straight through to `@solidjs/router`.

### Extension keys

| Key                | Type                                                | Effect                                          |
| ------------------ | --------------------------------------------------- | ----------------------------------------------- |
| `loadingComponent` | `Component<RouteSectionProps>`                      | `Loading` fallback                              |
| `errorComponent`   | `Component<ErrorComponentProps>`                    | `Errored` fallback, receives `{ error, reset }` |
| `inherit`          | `boolean \| { loading?: boolean; error?: boolean }` | block boundary inheritance                      |
| `metadata`         | `RouteMetadata`                                     | declarative head tags via `useHead`             |
| `draft`            | `boolean`                                           | route only exists in development                |

## Layouts and inheritance

`loadingComponent`/`errorComponent` cascade `_app.tsx` → `_layout.tsx` → page:

```tsx
// src/pages/_app.tsx
import { definePage } from 'solid-file-router'
import type { ErrorComponentProps } from 'solid-file-router'

export const route = {
  loadingComponent: () => <div>Loading…</div>,
  errorComponent: Catch,
}

function Catch(props: ErrorComponentProps) {
  return (
    <div>
      <code>{String(props.error)}</code>
      <button onClick={() => props.reset()}>retry</button>
    </div>
  )
}

export default definePage((props) => <div>{props.children}</div>)
```

`inherit: false` blocks both; `{ loading: false }` or `{ error: false }` blocks
selectively. Without an `errorComponent`, errors are logged in development.

## Navigation

Use plain `<a>` elements (the router intercepts internal links) and the typed
`Router.paths` for navigation:

```tsx
const Router = createFileRouter()
const navigate = useNavigate()

navigate(Router.paths.blog('1')) // -> /blog/1
Router.paths.blog('1')() // the string, for href building
Router.paths.blog('1')({ hash: 'top' }) // -> /blog/1#top
```

`404.tsx` handles unmatched routes; a `draft: true` route exists in dev only
and is removed (with its subtree) from production builds.

## Metadata

`route.metadata` renders `useHead` tags while the route is active:

```ts
export const route = {
  metadata: {
    title: 'Page title',
    description: 'Meta description',
    canonical: '/about',
    meta: [{ name: 'og:type', content: 'website' }],
    links: [{ rel: 'alternate', href: '/feed.xml' }],
  },
}
```

`Router.routeInfo` and `Router.routeMetadata` collect every route's `info` /
`metadata` keyed by stripped path.

## Route providers (experimental)

`routeProviders` inject non-file route sources (CMS, generated pages) as
virtual modules on the official manifest:

```ts
import { fileRouter, defineRouteProvider } from 'solid-file-router/plugin'

fileRouter({
  routeProviders: [
    defineRouteProvider({
      name: 'cms',
      glob: (filter, root) => fetchCmsRoutes(),
      watch: 'cms/**',
      transformPath: (path) => `/${path}`,
      load: async ({ path, sourcePath }) => readModule(sourcePath),
    }),
  ],
})
```

Provider modules are served from virtual `?pick=` ids, so `route`/`default`
narrowing and Solid compilation work exactly like file routes.

## SSG / SSR

See [ssg.md](ssg.md) for `solid({ start: true, ssr: true })` + `fileRouter({ ssg: {} })`.
