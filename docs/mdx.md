# Markdown and MDX Routes

Built-in Markdown/MDX routing compiles `.md` and `.mdx` files with
[Satteri](https://satteri.bruits.org/) and applies the same file conventions as
JSX/TSX routes.

## Install and Enable

Satteri and YAML frontmatter support are optional peer dependencies. Install
them together when using MDX with frontmatter:

```bash
bun add -d satteri yaml
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

# Example

<Counter />

<A href="/">Home</A>
```

The router compiles the document to a Solid component and wraps it in a route.

## Frontmatter

Use YAML frontmatter to configure supported route behavior. For a dynamic page
such as `src/pages/guide/[slug].mdx`, filters are keyed by the route parameter
name:

```mdx
---
info:
  title: Getting started
metadata:
  title: Getting started | Docs
  description: Learn how to get started.
  canonical: https://example.com/guide
matchFilters:
  slug: '/^[a-z0-9-]+$/'
inherit: true
---

# Example
```

The supported route fields are `info`, `metadata`, `matchFilters`, `inherit`, and `draft`.
Other YAML fields remain available through the generated `frontmatter` export
but are not passed to the router. `matchFilters` strings are compiled as regular
expressions; `/pattern/flags` also supports flags. The legacy `export const route`
configuration is ignored.

`metadata` uses the serializable `RouteMetadata` shape from the router. It is
used by SSG to generate the page head and can also be passed through an
`extendLoad` wrapper to client-side page components.

`frontmatter` is also available when importing a Markdown or MDX document:

```tsx
import Article, { frontmatter } from './article.mdx'

const title = frontmatter.title
```

## Draft Routes

Set `draft: true` for a development-only route:

```mdx
---
draft: true
---
```

It is available during development, but excluded from production route matching
and SSG output. A draft `_app` or `_layout` also excludes its entire descendant
subtree.

## Route Constraints

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

### Satteri options

The `mdx` option accepts Satteri's `MdxCompileOptions`; all Satteri options are
passed through to the compiler. `outputFormat` is controlled by the router and
must remain `'program'`.

### `solid-file-router` options

The following properties are specific to `solid-file-router`:

| Property   | Behavior                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pagesDir` | Route directory used to derive the default MDX filter. It inherits the plugin-level `pagesDir` unless overridden; relative and absolute paths are supported. |
| `filter`   | MDX discovery glob. Defaults to `<pagesDir>/**/*.{md,mdx}` and is normalized for the configured pages directory.                                             |

Configure these properties alongside Satteri options:

```ts
fileRouter({
  pagesDir: 'app/routes',
  mdx: {
    filter: 'content/**/*.{md,mdx}',
    development: true,
  },
})
```

### Extending generated route modules

Use `transformPath` when a project needs to map MDX source files into a custom
route tree. It receives the source path relative to the Vite root and the
default entry, so the normal MDX extension replacement can be preserved with a
spread:

```ts
fileRouter({
  mdx: {
    transformPath: (sourcePath, entry) => ({
      ...entry,
      path: `docs/${sourcePath.replace(/^content\//, '').replace(/\.mdx$/, '.tsx')}`,
    }),
  },
})
```

The built-in MDX provider normalizes Windows separators and discovers absolute
source paths. `transformPath` receives the source path relative to the Vite root,
while `load` receives the normalized absolute `sourcePath`.

Use `extendLoad` to attach provider data or wrap the compiled content without
reimplementing frontmatter parsing or Satteri compilation. The callback
receives the immutable compiled document and the route-provider load context:

```ts
fileRouter({
  mdx: {
    extendLoad(document, context) {
      return {
        routeConfig: { info: { source: context.sourcePath } },
        mdxContent: `
          <components.Article {...props}>
            <MDXContent {...props} />
          </components.Article>
        `,
      }
    },
  },
})
```

`mdxContent` is a JSX expression, not a second compilation entry. Its generated
wrapper exposes `props`, `components`, and `MDXContent`; `components` is loaded
from `useMDXComponents()`, so an ancestor `MDXProvider` can supply `Article`
and any other custom component. This keeps document-local MDX imports separate
from application-wide component configuration.

The router supplies Solid-compatible defaults for JSX output, provider imports,
attribute casing, style casing, and the source file URL. Explicit Satteri
options can override those defaults, except for the required `outputFormat`.

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
