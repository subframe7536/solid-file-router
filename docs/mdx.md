# Markdown and MDX Routes

Built-in Markdown/MDX routing compiles `.md` and `.mdx` files with
[Satteri](https://satteri.bruits.org/) and applies the same file conventions as
JSX/TSX routes.

## Install and Enable

Satteri is an optional peer dependency. Install it only when using MDX:

```bash
bun add -d satteri
```

Then enable Markdown and MDX route discovery:

```ts
// vite.config.ts
import { fileRouter } from 'solid-file-router/plugin'
import { defineConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'

export default defineConfig({
  plugins: [solidPlugin(), fileRouter({ mdx: true })],
})
```

With the default `pagesDir`, `src/pages/about.md` becomes `/about` and
`src/pages/docs/[slug].mdx` becomes `/docs/:slug`. JSX/TSX and MDX discovery
run together, so route IDs and logical paths must remain unique across them.

Enabling MDX also lets application code import `.md` and `.mdx` documents directly. Add
`solid-file-router/client` to the consumer's TypeScript types (as required for
`virtual:routes`) to type the default Solid component and its `frontmatter`
export:

```tsx
import Article, { frontmatter } from './article.mdx'

const title = frontmatter.title

export const Preview = () => <Article components={{ h1: (props) => <h2 {...props} /> }} />
```

## Authoring MDX

MDX files can import components and contain Solid JSX:

```mdx
import { A } from '@solidjs/router'
import { createSignal } from 'solid-js'

export function Counter() {
  const [count, setCount] = createSignal(0)
  return <button onClick={() => setCount(count() + 1)}>Count: {count()}</button>
}

# Getting started

<Counter />

<A href="/">Home</A>
```

The router compiles the document to a Solid component and wraps it in a route.
Export the reserved `route` object to configure supported route behavior:
For a dynamic page such as `src/pages/guide/[slug].mdx`, filters are keyed by
the route parameter name:

```mdx
export const route = {
  info: { title: 'Getting started' },
  preload: () => loadGuide(),
  matchFilters: { slug: /^[a-z0-9-]+$/ },
  inherit: true,
  loadingComponent: () => <p>Loading guide...</p>,
  errorComponent: (props) => <p>{props.error.message}</p>,
}

# Getting started
```

The supported fields are `info`, `preload`, `matchFilters`, `inherit`,
`loadingComponent`, and `errorComponent`. The `component` field is ignored so
the compiled MDX document remains the route component. Route configuration is
executable MDX ESM; it is not read from YAML or TOML frontmatter.

MDX files are leaf routes. `_app.md(x)` and `_layout.md(x)` are rejected during
route discovery; use `_app.tsx` or `_layout.tsx` when descendant routes need a
layout. `404.md(x)` remains a normal leaf fallback. JSX/TSX and MDX routes are
additive, and duplicate normalized routes across them remain errors.

## Component Overrides

Import the runtime from `solid-file-router/mdx`. Wrap a layout or `_app.tsx`
with `MDXProvider` to override elements for every descendant document:

```tsx
// src/pages/_app.tsx
import { createRoute } from 'solid-file-router'
import { MDXProvider } from 'solid-file-router/mdx'
import type { MDXComponents } from 'solid-file-router/mdx'

const components: MDXComponents = {
  h1: (props) => <h1 class="page-title" {...props} />,
  a: (props) => <a class="content-link" {...props} />,
  Callout: (props: { tone: 'info' | 'warning' }) => (
    <aside data-tone={props.tone}>{props.tone}</aside>
  ),
}

export default createRoute({
  component: (props) => <MDXProvider components={components}>{props.children}</MDXProvider>,
})
```

Nested providers merge with their parent. Locally supplied values take
precedence. `useMDXComponents(localComponents)` exposes the same merged map for
custom integrations. `MDXComponents` gives intrinsic overrides their Solid HTML
or SVG props and keeps authored component names open. This is compile-time
assistance; runtime code does not validate component props. The package also
exports the `MDXComponent` type for explicitly typed custom components.

## Configuration

Pass Satteri compile options directly through `mdx`. `pagesDir` is inherited
from the plugin unless explicitly overridden, and `filter` is relative to the
Vite root:

```ts
fileRouter({
  pagesDir: 'app/routes',
  mdx: {
    filter: 'content/**/*.{md,mdx}',
    development: true,
  },
})
```

The default filter is `<pagesDir>/**/*.{md,mdx}`. The router enforces Satteri's
`outputFormat: 'program'` because each compiled document must be a route
module. Router defaults set Solid-compatible JSX output, provider imports,
attribute casing, style casing, and the source file URL; explicit supported
Satteri options can override those defaults.

## Combining Route Inputs

File routing is built in and scans JSX/TSX files below `pagesDir`. Set `mdx: true`
or pass MDX options to add Markdown and MDX route discovery. Use `routeProviders`
to add a CMS, generated route, or other provider.

All route inputs share the same route tree. Normalized route IDs, logical paths,
and source paths must be unique across built-in, MDX, and configured inputs, so a
provider cannot define a route with an existing route ID or replace an existing
route by ordering. Use `defineRouteProvider` for providers; file
and MDX discovery are configured through `fileRouter`.

## HMR and Errors

Document edits use Vite's normal module invalidation. Creating, deleting, or
renaming a route changes topology and triggers the required full reload.
`reloadOnChange: true` is an escape hatch for generated modules that depend on
external state Vite cannot track; ordinary MDX routes should leave it off.

If Satteri is not installed, route loading reports the install command. Compile
errors retain the source file URL. Duplicate route IDs/paths and empty provider
output fail with descriptive errors.

See [Route Providers](guide.md#route-providers) to generate richer
route modules and the [reference](reference.md) for exact public types.
