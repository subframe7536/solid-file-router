# AGENTS.md - solid-file-router

## Project Overview

Type-safe file-based router for Solid 2 over the official stack
(`@solidjs/router`, `@solidjs/web`, `@solidjs/vite-plugin`).
The package provides:

- Built-in filesystem routing implementation using Vite's `parseSync`, `tinyglobby`, `picomatch`, and `radix3`
- `fileRouter()` Vite preset (`fileRoutes`)
- `DefaultFileSystemRouter` — the single built-in filename convention;
  custom scanning via the `router` option
- `createFileRouter()` runtime adapter: inherited loading/error components,
  `useHead` metadata, draft routes, augmentable `RouteInfo`
- MDX routes via Satteri (`export const route` + default component)
- SSG prerendering through the start `handleRequest`
- Consumers configure `@solidjs/vite-plugin` separately in app Vite configs

## Build / Lint / Test Commands

```bash
pnpm build          # Build library with tsdown
pnpm test           # Run vitest once (CI mode) in
pnpm test:dev       # Run vitest watch mode
pnpm lint           # Lint with oxlint
pnpm format         # Format with oxfmt
pnpm typecheck      # TypeScript type checking (tsc --noEmit)
pnpm qa             # Auto-fix lint, format, then typecheck
pnpm oxc            # Lint + auto-fix + format in one pass
pnpm release        # Build -> lint -> test -> bump version
```

### Running a Single Test

```bash
# Run a specific test file
pnpm test -- tests/extract.test.ts

# Run tests matching a pattern
pnpm test -t "extracts properties"

# Run single test file (non-watch)
pnpm test --run tests/extract.test.ts
```

### Playground

```bash
pnpm play           # Dev server for playground/
pnpm play:build     # Build playground
pnpm play:preview   # Preview playground build
```

## Code Style

### Imports

- Use `import type { ... }` for type-only imports (enforced by `typescript/consistent-type-imports`)
- No semicolons (oxfmt config: `"semi": false`)
- Single quotes (oxfmt config: `"singleQuote": true`)
- Import order (auto-sorted by oxfmt):
  1. Side effects
  2. Built-in Node modules
  3. External packages
  4. Internal modules
  5. Parent/relative imports
  6. Sibling/index imports

### Formatting

- Formatter: `oxfmt` (config in `.oxfmtrc.json`)
- Tab or space: inferred from existing code (2-space indent)
- Ignore file: `playground/src/routes.d.ts` (generated)

### TypeScript

- `strict: true`, `strictNullChecks: true`, `noEmit: true`
- Target: `ESNext`, Module: `ESNext`, resolution: `bundler`
- Use `// @ts-expect-error` with description (enforced), never `// @ts-ignore`
- Prefer `as const` over explicit type annotations where possible

### Naming Conventions

- Internal virtual module IDs: uppercase with underscores (`ID_EXTRACT`, `VID_HELPER`)
- Private implementation: descriptive names, no underscore prefix convention
- Regex constants: `REG_` prefix (e.g., `REG_LAYOUT`, `REG_GROUP`)
- Test files: `*.test.ts` in `tests/` directory

### Functions & Variables

- Prefer `const` arrow functions for exports, `function` declarations for internal helpers
- `curly: "error"` - always use braces for control flow
- `eqeqeq: ["error", "smart"]` - strict equality except `== null`
- `no-var: "error"` - use `let`/`const` only

### Error Handling

- Tests use `expect(...).rejects.toThrow(...)` pattern
- Plugin errors use Vite's logger: `logger.info(...)` / `logger.warn(...)`
- Extract module throws descriptive errors for invalid route definitions

### Solid.js Specific (src/** and playground/**)

- `solid/prefer-for` - use `<For>` instead of `.map()`
- `solid/prefer-show` - use `<Show>` instead of ternary for conditionals
- `solid/no-react-deps` - no React-specific hooks or patterns
- `solid/self-closing-comp` - self-close components with no children
- `solid/no-innerhtml` - disallow `innerHTML` except static content

## Architecture

```
src/
  index.ts          # Public runtime entry (createFileRouter, defineRoute/definePage)
  plugin.ts         # Vite preset orchestration (fileRouter -> fileRoutes)
  const.ts          # Shared constants, Promisable, and logger
  convention.ts     # DefaultFileSystemRouter — filename table + ignore globs
  route.ts          # adaptFileRoutes + route config types + RouteMetadata/RouteInfo
  fs/               # In-house filesystem routing (tinyglobby, picomatch, radix3, Vite parseSync AST)
  mdx/              # MDX runtime, Satteri compilation, and Vite plugin
  ssg.ts            # Prerender plugin over prerender-crawler + preview fallback
```

## Testing Conventions

- Framework: vitest (imports from `vitest`)
- Test files in `tests/` directory, source in `src/`
- Use `describe`/`it`/`expect` pattern
- Use `toMatchInlineSnapshot()` for complex output verification
- Use `beforeEach` for test isolation (e.g., cache invalidation)
- Use string arrays for pure path/tree unit tests; integration tests that exercise
  Vite, code generation, or file watching may use unique temporary directories and
  must clean them up reliably.

## Key Patterns

### Virtual Modules

- `virtual:routes` - route manifest module (fixed id);
  exports default flat manifest + `pageRoutes` tree

### Route adaptation

`adaptFileRoutes` walks the `pageRoutes` tree and wraps each component in
`Errored`/`Loading` boundaries, wires `metadata` to `useHead`, drops `draft`
routes in production, and collects `routeInfo`/`routeMetadata`.

### Component Inheritance

Loading and error components cascade `_app.tsx` -> `_layout.tsx` -> route file.
Controlled per-route via `inherit` (`false` or `{ loading?, error? }`).
