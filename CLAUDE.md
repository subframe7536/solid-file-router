# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Core Development
- **Build**: `bun run build` - Build library with tsdown
- **Dev mode**: `bun run dev` - Watch mode for development
- **Type check**: `bun run typecheck` - Run TypeScript type checking
- **Test**: `bun test` - Run all tests with Vitest
- **Test single file**: `bun test src/core.test.ts` - Run specific test file
- **Lint**: `bun oxlint --fix` - Fix linting issues
- **Format**: `bun oxlint --format write .` - Format code
- **Playground**: `bun run play` - Run Vite dev server for testing plugin

### Publishing
- **Release**: `bun run release` - Bump version and publish to npm

## Project Overview

This is a file-system-based routing plugin for SolidJS applications. It generates type-safe routes from a `src/pages` directory structure, similar to Next.js or Nuxt.js routing.

**Key Features:**
- Auto-generates routes from file structure in `src/pages`
- Virtual modules for type-safe navigation
- Support for layouts, dynamic routes, optional parameters, route groups, and modal routes
- Vite plugin that watches files during development

## Architecture

### Core Routing Logic ([src/core.ts](src/core.ts))
The heart of the routing system. Handles:
- Pattern matching for route files (e.g., `[id].tsx`, `-[lang]?.tsx`, `[...catchall].tsx`)
- Building route trees with proper hierarchy
- Identifying special route types (layouts, modals, dynamic segments)
- Generating path strings and parameter definitions

### Main Plugin ([src/index.ts](src/index.ts))
Vite plugin implementation that:
- Scans the `src/pages` directory for route files
- Generates virtual modules for runtime use
- Creates TypeScript types for all routes
- Watches for file changes during development
- Manages hot module replacement for routes

### Build System
- **Bundler**: tsdown (creates both `.js` and `.jsx` outputs)
- **Package Manager**: Bun
- **Testing**: Vitest with happy-dom
- **Linting**: Oxlint with eslint-plugin-solid

### Route Patterns
The plugin supports these file naming patterns:
- `index.tsx` → `/`
- `[param].tsx` → `/routes/:param` (dynamic segment)
- `-[opt]?` → optional parameter
- `[...catchall].tsx` → catch-all route
- `(group)/` → route group (not in URL path)
- `_layout.tsx` → layout wrapper for child routes
- `[+]modal.tsx` → modal route

## Development Workflow

1. **Making changes to routing logic**: Modify [src/core.ts](src/core.ts) and run tests
2. **Testing plugin in action**: Use `bun run play` to test in the playground app
3. **Building for release**: Run `bun run build` before publishing
4. **Code quality**: Always run `bun test` and `bun oxlint --fix` before committing

## Technical Notes

- This project preserves JSX (SolidJS requirement) - do not transform JSX in the build
- Uses path alias `~/*` mapped to `./src/*`
- The `.jsx` file extension outputs are necessary for SolidJS JSX components
- Peer dependencies: `solid-js ^1.9` and `tinyglobby`
