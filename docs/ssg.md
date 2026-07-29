# Static Site Generation (SSG)

`solid-file-router` can prerender routes to HTML during `vite build`. This is a
static build pipeline, not a runtime SSR server.

## Setup

Enable Solid's SSR transform, enable the router's `ssg` option, and mount the
client with `createClientEntry`:

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

```tsx
// src/index.tsx
import { createClientEntry } from 'solid-file-router'
import { FileRouter } from 'virtual:routes'

createClientEntry(() => <FileRouter />, document.getElementById('root')!)
```

Development uses Solid's normal `render`. A production page hydrates when
Solid's hydration state is present and otherwise renders normally.

## Selecting Routes

`ssg.routes` accepts a static list or a synchronous/asynchronous producer:

```ts
fileRouter({
  ssg: {
    routes: async () => ['/', ...(await loadArticlePaths())],
  },
})
```

When `routes` is omitted, the plugin derives every concrete static route from
the route tree. Dynamic patterns and `/404` are not included automatically;
provide concrete dynamic URLs such as `/posts/hello` yourself. Routes are
normalized and deduplicated. Unsafe `.` and `..` path segments are rejected.

## Output

Vite produces browser assets and pages under `<outDir>/client` and a
server bundle under `<outDir>/server`. With Vite's default `outDir`, examples
include:

| Route         | Output                        |
| ------------- | ----------------------------- |
| `/`           | `dist/client/index.html`      |
| `/about`      | `dist/client/about.html`      |
| `/docs/start` | `dist/client/docs/start.html` |
| `/404`        | `dist/client/404.html`        |

`404.html` is always rendered for static-host fallback, independently of the
normal route list. Set `concurrency` to limit simultaneous renders; it defaults
to `4` and values below `1` are clamped to `1`.

## HTML Template

A standard Vite template is enough:

```html
<head></head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/index.tsx"></script>
</body>
```

The plugin replaces the contents of the element identified by `ssg.id`
(`root` by default) and inserts Solid's hydration bootstrap before `</head>`.
For explicit placement, use the markers instead:

```html
<head>
  <!--solid-file-router-head-->
</head>
<body>
  <!--solid-file-router-outlet-->
  <script type="module" src="/src/index.tsx"></script>
</body>
```

Use exactly one outlet strategy. The outlet marker creates the configured root
element, so do not also include an element with the same ID. Duplicate outlet
markers, a missing outlet/root, or a missing head insertion point fail the
build.

## Custom Server Entry

The built-in renderer is sufficient for normal `FileRouter` applications. Use
`serverEntry` when the server render needs application-specific providers or
composition:

```tsx
// src/entry-server.tsx
import { createServerEntry } from 'solid-file-router'
import { FileRouter } from 'virtual:routes'

export default createServerEntry((props) => <FileRouter {...props} />)
```

```ts
fileRouter({
  ssg: { serverEntry: 'src/entry-server.tsx' },
})
```

`createServerEntry` requires a component and can run only in an SSR build. The
component receives the requested `url` and Vite's `BASE_URL` as `base`.

## Troubleshooting

- Confirm `solidPlugin({ ssr: true })` is configured when the plugin reports
  that SSG requires the Solid SSR transform.
- Configure concrete values in `routes` for parameterized pages.
- Ensure a custom server entry default-exports the promise returned by
  `createServerEntry`.
- Check the template for one root/outlet and a head marker or closing `head`
  tag.

See the [reference](reference.md#ssg-config) for the complete option types.
