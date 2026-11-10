# solid-file-router

Type-safe file-based routing for Solid and Vite.

`solid-file-router` is a thin preset over the official Solid 2 stack —
`filesystem-routing` scans route modules, `@solidjs/router` handles matching,
and `createFileRouter()` adapts the generated route tree with inherited
loading/error boundaries, `useHead` metadata, and draft routes. It also
supports nested layouts and build-time SSG (Static Site
Generation).

> [!WARNING]
> This package targets the **prerelease** Solid 2 stack (`solid-js@2.0.0-rc`,
> `@solidjs/router@next`). Pin upstream versions and review release notes before
> upgrading.
>
> This package is ESM only.

## Features

- File routes from `src/pages/**/*.{jsx,tsx,md,mdx}`
- Generated path, parameter, and metadata types (`src/routes.d.ts`)
- `_app.tsx`, pathless `_layout.tsx`, and `404.tsx` conventions
- Route `preload`, `matchFilters`, metadata, and lazy components
- Inherited loading and error components (`Loading`/`Errored`)
- `defineRoute`/`definePage` helpers for fully typed route modules
- Single filename convention; custom scanning via the `router` escape hatch
- Built-in Markdown/MDX routes compiled with Satteri
- Build-time static HTML generation through the start handler

## Install

Install the router and the Solid/Vite dependencies:

```bash
pnpm add solid-file-router @solidjs/router @solidjs/web solid-js
pnpm add -d vite @solidjs/vite-plugin
# Optional: required for Markdown/MDX routes and YAML frontmatter
pnpm add -D satteri yaml
```

Route scanning, code splitting, and type generation come from the official
`filesystem-routing` + `@solidjs/vite-plugin` stack — no extra transforms to
install. This package does not configure `@solidjs/vite-plugin`; keep that
plugin in your application's Vite config.

## Quick Start

Configure Vite:

```ts
import solid from '@solidjs/vite-plugin'
// vite.config.ts
import { fileRouter } from 'solid-file-router/plugin'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [solid(), fileRouter()],
})
```

Load the generated virtual-module types:

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "types": ["solid-file-router/client"],
  },
}
```

Create a page:

```tsx
// src/pages/index.tsx
import { definePage, defineRoute } from 'solid-file-router'

export const route = defineRoute({
  info: { title: 'Home' },
})

export default definePage(() => <h1>Hello</h1>)
```

Render the generated router:

```tsx
// src/index.tsx
import { render } from '@solidjs/web'
import { createFileRouter } from 'solid-file-router'

const Router = createFileRouter()

render(() => <Router>{(props) => <>{props.children}</>}</Router>, document.getElementById('root')!)
```

An `_app.tsx` root layout is recommended but optional. Without one, the plugin
generates a pass-through root component.

## Documentation

| Document                       | Use it for                                                              |
| ------------------------------ | ----------------------------------------------------------------------- |
| [Guide](docs/guide.md)         | Routes, layouts, data, navigation, and metadata                         |
| [SSG Guide](docs/ssg.md)       | Prerender setup, route selection, output, templates, and server entries |
| [MDX Guide](docs/mdx.md)       | Satteri setup, Markdown routes, component overrides, and HMR            |
| [Reference](docs/reference.md) | Exact plugin options, generated modules, types, and runtime APIs        |
| [Agent Guide](docs/agents.md)  | Repository map, invariants, and verification workflows                  |

Enable the latest opt-in features with `fileRouter({ ssg: true })` or
`fileRouter({ mdx: true })`. SSG requires `solid({ start: true, ssr: true })`; MDX
requires the optional `satteri` peer dependency. Pass an MDX options object to
map source paths or wrap generated content with `extendLoad`; its
`mdxContent` expression can use the active `useMDXComponents()` map. Follow the
dedicated guides for complete, copyable setup.

Markdown/MDX frontmatter is optional, but using it requires the optional
`yaml` peer dependency. See the [MDX guide](docs/mdx.md) for details.

## Development

This repository uses pnpm:

```bash
pnpm build
pnpm test
pnpm lint
pnpm typecheck
```

Run the playground with `pnpm play`. Repository-specific instructions are in
[AGENTS.md](AGENTS.md).

## License

MIT

## Credit

Inspired by [`generouted`](https://github.com/oedotme/generouted).
