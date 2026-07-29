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

The router compiles the document to a Solid component and wraps it in
`createRoute({ component: MDXContent })`. Route configuration such as `info`,
`preload`, or custom boundaries is therefore not extracted from the document;
use JSX/TSX routes or a custom route provider when those fields are required.

## Component Overrides

Import the runtime from `solid-file-router/mdx`. Wrap a layout or `_app.tsx`
with `MDXProvider` to override elements for every descendant document:

```tsx
// src/pages/_app.tsx
import { createRoute } from 'solid-file-router'
import { MDXProvider } from 'solid-file-router/mdx'

const components = {
  h1: (props) => <h1 class="page-title" {...props} />,
  a: (props) => <a class="content-link" {...props} />,
}

export default createRoute({
  component: (props) => (
    <MDXProvider components={components}>{props.children}</MDXProvider>
  ),
})
```

Nested providers merge with their parent. Locally supplied values take
precedence. `useMDXComponents(localComponents)` exposes the same merged map for
custom integrations. The package also exports the `MDXComponent` and
`MDXComponents` types.

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
or pass MDX options to add Markdown and MDX route discovery. Use `routeSource`
to add a CMS, generated route, or other custom provider; the option also accepts
an array of providers.

All route inputs share the same route tree. Normalized route IDs, logical paths,
and source paths must be unique across built-in, MDX, and custom inputs, so a
custom provider cannot define a route with an existing route ID or replace an
existing route by ordering. Use `defineRouteSource` for custom providers; file
and MDX discovery are configured through `fileRouter`.

## HMR and Errors

Document edits use Vite's normal module invalidation. Creating, deleting, or
renaming a route changes topology and triggers the required full reload.
`reloadOnChange: true` is an escape hatch for generated modules that depend on
external state Vite cannot track; ordinary MDX routes should leave it off.

If Satteri is not installed, route loading reports the install command. Compile
errors retain the source file URL. Duplicate route IDs/paths and empty custom
source output fail with descriptive errors.

See [Custom Route Providers](guide.md#custom-route-providers) to generate richer
route modules and the [reference](reference.md) for exact public types.
