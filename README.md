# solid-file-router

Type safe file router for solid.js

Generate type safe route definition and virtual module that return `@solidjs/router`'s `RouteDefinition` and `<FileRouter />`

**ESM Only**

## Features

- 📁 **File-based routing** - Automatically generates routes from your `src/pages/**` directory structure
- 🔒 **Type-safe** - Full TypeScript support with generated type definitions for routes and path parameters
- ⚡ **Vite integration** - Works seamlessly with Vite as a plugin
- 🎯 **Flexible layouts** - Support for `_layout.tsx` files to define nested layouts
- 🛡️ **Error boundaries** - Built-in error handling with custom error components
- 📦 **Loading states** - Optional loading components while data is being fetched

## Getting Started

### Installation

```bash
npm install solid-file-router
# or
yarn add solid-file-router
# or
bun add solid-file-router
```

### Setup

1. **Add the Vite plugin** to your `vite.config.ts`:

```typescript
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import { fileRouter } from 'solid-file-router/plugin'

export default defineConfig({
  plugins: [solid(), fileRouter()],
})
```

2. **Create your pages directory** at `src/pages/`

3. **Create the app root** (`src/pages/_app.tsx`):
   *This serves as the root layout for your application.*

```tsx
import { createRoute } from 'solid-file-router'

export default createRoute({
  component: (props) => {
    return <div id="app-root">{props.children}</div>
  },
})
```

4. **Create your entry point** (e.g., `src/index.tsx`):

```tsx
import { render } from 'solid-js/web'
import { FileRouter } from 'virtual:routes'

render(() => <FileRouter base="/optional/base" />, document.getElementById('app')!)
```

## Project Structure

Understanding the file structure is key to using the router effectively.

```text
src/
  pages/
    _app.tsx              # App root (Required)
    index.tsx             # Matches: /
    about.tsx             # Matches: /about
    404.tsx               # Catch-all for unmatched routes

    # Nested Routes & Layouts
    blog/
      _layout.tsx         # Wraps all routes inside /blog/
      index.tsx           # Matches: /blog
      [id].tsx            # Matches: /blog/:id

    # Dynamic & Optional Params
    -[lang]/
      index.tsx           # Matches: /:lang?

    # Pathless Layouts (Logical grouping without URL change)
    (auth)/
      login.tsx           # Matches: /login
      register.tsx        # Matches: /register

    # Nested URLs without nested layouts
    path.to.some.url.tsx  # Matches: /path/to/some/url

  index.tsx               # Entry point
  routes.d.ts             # Auto-generated type definitions
```

## API Reference & Examples

### `createRoute(config)`

The core function to define route behavior. **Must** be the default export in every page file.

**Parameters:**
- `component` (Required): Component to render.
- `preload` (Optional): Async function to fetch data before rendering (`@solidjs/router` mechanism).
- `loadingComponent` (Optional): Component shown while `preload` is pending.
- `errorComponent` (Optional): Error Boundary component shown if rendering or preloading fails.
- `info` (Optional): Arbitrary metadata.
- `matchFilters` (Optional): Custom logic to validate route matching.

#### Example 1: Basic Page with Dynamic Params

*File: `src/pages/blog/[id].tsx`*

```tsx
import { createRoute } from 'solid-file-router'
import { useParams } from '@solidjs/router'

export default createRoute({
  // Validate matches or extract custom data
  matchFilters: {
    id: (v) => /^\d+$/.test(v) // Only match if ID is numeric
  },
  component: (props) => {
    // Typesafe params if using the generated hooks/types
    const params = useParams<{ id: string }>()
    return <div>Viewing Post ID: {params.id}</div>
  },
})
```

#### Example 2: Data Loading, Loading States & Error Handling

*File: `src/pages/dashboard.tsx`*

```tsx
import { createRoute } from 'solid-file-router'

export default createRoute({
  // Fetch data before the component renders
  preload: async ({ params, location }) => {
    const res = await fetch(`/api/stats`)
    if (!res.ok) throw new Error("Failed to load stats")
    return res.json()
  },

  // Show this while preload is awaiting
  loadingComponent: () => <div class="spinner">Loading Dashboard...</div>,

  // Show this if preload throws or component errors
  errorComponent: (props) => (
    <div class="error-alert">
      <p>Error: {props.error.message}</p>
      <button onClick={props.reset}>Retry</button>
    </div>
  ),

  // Main component receives data from preload via props.data
  component: (props) => (
    <main>
      <h1>Dashboard</h1>
      <pre>{JSON.stringify(props.data, null, 2)}</pre>
    </main>
  ),
})
```

#### Example 3: Nested Layouts

*File: `src/pages/settings/_layout.tsx`*

```tsx
import { createRoute } from 'solid-file-router'
import { A } from '@solidjs/router'

export default createRoute({
  component: (props) => (
    <div class="settings-layout">
      <nav>
        <A href="/settings/profile">Profile</A>
        <A href="/settings/account">Account</A>
      </nav>
      <div class="content">
        {/* Renders the nested child route */}
        {props.children}
      </div>
    </div>
  ),
})
```

---

### `generatePath(path, params)`

A utility to construct URLs with type validation. It ensures you don't pass incorrect parameters to your routes.

**Parameters:**
- `path`: The route pattern (e.g., `/blog/:id`).
- `params`: Object containing:
    - **Path parameters**: Prefixed with `$` (e.g., `$id`, `$lang`).
    - **Query parameters**: Standard keys (e.g., `search`, `page`).

#### Example: Type-Safe Navigation

```tsx
import { generatePath } from 'solid-file-router'
import { useNavigate } from '@solidjs/router'

export function NavigationButton() {
  const navigate = useNavigate()

  const goToPost = (postId: string) => {
    // ✅ Type Safe: TS will error if $id is missing
    const url = generatePath('/blog/:id', {
      $id: postId,      // Path param
      ref: 'newsletter' // Query param -> /blog/123?ref=newsletter
    })

    navigate(url)
  }

  return <button onClick={() => goToPost('123')}>Read Post</button>
}
```

---

### `virtual:routes`

The virtual module that exposes the generated routing configuration.

**Exports:**
- `FileRouter`: High-level component to render the app (Easy to use).
- `fileRoutes`: The raw `RouteDefinition` array for `@solidjs/router`.
- `Root`: The component exported from `_app.tsx`.

#### Example1: Custom Base URL

```tsx
import { render } from 'solid-js/web'
import { Router } from '@solidjs/router'
import { FileRouter } from 'virtual:routes'

render(() => <FileRouter base="/app" />, document.getElementById('app')!)
```

#### Example2: Custom Router Integration

If you need more control than `<FileRouter>` provides (e.g., preload or use `<HashRouter />`), you can use the raw exports:

```tsx
import { render } from 'solid-js/web'
import { Router } from '@solidjs/router'
import { fileRoutes, Root } from 'virtual:routes'

render(() => (
  <Router
    root={<Root />} // Transformed `src/pages/_app.tsx`
    preload={true}
    {/* Other props */}
  >
    {fileRoutes}
  </Router>
), document.getElementById('app')!)
```

#### Type Definition

In `tsconfig.json`

```json
{
  "compilerOptions": {
    "types": [
      "solid-file-router/client"
    ]
  }
}
```

## Configuration

Options passed to the `fileRouter()` plugin in `vite.config.ts`.

```ts
interface FileRouterPluginOption {
  /**
   * The output file path where the page types will be saved.
   * @default 'src/routes.d.ts'
   */
  output?: string
  /**
   * The base directory of `src/pages`.
   *
   * e.g. If your `_app.tsx` is located at `packages/app/module/src/pages/_app.tsx`,
   * You need to setup to `packages/app/module/`
   * @default ''
   */
  baseDir?: string
  /**
   * A list of glob patterns to be ignored during processing.
   *
   * Default is {@link DEFAULT_IGNORES}: all files in `components/`, `node_modules/` and `dist/`
   */
  ignore?: string[]
  /**
   * Whether to reload the page when route files change.
   * @default true
   */
  reloadOnChange?: boolean
  /**
   * Route's dts config to control Route's info type
   * @example
   * ```ts
   * {
   *   title: 'string',
   *   description: 'string',
   *   auth: {
   *     required: 'boolean',
   *     code: 'string',
   *   },
   *   tags: 'string[]',
   * }
   * ```
   */
  infoDts?: InfoTypeDefinition
}
```

## Credit

Highly inspired by [`generouted`](https://github.com/oedotme/generouted). Created to provide better customization for SolidJS specific features like lazy loading route components while keeping route metadata eager.

## License

MIT