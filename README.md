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
- 🧱 **SSG prerendering** - Optional static generation with Vite Environment API support

## Getting Started

### Installation

```bash
npm install solid-file-router vite-plugin-solid
# or
yarn add solid-file-router vite-plugin-solid
# or
bun add solid-file-router vite-plugin-solid
```

### Setup

1. **Add the Vite plugin** to your `vite.config.ts`:

```typescript
import { defineConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'
import { fileRouter } from 'solid-file-router/plugin'

export default defineConfig({
  plugins: [solidPlugin(), fileRouter()],
})
```

`vite-plugin-solid` is no longer bundled internally, so add it to your Vite config explicitly.

2. **Create your pages directory** at `src/pages/`

3. **Create the app root** (`src/pages/_app.tsx`):
   _This serves as the root layout for your application._

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
      [user]/
        index.tsx         # Matches: /:lang/:user
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

**Component Inheritance:**

When `loadingComponent` and `errorComponent` are defined in `_app.tsx` or `_layout.tsx` files, they automatically become defaults for all descendant routes. This follows a three-tier fallback chain:

1. **Route-specific** - Component defined in the route's own `createRoute()`
2. **Nearest layout** - Component from the closest `_layout.tsx` ancestor
3. **App default** - Component from `_app.tsx`
4. **None** - If not defined anywhere

This inheritance system reduces boilerplate while maintaining flexibility for route-specific overrides.

#### Example 1: Basic Page with Dynamic Params

_File: `src/pages/blog/[id].tsx`_

```tsx
import { createRoute } from 'solid-file-router'
import { useParams } from '@solidjs/router'

export default createRoute({
  // Validate matches or extract custom data
  matchFilters: {
    id: (v) => /^\d+$/.test(v), // Only match if ID is numeric
  },
  component: (props) => {
    // Typesafe params if using the generated hooks/types
    const params = useParams<{ id: string }>()
    return <div>Viewing Post ID: {params.id}</div>
  },
})
```

#### Example 2: Data Loading, Loading States & Error Handling

_File: `src/pages/dashboard.tsx`_

```tsx
import { createRoute } from 'solid-file-router'

export default createRoute({
  // Fetch data before the component renders
  preload: async ({ params, location }) => {
    const res = await fetch(`/api/stats`)
    if (!res.ok) throw new Error('Failed to load stats')
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

_File: `src/pages/settings/_layout.tsx`_

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

## Component Inheritance

One of the most powerful features is automatic inheritance of loading and error components from layouts to routes. This eliminates repetitive configuration while maintaining full control when needed.

### How It Works

When you define `loadingComponent` or `errorComponent` in `_app.tsx` or `_layout.tsx`, all descendant routes automatically inherit these components unless they provide their own.

**Inheritance Priority (Fallback Chain):**

1. Route's own component (highest priority)
2. Nearest `_layout.tsx` ancestor
3. `_app.tsx` application default
4. None (lowest priority)

### Example: Application-Wide Defaults

_File: `src/pages/_app.tsx`_

```tsx
import { createRoute } from 'solid-file-router'

export default createRoute({
  component: (props) => (
    <div id="app">
      <header>My App</header>
      <main>{props.children}</main>
    </div>
  ),

  // These become defaults for ALL routes
  loadingComponent: () => (
    <div class="loading-spinner">
      <div class="spinner" />
      <p>Loading...</p>
    </div>
  ),

  errorComponent: (props) => (
    <div class="error-page">
      <h1>Something went wrong</h1>
      <p>{props.error.message}</p>
      <button onClick={props.reset}>Try Again</button>
    </div>
  ),
})
```

Now **every route** in your app automatically gets these loading and error components without any additional configuration!

### Example: Section-Specific Overrides

_File: `src/pages/dashboard/_layout.tsx`_

```tsx
import { createRoute } from 'solid-file-router'

export default createRoute({
  component: (props) => (
    <div class="dashboard">
      <aside>Dashboard Nav</aside>
      <div class="dashboard-content">{props.children}</div>
    </div>
  ),

  // Override loading for all dashboard routes
  loadingComponent: () => (
    <div class="dashboard-loading">
      <div class="skeleton-layout" />
    </div>
  ),

  // errorComponent not specified - inherits from _app.tsx
})
```

**Result:**

- All routes under `/dashboard/*` use the dashboard-specific loading component
- All routes under `/dashboard/*` still use the app-wide error component from `_app.tsx`

### Example: Route-Specific Override

_File: `src/pages/dashboard/analytics.tsx`_

```tsx
import { createRoute } from 'solid-file-router'

export default createRoute({
  preload: async () => {
    const data = await fetch('/api/analytics').then((r) => r.json())
    return data
  },

  // This route needs a special loading state
  loadingComponent: () => (
    <div class="analytics-loading">
      <div class="chart-skeleton" />
      <div class="stats-skeleton" />
    </div>
  ),

  // errorComponent not specified - inherits from _app.tsx

  component: (props) => (
    <div class="analytics">
      <h1>Analytics</h1>
      <pre>{JSON.stringify(props.data, null, 2)}</pre>
    </div>
  ),
})
```

**Result:**

- This specific route uses its own custom loading component
- Still inherits the error component from `_app.tsx`

### Example: Complete Inheritance Chain

Here's a complete example showing how the three-tier fallback works:

```
src/pages/
  _app.tsx                    # Defines: loadingComponent, errorComponent
  dashboard/
    _layout.tsx               # Defines: loadingComponent (overrides app)
    index.tsx                 # Inherits: dashboard loading, app error
    users.tsx                 # Inherits: dashboard loading, app error
    analytics.tsx             # Defines: loadingComponent (overrides dashboard)
                              # Inherits: app error
  settings/
    _layout.tsx               # Defines: errorComponent (overrides app)
    profile.tsx               # Inherits: app loading, settings error
    account.tsx               # Inherits: app loading, settings error
```

**Inheritance Resolution:**

| Route                  | Loading Component  | Error Component   |
| ---------------------- | ------------------ | ----------------- |
| `/dashboard`           | dashboard/\_layout | \_app             |
| `/dashboard/users`     | dashboard/\_layout | \_app             |
| `/dashboard/analytics` | analytics (own)    | \_app             |
| `/settings/profile`    | \_app              | settings/\_layout |
| `/settings/account`    | \_app              | settings/\_layout |

### Benefits

- ✅ **Less Boilerplate** - Define defaults once, use everywhere
- ✅ **Consistent UX** - All routes in a section share the same loading/error experience
- ✅ **Full Control** - Override at any level when you need custom behavior
- ✅ **Type Safe** - Full TypeScript support with proper type inference
- ✅ **Zero Runtime Cost** - Inheritance resolved at build time

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
      $id: postId, // Path param
      ref: 'newsletter', // Query param -> /blog/123?ref=newsletter
    })

    navigate(url)
  }

  return <button onClick={() => goToPost('123')}>Read Post</button>
}
```

---

### `readRouteInfo(matches)`

Helper to read the current route info from router matches without coupling your code to the generated route tree.

```tsx
import { useCurrentMatches } from '@solidjs/router'
import { readRouteInfo } from 'solid-file-router'

const matches = useCurrentMatches()
const currentInfo = () => readRouteInfo(matches())
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

#### Example3: Server Entry

```tsx
import { createServerEntry } from 'solid-file-router'

export default createServerEntry()
```

By default, `createServerEntry()` renders `<FileRouter base={import.meta.env.BASE_URL} url={props.url} />`.

You can pass a custom router component if you need full control:

```tsx
import { FileRouter } from 'virtual:routes'
import { createServerEntry } from 'solid-file-router'

export default createServerEntry((props) => <FileRouter base="/docs" url={props.url} />)
```

#### Type Definition

In `tsconfig.json`

```json
{
  "compilerOptions": {
    "types": ["solid-file-router/client"]
  }
}
```

`routeInfo` is exported from `virtual:routes` as a named export.

```ts
import { routeInfo } from 'virtual:routes'

console.log(routeInfo['/'])
console.log(routeInfo['/blog/:id'])
```

## Configuration

Options passed to the `fileRouter()` plugin in `vite.config.ts`.

````ts
interface FileRouterPluginOption {
  /**
   * The output file path where the page types will be saved.
   * @default 'src/routes.d.ts'
   */
  output?: string
  /**
   * The directory containing all route files.
   *
   * e.g. If your `_app.tsx` is located at `module/routes/_app.tsx`,
   * You need to setup to `module/routes`
   * @default 'src/pages'
   */
  pagesDir?: string
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
   * Whether to generate route modules with lazy imports.
   * When omitted, enabled in client builds and disabled in SSR builds.
   */
  lazy?: boolean
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
  /**
   * Component inheritance configuration.
   *
   * Controls how loading and error components are inherited from layouts.
   *
   * @default { enabled: true, inheritLoading: true, inheritError: true }
   */
  inheritance?: {
    /**
     * Whether to enable component inheritance globally.
     * When false, routes will not inherit loading/error components from layouts.
     * @default true
     */
    enabled?: boolean
    /**
     * Whether to inherit loadingComponent from layouts.
     * Only applies when `enabled` is true.
     * @default true
     */
    inheritLoading?: boolean
    /**
     * Whether to inherit errorComponent from layouts.
     * Only applies when `enabled` is true.
     * @default true
     */
    inheritError?: boolean
  }
  /**
   * Optional SSG configuration with Vite Environment API.
   * `vite-plugin-solid` stays user-configured.
   */
  ssg?: {
    /**
     * SSR entry file path.
     * @default 'src/entry-server.tsx'
     */
    serverEntry?: string
    /**
     * The ID of the root element where the app will be mounted.
     * @default 'root'
     */
    id?: string
    /**
     * Prerender routes or a lazy route producer.
     * @default ['/']
     */
    routes?: readonly string[] | (() => readonly string[] | Promise<readonly string[]>)
    /**
     * Max concurrent prerender tasks.
     * @default 4
     */
    concurrency?: number
  }
}
````

### Configuring SSG Prerender

When using SSG, keep `vite-plugin-solid` in your own Vite config, enable SSR transforms with `solidPlugin({ ssr: true })`, and configure prerendering through `fileRouter({ ssg: ... })`.

For SSG client entries, replace Solid's `render` with `createClientEntry`. It uses the same argument shape as `render`, but hydrates prerendered HTML in production:

_File: `src/index.tsx`_

```tsx
import { FileRouter } from 'virtual:routes'
import { createClientEntry } from 'solid-file-router'

createClientEntry(() => <FileRouter />, document.getElementById('root')!)
```

Create the server entry referenced by `ssg.serverEntry`:

_File: `src/entry-server.tsx`_

```tsx
import { createServerEntry } from 'solid-file-router'

export default createServerEntry()
```

Then enable SSG in your Vite config:

_File: `vite.config.ts`_

```ts
import { fileRouter } from 'solid-file-router/plugin'
import { defineConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'

export default defineConfig({
  plugins: [
    solidPlugin({ ssr: true }),
    fileRouter({
      ssg: {
        serverEntry: 'src/entry-server.tsx',
        routes: ['/', '/about'],
        concurrency: 4,
      },
    }),
  ],
})
```

If `ssg` is configured without `vite-plugin-solid({ ssr: true })`, the plugin throws an actionable build error with setup guidance.
For a complete runnable config, see `playground/vite.ssg.config.ts`.

### Configuring Component Inheritance

By default, all routes inherit loading and error components from their layouts. You can control this behavior at both the plugin level (build-time) and route level (runtime).

#### Build-Time Configuration (Plugin Level)

Control inheritance globally for all routes:

```typescript
// vite.config.ts
import { fileRouter } from 'solid-file-router/plugin'

export default defineConfig({
  plugins: [
    fileRouter({
      // Disable all inheritance globally
      inheritance: {
        enabled: false,
      },
    }),
  ],
})
```

Or selectively disable specific component types:

```typescript
// vite.config.ts
export default defineConfig({
  plugins: [
    fileRouter({
      inheritance: {
        enabled: true,
        inheritLoading: false, // Routes won't inherit loading components
        inheritError: true, // Routes will still inherit error components
      },
    }),
  ],
})
```

#### Runtime Configuration (Route Level)

Control inheritance for individual routes using the `inherit` property:

```tsx
// Disable all inheritance for this route
export default createRoute({
  component: () => <SpecialPage />,
  inherit: false, // No loading/error components from layouts
})
```

```tsx
// Selectively disable inheritance
export default createRoute({
  component: () => <CustomPage />,
  loadingComponent: () => <CustomLoader />,
  inherit: {
    loading: false, // Don't inherit loading component
    error: true, // Still inherit error component (default)
  },
})
```

#### Configuration Priority

The inheritance resolution follows this priority order:

1. **Route-level `inherit` configuration** (highest priority)
   - `inherit: false` disables all inheritance
   - `inherit: { loading: false }` disables loading inheritance
   - `inherit: { error: false }` disables error inheritance

2. **Build-time plugin configuration**
   - `inheritance.enabled: false` disables globally
   - `inheritance.inheritLoading: false` disables loading inheritance globally
   - `inheritance.inheritError: false` disables error inheritance globally

3. **Default behavior** (lowest priority)
   - Inheritance enabled for both loading and error components

#### Use Cases

**Performance-Critical Routes:**

```tsx
// Skip wrapper components for maximum performance
export default createRoute({
  component: () => <HighPerformancePage />,
  inherit: false,
})
```

**Custom Error Handling:**

```tsx
// Use custom error handling instead of inherited error boundary
export default createRoute({
  component: () => <CustomErrorHandlingPage />,
  errorComponent: (props) => <CustomErrorUI error={props.error} />,
  inherit: { error: false },
})
```

**Gradual Migration:**

```tsx
// During migration, disable inheritance for legacy routes
export default createRoute({
  component: () => <LegacyPage />,
  inherit: false, // Legacy page handles its own loading/error states
})
```

## Credit

Highly inspired by [`generouted`](https://github.com/oedotme/generouted). Created to provide better customization for SolidJS specific features like lazy loading route components while keeping route metadata eager.

## License

MIT
