# MDX Guide

Built-in Markdown/MDX routes compiled with Satteri on the Solid 2 stack.

## Setup

Install the optional peers and enable the plugin:

```bash
pnpm add -D satteri yaml
```

```ts
// vite.config.ts
import solid from '@solidjs/vite-plugin'
import { fileRouter } from 'solid-file-router/plugin'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    solid({ extensions: ['.jsx', '.tsx', '.mdx'] }),
    fileRouter({ mdx: true }),
  ],
})
```

`.md` and `.mdx` files inside `pagesDir` become routes through the same
`defaultConvention` filename rules (`post.mdx` → `/post`, `blog/[id].mdx` →
`/blog/:id`).

## Module shape

Compiled modules export `route`, `frontmatter`, and a default component:

```ts
export const route = { draft: true }
export const frontmatter = { title: 'Test Post' }
export default MDXContent
```

Route config comes from **top-level frontmatter keys** (not a nested `route:`
block):

```yaml
---
title: Guide
draft: true
metadata:
  title: Guide | Docs
matchFilters:
  lang: /en|zh/
---
```

Supported frontmatter route keys: `info`, `matchFilters` (regex literals
`/x/` or string arrays), `inherit`, `draft`, `metadata`.

`frontmatter` is also exported for direct imports:

```ts
import Post, { frontmatter, route } from './post.mdx'
```

## Code splitting

`$$route` points at a virtual module (`virtual:sfr-mdx-route:<src>`) that
re-compiles only `route`/`frontmatter`. The manifest never eagerly bundles the
compiled MDX component — it stays in its own lazy chunk.

## Component overrides

`MDXProvider` supplies runtime component overrides; `useMDXComponents` merges
local overrides:

```tsx
import { MDXProvider } from 'solid-file-router/mdx'

export default definePage((props) => (
  <MDXProvider components={{ h1: CustomH1 }}>
    {props.children}
  </MDXProvider>
))
```

Every MDX element — intrinsic or component — renders through `Dynamic`, which
is the only path that works on both client and SSR.

## `extendLoad`

`extendLoad(document, context)` extends the generated module without taking
over compilation:

```ts
fileRouter({
  mdx: {
    extendLoad: ({ frontmatter }) => ({
      routeConfig: { metadata: { title: frontmatter.title } },
      // or JSX for the rendered body (props, components, MDXContent in scope)
      mdxContent: '<MDXContent components={components} />',
    }),
  },
})
```

`mdxContent` is a JSX expression evaluated by the generated route component;
`routeConfig` shallow-overrides the frontmatter-derived config.

**Removed options**: `filter`, `pagesDir`, `transformPath` — use plugin-level
`ignore`, `pagesDir`, and `toPath` instead. `mdxRouteProvider` is gone; MDX is
a first-class extension of the convention router.

## SSR note

Satteri compiles with `jsx: false` and
`jsxImportSource`/`providerImportSource` = `solid-file-router/mdx` — intrinsic
expressions like `<_components.h1>` become runtime calls. Plain JSX output
breaks Solid 2 SSR, which calls component expressions directly.
