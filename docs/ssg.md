# SSG Guide

Build-time prerendering through the Solid start request handler.

## Setup

Enable start SSR mode and add `ssg` to `fileRouter`:

```ts
// vite.ssg.config.ts
import solid from '@solidjs/vite-plugin'
import { fileRouter } from 'solid-file-router/plugin'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    solid({ start: true, ssr: true, extensions: ['.jsx', '.tsx', '.mdx'] }),
    fileRouter({ ssg: true }),
  ],
})
```

Start mode requires an app root — `src/App.tsx` (or `start.app`):

```tsx
// src/App.tsx
import { createFileRouter } from 'solid-file-router'

const Router = createFileRouter()

export default function App() {
  return <Router>{(props) => <>{props.children}</>}</Router>
}
```

`ssg: true` enables all defaults; pass `SsgOptions` to override. Build with
`vite build --config vite.ssg.config.ts`. The plugin collects all
static manifest routes, calls the built `dist/server/server.js`'s
`handleRequest`, and writes one HTML file per route.

## Output mapping

| Route | File |
|---|---|
| `/` | `index.html` |
| `/about` | `about.html` |
| `/docs/` | `docs/index.html` |
| (unmatched) | `404.html` — always emitted |

Dynamic (`:param`) and splat (`*x`) routes are skipped automatically; emit them
explicitly through `routes`.

## Options

```ts
fileRouter({
  ssg: {
    // all static routes by default; array or (routes) => routes
    routes: ['/', '/about'],
    concurrency: 4,           // default 4
    outDir: 'dist/client',    // default
    serverEntry: 'custom/entry.tsx', // Request→Response handler, non-start setups
  },
})
```

`serverEntry` is the escape hatch for non-start builds — export a
`(request: Request) => Promise<Response | string>` handler.

## Head and metadata

`route.metadata` becomes `useHead` calls — prerendered HTML already contains
`<title>`, canonical links, and meta tags — head content is owned by `useHead`.

## Preview fallback

`vite preview` serves prerendered pages and returns `404.html` with status 404
for misses — including dynamic routes that were never prerendered. The
middleware registers before Vite's internal fallbacks so a SSG preview behaves
like a static host.
