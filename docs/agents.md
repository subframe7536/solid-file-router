# Agent Guide

This document gives coding agents deterministic entry points for integrating
`solid-file-router` and maintaining this repository. For repository-wide code
style, commands, and collaboration rules, read [AGENTS.md](../AGENTS.md) first.
Do not duplicate those rules here.

## Operating Rules

1. Treat source types and tests as the current truth. Documentation can lag.
2. Do not edit generated route declarations by hand. Regenerate them through
   the Vite plugin.
3. Keep `vite-plugin-solid` in the consuming application's Vite config. This
   package does not configure it.
4. Import runtime APIs from `solid-file-router`, plugin APIs from
   `solid-file-router/plugin`, and generated routes from `virtual:routes`.
5. Enable `solid-file-router/client` types before importing `virtual:routes`.
6. Preserve client and SSR behavior when changing route generation. Client
   routes are lazy by default; SSR routes are eager by default.
7. Assume pre-1.0 minor releases may be breaking. Do not infer compatibility
   from the version number alone.

## Consumer Task Map

| Task                 | Required action                                                     | Verify                                                 |
| -------------------- | ------------------------------------------------------------------- | ------------------------------------------------------ |
| Install              | Add the package, Solid, Solid Router, Vite, and `vite-plugin-solid` | Dependency versions satisfy `package.json`             |
| Configure routes     | Register `solidPlugin()` and `fileRouter()`                         | Vite starts and `src/routes.d.ts` is generated         |
| Add a page           | Default-export `createRoute({ component })` from `.jsx` or `.tsx`   | Generated path appears in route types                  |
| Add a layout         | Add `_layout.tsx` in the ancestor directory                         | Descendants render through it                          |
| Add an app root      | Add optional `src/pages/_app.tsx`                                   | `Root` resolves to its component                       |
| Navigate dynamically | Call `generatePath` with `$`-prefixed path parameters               | Result contains no unresolved `:param`                 |
| Add metadata         | Define `info` and configure `infoDts`                               | `FileRouteInfo` and `routeInfo` are typed              |
| Add SSG              | Enable Solid SSR, add `ssg`, and use `createClientEntry`            | Build emits `dist/client/index.html` and `404.html`    |
| Use built-in MDX     | Install Satteri and set `mdx: true`                                 | `.md`/`.mdx` routes are generated and render           |
| Use a CMS/provider   | Provide `routeSource.transformPath` and `routeSource.load`          | Every provider entry returns valid route module source |

Use [guide.md](guide.md) for workflows and [reference.md](reference.md) for exact
options and types.

## Minimal Consumer Integration

Before changing application code, confirm these files and responsibilities:

```text
vite.config.ts       registers solidPlugin and fileRouter
tsconfig.json        includes solid-file-router/client
src/pages/**/*.tsx   route modules
src/index.tsx        renders FileRouter or calls createClientEntry for SSG
src/routes.d.ts      generated; never hand-edit
```

A valid route module has a static, extractable default export:

```tsx
import { createRoute } from 'solid-file-router'

export default createRoute({
  component: () => <h1>Page</h1>,
})
```

Do not generate a top-level config with object spread. The AST extractor rejects
it. Nested objects may contain normal expressions because extraction is shallow
at the selected property boundary.

## Repository Source Map

| Concern                                        | Primary source            | Primary tests                                         |
| ---------------------------------------------- | ------------------------- | ----------------------------------------------------- |
| Vite plugin, options, SSG, HTML injection      | `src/index.ts`            | `tests/plugin.test.ts`                                |
| Runtime API and loader boundaries              | `src/runtime.ts`          | `tests/runtime.test.ts`, `tests/generatePath.test.ts` |
| File path conversion and route tree generation | `src/utils/definition.ts` | `tests/definition.test.ts`                            |
| Route module AST extraction                    | `src/utils/extract.ts`    | `tests/extract.test.ts`                               |
| Generated route declarations                   | `src/utils/route-type.ts` | `tests/route-type.test.ts`                            |
| Route discovery, HMR, and custom sources       | `src/utils/registry.ts`   | `tests/registry.test.ts`                              |
| Public custom source types                     | `src/utils/source.ts`     | `tests/plugin.test.ts`, `tests/registry.test.ts`      |
| `virtual:routes` declaration                   | `client.d.ts`             | `tests/definition.test.ts`                            |

Read the primary source and its tests before changing behavior. Search call
sites before changing an exported type or generated wire shape.

## Behavioral Invariants

### Route generation

- File routing is built in and scans only `.jsx` and `.tsx` under `pagesDir`.
- Optional MDX discovery and custom `routeSource` providers add more route inputs;
  all inputs participate in the same route tree and HMR rules.
- Route import names remain stable when unrelated files are added.
- `_app` and `404` have generated fallbacks when files are absent.
- Private `_` segments do not generate pages; layouts remain structural inputs.
- Route topology changes regenerate route types and invalidate the virtual
  module.

### AST extraction

- Only `createRoute` imported from `solid-file-router` is recognized.
- The default export must resolve to a `createRoute` call with one object
  argument.
- Top-level spreads are rejected.
- Extraction variants and SSR/client parses have isolated cache keys.

### Component loading

- Client definitions are lazy by default and SSR definitions are eager by
  default unless `lazy` is explicit.
- Both modes keep the same loading and error boundaries.
- Inheritance resolves from route to nearest layout to `_app`.
- Route-level `inherit` and global `inheritance` settings control only inherited
  fallbacks, not components declared on the current route.

### Types and metadata

- Generated paths exclude private and layout files and include `/404`.
- Dynamic params use `$name`; splats use `'*'`.
- `infoDts.from` is emitted unchanged relative to the generated declaration.
- `routeInfo` uses generated route patterns as keys.

### SSG

- SSG is opt-in and configures separate client and server build environments.
- The internal renderer is used unless `serverEntry` is provided.
- Every build emits a `404.html` fallback.
- Route rendering is deduplicated and concurrency is never below one.
- HTML accepts exactly one outlet strategy and requires a head insertion point.

### Custom route providers

- Normalized `routeId`, logical `path`, and `sourcePath` values are unique across
  built-in and custom route inputs.
- Every route ID is unique; later providers never override an earlier route.
- `routeId` derives from logical `path` when omitted.
- `data` passes through the current process without serialization.
- `load` must return module source for every route entry.
- HMR respects literal paths, include globs, exclusions, and exact source paths.

## Change-to-Test Matrix

Run the narrow test first, then the full checks before handing off:

| Change                            | Narrow verification                                                 |
| --------------------------------- | ------------------------------------------------------------------- |
| File naming or tree construction  | `bun run test -- tests/definition.test.ts tests/route-type.test.ts` |
| Route config extraction           | `bun run test -- tests/extract.test.ts`                             |
| Runtime URL or metadata helper    | `bun run test -- tests/generatePath.test.ts tests/runtime.test.ts`  |
| HMR, scanning, or route providers | `bun run test -- tests/registry.test.ts tests/plugin.test.ts`       |
| SSG or Vite integration           | `bun run test -- tests/plugin.test.ts`                              |
| Public types or declarations      | `bun run typecheck` plus the owning tests                           |
| Documentation only                | Link check, `git diff --check`, then full typecheck and tests       |

Required full verification for production changes:

```bash
bun run typecheck
bun run test
bun run lint
```

Use `bun run play` for interactive routing changes and
`bun run play:ssg:build` for an end-to-end SSG build when those surfaces change.

## Documentation Maintenance

Before changing documentation, verify claims in this order:

1. Public types in `src/runtime.ts`, `src/index.ts`, `src/utils/source.ts`, and
   `client.d.ts`
2. Defaults and generated behavior in implementation
3. Expected edge cases in tests
4. Runnable configuration in `playground`
5. Existing prose

Keep the documentation surfaces distinct:

- `README.md`: positioning, installation, shortest working setup, navigation
- `docs/guide.md`: task-oriented consumer workflows
- `docs/reference.md`: complete public behavior and exact defaults
- `docs/ssg.md`: the end-to-end static generation workflow
- `docs/mdx.md`: built-in Markdown/MDX setup and component customization
- `docs/agents.md`: deterministic integration and maintenance instructions

Do not copy a full reference section back into the README. Link to the owning
document and keep one canonical explanation for each behavior.

When public behavior changes, update the source, owning tests, reference, and
affected guide recipe in the same change. When only prose changes, do not alter
runtime code or generated declarations.

## Generated and Derived Files

- Consumer `src/routes.d.ts` files are generated by the plugin.
- `playground/src/routes.d.ts` is a tracked generated example; regenerate it
  through the playground workflow when route shape changes.
- `dist/` is build output. Do not use it as the primary source for documentation
  or implementation decisions.
- `virtual:routes` exists only through Vite plugin resolution; its public type
  declaration is `client.d.ts`.

## Handoff Checklist

- The requested behavior is covered without unrelated refactors.
- Public imports and generated shapes remain compatible or the breaking change
  is explicitly documented.
- Relevant narrow tests pass.
- `bun run typecheck`, `bun run test`, and `bun run lint` pass when applicable.
- Generated files were changed only through their owning generator.
- Documentation links resolve and examples match current imports and defaults.
