import picomatch from 'picomatch'

import { VID_MDX_ROUTE } from './const'
import { cleanPath, PageFileSystemRouter } from './fs'
import type { PageFileSystemRouterConfig, RouteManifestEntry } from './fs'

const REG_GROUP = /^\([\w-]+\)$/
const REG_PARAM = /\[([^\]]+)\]/g
const REG_SPLAT = /\[\.{3}([\w-]+)\]/g

/**
 * Creates a matcher over glob patterns using picomatch.
 * Used internally for ignore lists.
 */
export function createGlobMatcher(globs: readonly string[]): (src: string) => boolean {
  return globs.length === 0 ? () => false : picomatch(globs as string[])
}

/**
 * Maps a route file path — relative to the pages dir, leading `/`, extension
 * stripped, e.g. `/blog/[id]` — to a path in the neutral pattern language
 * (`:param`, `:param?`, `*rest`, `(group)`), or `undefined` to skip the file.
 *
 * Every emitted path is prefixed with the `/(app)` route group so an `_app`
 * file becomes the parent layout of all routes via official group nesting.
 */
export function routePathFromFile(routeFile: string): string | undefined {
  const parts = routeFile.split('/').slice(1)
  if (parts.length === 0 || parts[0] === '') {
    return undefined
  }
  // root `_app` is the parent layout of everything; a root `_layout` file
  // falls through the loop below to the same `/(app)` result
  if (parts.length === 1 && parts[0] === '_app') {
    return '/(app)'
  }
  const last = parts.length - 1
  const segments: string[] = []
  for (let i = 0; i <= last; i++) {
    const raw = parts[i]!
    if (raw.startsWith('_') && (raw !== '_layout' || i !== last)) {
      return undefined
    }
    if (i === last) {
      if (raw === 'index') {
        segments.push('')
        continue
      }
      if (raw === '404') {
        segments.push('*404')
        continue
      }
      if (raw === '_layout') {
        continue
      }
    }
    // `(group)` segments are retained — official tree-building strips them
    // for URLs but keeps them for nesting
    if (REG_GROUP.test(raw)) {
      segments.push(raw)
      continue
    }
    const transformed = raw.replace(REG_SPLAT, '*$1').replace(REG_PARAM, ':$1')
    for (const part of transformed.split('.')) {
      if (!part || part === 'index' || part === '_layout' || REG_GROUP.test(part)) {
        continue
      }
      let segment = part
      let optional = false
      if (segment.startsWith('-')) {
        optional = true
        segment = segment.slice(1)
      }
      if (!segment) {
        continue
      }
      // `-literal` optional literal segments have no neutral equivalent;
      // they are emitted as plain literals (documented difference).
      segments.push(segment.startsWith(':') && optional ? `${segment}?` : segment)
    }
  }
  if (segments.length === 0) {
    return '/(app)'
  }
  return `/(app)/${segments.join('/')}`
}

export interface DefaultFileSystemRouterConfig extends PageFileSystemRouterConfig {
  /**
   * Globs matched against the file path relative to `dir` (e.g.
   * `hooks/**`, `**\/*.test.tsx`). Matched files are not routes. Files under
   * a `_`-prefixed segment are already skipped by the filename convention —
   * use `ignore` for everything else.
   */
  ignore?: readonly string[]
}

/**
 * The file-system router — the package's only built-in convention.
 *
 * | File                       | Route path           |
 * | -------------------------- | -------------------- |
 * | `index.tsx`                | `/`                  |
 * | `about.tsx`                | `/about`             |
 * | `blog/index.tsx`           | `/blog/`             |
 * | `blog/[id].tsx`            | `/blog/:id`          |
 * | `docs/-[lang]/index.tsx`   | `/docs/:lang?/`      |
 * | `blog/[...all].tsx`        | `/blog/*all`         |
 * | `(auth)/login.tsx`         | `/login` (group)     |
 * | `blog/_layout.tsx`         | layout of `/blog/*`  |
 * | `_app.tsx` / `_layout.tsx` | root layout          |
 * | `404.tsx`                  | `*404` fallback      |
 * | `account.settings.tsx`     | `/account/settings`  |
 * | `foo.index.tsx`            | `/foo`               |
 * | `_x.tsx`, `x/_y/index.tsx` | private, not a route |
 */
export class DefaultFileSystemRouter extends PageFileSystemRouter {
  private isIgnored: (src: string) => boolean

  constructor(config: DefaultFileSystemRouterConfig) {
    super(config)
    this.isIgnored = createGlobMatcher(config.ignore ?? [])
  }

  override toPath(src: string): string | undefined {
    if (this.config.toPath) {
      return super.toPath(src)
    }
    return routePathFromFile(cleanPath(src, this.config))
  }

  override isRoute(src: string): boolean {
    // `src` is absolute; ignore globs are matched relative to `dir`.
    const relative = src.slice(this.config.dir.length).replace(/^\/+/, '')
    return super.isRoute(src) && !this.isIgnored(relative)
  }

  override toRoute(src: string): RouteManifestEntry | undefined {
    if (this.config.toRoute) {
      return super.toRoute(src)
    }
    if (/\.mdx?$/i.test(src)) {
      const path = this.toPath(src)
      if (path === undefined) {
        return
      }
      // The stock convention emits no `$$route` for markdown. Ours points at a
      // virtual module that re-compiles only the route-facing exports, so the
      // manifest never eagerly bundles the compiled component.
      return {
        page: true,
        $component: { src, pick: ['default', '$css'] },
        $$route: { src: `${VID_MDX_ROUTE}${src}`, pick: ['route'] },
        path,
      }
    }
    return super.toRoute(src)
  }
}
