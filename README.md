# solid-file-router

Type-safe file-based routing for Solid and Vite.

`solid-file-router` scans route modules, generates `@solidjs/router` route
definitions, exposes a ready-to-render `<FileRouter />`, and writes route path
types for navigation. It also supports nested layouts, loading and error
inheritance, route metadata, custom route sources, and build-time SSG (Static Site Generation).

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
- Custom route providers for MDX, CMS, or generated modules
- Build-time static HTML generation

## Install

Install the router and the Solid/Vite dependencies:

```bash
bun add solid-file-router @solidjs/router solid-js
bun add -d vite vite-plugin-solid
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

| Document                       | Use it for                                                            |
| ------------------------------ | --------------------------------------------------------------------- |
| [Guide](docs/guide.md)         | Installation, routing workflows, layouts, SSG, and custom sources     |
| [Reference](docs/reference.md) | File conventions, plugin options, generated modules, and runtime APIs |
| [Agent Guide](docs/agents.md)  | Integration recipes, repository map, invariants, and verification     |

Common tasks:

| Task                              | Start here                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------- |
| Add or rename a route             | [File conventions](docs/guide.md#file-conventions)                           |
| Load route data                   | [Data preloading](docs/guide.md#data-preloading)                             |
| Add loading or error UI           | [Loading and error inheritance](docs/guide.md#loading-and-error-inheritance) |
| Generate static HTML              | [SSG](docs/guide.md#ssg)                                                     |
| Generate routes from MDX or a CMS | [Custom route sources](docs/guide.md#custom-route-sources)                   |
| Look up an option or API          | [Reference](docs/reference.md)                                               |

## SSG

SSG renders static HTML during `vite build`; it does not provide a runtime SSR
server. Enable Solid's SSR transform and pass an `ssg` object to the router:

```ts
// vite.config.ts
import { fileRouter } from 'solid-file-router/plugin'
import { defineConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'

export default defineConfig({
  plugins: [
    solidPlugin({ ssr: true }),
    fileRouter({
      ssg: {
        routes: ['/', '/about'],
        concurrency: 4,
      },
    }),
  ],
})
```

Use `createClientEntry` so production builds hydrate prerendered HTML:

```tsx
// src/index.tsx
import { createClientEntry } from 'solid-file-router'
import { FileRouter } from 'virtual:routes'

createClientEntry(() => <FileRouter />, document.getElementById('root')!)
```

When `routes` is omitted, the internal renderer prerenders every concrete static
route and skips dynamic patterns. The build writes browser assets and HTML to
`dist/client` by default and always emits `404.html` for static-host fallback.
Your `index.html` only needs a normal `<head>` and `<div id="root"></div>`;
explicit outlet and head markers are available for custom templates.

See the [SSG guide](docs/guide.md#ssg) for custom server entries, HTML markers,
route output rules, and failure cases.

## Custom Route Sources

Use `routeSource` when route modules come from outside `src/pages`. Providing a
custom source disables built-in directory scanning. See the
[custom route source guide](docs/guide.md#custom-route-sources).

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
