# solid-file-router

Type-safe file-based routing for Solid and Vite.

`solid-file-router` scans route modules, generates `@solidjs/router` route
definitions, exposes a ready-to-render `<FileRouter />`, and writes route path
types for navigation. It also supports nested layouts, loading and error
inheritance, route metadata, route providers, and build-time SSG (Static Site Generation).

> [!WARNING]
> This project is under active development and is still pre-1.0. Minor releases
> may contain breaking changes. Review the release notes before upgrading.
>
> This package is ESM only.

## Features

- File routes from `src/pages/**/*.{jsx,tsx}`
- Generated path, parameter, and metadata types
- `_app.tsx`, nested `_layout.tsx`, and `404.tsx` conventions
- Route `preload`, `matchFilters`, metadata, and lazy components
- Inherited loading and error components
- Built-in Markdown/MDX routes compiled with Satteri
- Extensible MDX route loading with `transformPath` and `extendLoad`
- Composable route providers for CMS or generated modules
- Build-time static HTML generation

## Install

Install the router and the Solid/Vite dependencies:

```bash
bun add solid-file-router @solidjs/router solid-js
bun add -d vite vite-plugin-solid
# Optional: required for Markdown/MDX routes and YAML frontmatter
bun add -d satteri yaml
```

`@babel/core` and `tinyglobby` are already provided through
`vite-plugin-solid` and Vite, so applications do not need to install them
directly.

This package does not configure `vite-plugin-solid`; keep that plugin in your
application's Vite config.

## Quick Start

Configure Vite:

```ts
// vite.config.ts
import { fileRouter } from 'solid-file-router/plugin'
import { defineConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'

export default defineConfig({
  plugins: [solidPlugin(), fileRouter()],
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

render(() => <FileRouter />, document.getElementById('root')!)
```

An `_app.tsx` root layout is recommended but optional. Without one, the plugin
generates a pass-through root component.

## Documentation

| Document                       | Use it for                                                              |
| ------------------------------ | ----------------------------------------------------------------------- |
| [Guide](docs/guide.md)         | Routes, layouts, data, navigation, metadata, and route providers        |
| [SSG Guide](docs/ssg.md)       | Prerender setup, route selection, output, templates, and server entries |
| [MDX Guide](docs/mdx.md)       | Satteri setup, Markdown routes, component overrides, and HMR            |
| [Reference](docs/reference.md) | Exact plugin options, generated modules, types, and runtime APIs        |
| [Agent Guide](docs/agents.md)  | Repository map, invariants, and verification workflows                  |

Enable the latest opt-in features with `fileRouter({ ssg: {} })` or
`fileRouter({ mdx: true })`. SSG requires `solidPlugin({ ssr: true })`; MDX
requires the optional `satteri` peer dependency. Pass an MDX options object to
map source paths or wrap generated content with `extendLoad`; its
`mdxContent` expression can use the active `useMDXComponents()` map. Follow the
dedicated guides for complete, copyable setup.

`routeProviders` are additive: the built-in filesystem provider runs first,
optional MDX runs next, and the configured providers follow. Markdown/MDX
frontmatter is optional, but using it requires the optional `yaml` peer
dependency. See the [route provider guide](docs/guide.md#route-providers) and
[MDX guide](docs/mdx.md) for details.

## Development

This repository uses Bun:

```bash
bun run build
bun run test
bun run lint
bun run typecheck
```

Run the playground with `bun run play`. Repository-specific instructions are in
[AGENTS.md](AGENTS.md).

## License

MIT

## Credit

Inspired by [`generouted`](https://github.com/oedotme/generouted).
