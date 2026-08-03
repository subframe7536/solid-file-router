# AGENTS.md - solid-file-router

## Project Overview

Type-safe file-based router for Solid.js. The package provides:

- A Vite plugin that generates routes from `src/pages/` directory structure
- Runtime utilities (`createRoute`, `generatePath`)
- Component inheritance system for loading/error boundaries
- Consumers configure `vite-plugin-solid` separately in app Vite configs

## Build / Lint / Test Commands

```bash
bun run build          # Build library with tsdown
bun run test           # Run vitest once (CI mode) in
bun run test:dev       # Run vitest watch mode
bun run lint           # Lint with oxlint
bun run format         # Format with oxfmt
bun run typecheck      # TypeScript type checking (tsc --noEmit)
bun run qa             # Auto-fix lint, format, then typecheck
bun run oxc            # Lint + auto-fix + format in one pass
bun run release        # Build -> lint -> test -> bump version
```

### Running a Single Test

```bash
# Run a specific test file
bun run test -- tests/extract.test.ts

# Run tests matching a pattern
bun run test -t "extracts properties"

# Run single test file (non-watch)
bun run test --run tests/extract.test.ts
```

### Playground

```bash
bun run play           # Dev server for playground/
bun run play:build     # Build playground
bun run play:preview   # Preview playground build
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
  index.ts          # Public runtime entry (createRoute, generatePath, client/server entries)
  plugin.ts         # Vite plugin orchestration (fileRouter)
  const.ts          # Shared constants and logger
  mdx/              # MDX runtime components, compilation, and Vite plugin
  route/            # Route discovery, transforms, registry, codegen, and Vite plugins
  ssg/              # Static generation entry, Vite plugin, and rendering helpers
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

The plugin uses Vite virtual modules for route injection:

- `virtual:routes` - resolved to `\0virtual:routes`, exports `FileRouter`, `fileRoutes`, `Root`, `routeInfo`
- `virtual:router-entry` - client/server helper exports `renderClient`, `renderServer`

### AST Extraction

Route files are transformed via Babel AST parsing to extract specific properties from `createRoute()` calls. Supports query-based filtering: `?meta`, `?comp`, `?load`, `?error`.

### Component Inheritance

Loading and error components cascade from `_app.tsx` -> `_layout.tsx` -> route file. Controlled via `inherit` option in `createRoute()` or global `inheritance` plugin config.
