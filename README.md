# solid-file-router

Type safe file router for solid.js

Generate type safe route definition and virtual module that return `@solidjs/router`'s `RouteDefinition` and `<FileRouter>`

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

```tsx
import { createRoute } from 'solid-file-router'

export default createRoute({
  component: (props) => {
    return <div>{props.children}</div>
  },
})
```

4. **Create your entry point** (e.g., `src/index.tsx`):

```tsx
import { render } from 'solid-js/web'
import { FileRouter } from 'virtual:routes'

render(() => <FileRouter base="/optional/base" />, document.getElementById('app')!)
```

## Basic Usage

### Custom Router

You can create a custom router by using the `Router` component directly:

```tsx
import { render } from 'solid-js/web'
import { Router } from '@solidjs/router'
import { fileRoutes, Root } from 'virtual:routes'

render(() => (
  <Router root={<Root />} preload={true}>
    {fileRoutes}
  </Router>
), document.getElementById('app')!)
```

### Simple Route

`createRoute` is used to define route components. You **MUST** export it as the default export in your page files.

Create a file in `src/pages/` directory. The file path maps to the route:

```tsx
// src/pages/index.tsx
import { createRoute } from 'solid-file-router'

export default createRoute({
  component: () => <div>Home Page</div>,
})
```

Now visiting `/` will render your component.

### Nested Routes

Create nested directories to organize routes:

```
src/pages/
  _app.tsx
  index.tsx
  about.tsx
  -[lang]/
    index.tsx
  blog/
    index.tsx
    [id].tsx
```

This creates routes:
- `pages/index.tsx` -> `/`
- `pages/about.tsx` -> `/about`
- `pages/blog/index.tsx` -> `/blog`
- `pages/blog/[id].tsx` -> `/blog/:id`
- `pages/-[lang]/index.tsx` -> `/:lang?`

### Dynamic Routes

Use bracket notation for dynamic segments:

```tsx
// src/pages/blog/[id].tsx
import { createRoute } from 'solid-file-router'
import { useParams } from '@solidjs/router'

export default createRoute({
  component: (props) => {
    const params = useParams<{ id: string }>()
    return <div>Blog Post: {params.id}</div>
  },
})
```

### Layouts

Use `_layout.tsx` to define layout components that wrap nested routes:

```tsx
// src/pages/blog/_layout.tsx
import { createRoute } from 'solid-file-router'

export default createRoute({
  component: (props) => (
    <div class="blog-layout">
      <sidebar />
      {props.children}
    </div>
  ),
})
```

All routes under `src/pages/blog/` will now be wrapped by this layout.

### Data Preloading

Use the `preload` function to fetch data before rendering:

```tsx
// src/pages/blog/[id].tsx
import { createRoute } from 'solid-file-router'

export default createRoute({
  preload: async (params) => {
    const response = await fetch(`/api/blog/${params.id}`)
    return response.json()
  },
  component: (props) => (
    <div>
      <h1>{props.data.title}</h1>
      <p>{props.data.content}</p>
    </div>
  ),
})
```

### Loading States

Show a loading component while data is being fetched:

```tsx
// src/pages/_app.tsx
import { createRoute } from 'solid-file-router'

export default createRoute({
  loadingComponent: () => <div>Loading...</div>,
  component: (props) => (
    <div>{props.children}</div>
  ),
})
```

### Error Handling

Handle errors with custom error boundaries:

```tsx
// src/pages/_app.tsx
import { createRoute } from 'solid-file-router'

function ErrorBoundary(props: { error: Error; reset: () => void }) {
  return (
    <div>
      <h2>Something went wrong</h2>
      <p>{props.error.message}</p>
      <button onClick={props.reset}>Try again</button>
    </div>
  )
}

export default createRoute({
  errorComponent: ErrorBoundary,
  component: (props) => (
    <div>{props.children}</div>
  ),
})
```

### 404 Page

Create a catch-all page for unmatched routes:

```tsx
// src/pages/404.tsx
import { createRoute } from 'solid-file-router'

export default createRoute({
  component: () => <div>Page not found</div>,
})
```

### Type-Safe Path Generation

Use `generatePath` for type-safe route navigation:

```tsx
import { generatePath } from 'solid-file-router'
import { useNavigate } from '@solidjs/router'

export function MyComponent() {
  const navigate = useNavigate()

  const handleNavigation = () => {
    // TypeScript will validate the path and parameters
    const path = generatePath('/blog/:id', { $id: '123' })
    navigate(path)
  }

  return <button onClick={handleNavigation}>Go to Blog</button>
}
```

## API Reference

### `createRoute(config)`

Creates a route configuration object. Must be the default export in page files.

**Parameters:**
- `component` (required) - The component to render for this route
- `errorComponent` (optional) - Component to render when an error occurs
- `loadingComponent` (optional) - Component to show while loading data
- `preload` (optional) - Async function to fetch data before rendering
- `info` (optional) - Route metadata (e.g., page title)
- `matchFilters` (optional) - Custom route matching logic

### `generatePath(path, params)`

Generates a URL path with parameters substituted. Provides full type safety for routes and parameters.

**Parameters:**
- `path` - The route path pattern
- `params` - Object with path parameters (prefixed with `$`) and query parameters
  - Path parameters are prefixed with `$` (e.g., `$id`)
  - Query parameters are not prefixed with `$` (e.g., `search`)

**Returns:** Complete URL string with parameters filled in

## Project Structure Example

```
src/
  pages/
    _app.tsx              # App root and layout
    index.tsx             # / route
    about.tsx             # /about route
    404.tsx               # Fallback for unmatched routes
    nest.d.a.t.a.tsx      # /nest/d/a/t/a route
    -[lang]/              # Optional lang parameter
      index.tsx           # /:lang? route
      [slug].tsx          # /:lang?/:slug route
    blog/                 # Blog routes
      _layout.tsx         # Layout for blog routes
      index.tsx           # /blog route
      [id].tsx            # /blog/:id route
      category/
        [slug].tsx        # /blog/category/:slug route
  index.tsx               # App entry point
  routes.d.ts             # Auto-generated type definitions
```

## Configuration

Pass options to `fileRouter()` in your Vite config:

```ts
interface FileRouterPluginOption {
  /**
   * The output file path where the page types will be saved.
   * @default 'src/routes.gen.ts'
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
   * Default: all files in `components/`, `node_modules/` and `dist/`
   */
  ignore?: string[]
}
```