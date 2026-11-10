import type { RouteSectionProps } from '@solidjs/router'
import { useHead } from '@solidjs/web'
import type { HeadTag } from '@solidjs/web'
import type { Component } from 'solid-js'
import { createComponent, DEV, Errored, Loading, untrack } from 'solid-js'

import type { RouteMetadata } from '../metadata'
export type { RouteMetadata, RouteMetaTag, RouteMetadataLink } from '../metadata'

export interface ErrorComponentProps {
  error: unknown
  reset: VoidFunction
}

/** Extension keys this package consumes on top of the official `route` config. */
export interface SfrRouteConfig<T = unknown> {
  /** Loading boundary fallback component. */
  loadingComponent?: Component<RouteSectionProps<T>>
  /** Error boundary fallback component. */
  errorComponent?: Component<ErrorComponentProps>
  /**
   * `false` disables loading/error inheritance; `{ loading: false }` /
   * `{ error: false }` disables it selectively.
   */
  inherit?: boolean | { loading?: boolean; error?: boolean }
  /** Declarative head metadata applied via `useHead`. */
  metadata?: RouteMetadata
  /** Route only exists during development. */
  draft?: boolean
}

/**
 * The `export const route` contract of a route module. Includes the official
 * `route` keys (`preload`, `info`, `matchFilters`, ...) plus this package's
 * extension keys.
 */
export type RouteConfig<T = unknown> = SfrRouteConfig<T> & {
  preload?: (args: unknown) => T
  info?: Record<string, unknown>
  matchFilters?: Record<string, unknown>
  [key: string]: unknown
}

/**
 * Identity helper for a route module's `route` export — types the sfr
 * extension keys the official `FileRouteConfig` does not know.
 */
export function defineRoute<T = unknown>(config: RouteConfig<T>): RouteConfig<T> {
  return config
}

export type RouteEntry = {
  path?: string | string[]
  component?: Component<any>
  children?: readonly RouteEntry[] | RouteEntry
  loadingComponent?: Component<any>
  errorComponent?: Component<ErrorComponentProps>
  inherit?: SfrRouteConfig['inherit']
  metadata?: RouteMetadata
  draft?: boolean
  [key: string]: unknown
}

interface InheritContext {
  loading?: Component<any>
  error?: Component<ErrorComponentProps>
}

function inheritAllowed(inherit: SfrRouteConfig['inherit'], key: 'loading' | 'error'): boolean {
  if (inherit === false) {
    return false
  }
  if (typeof inherit === 'object' && inherit !== null) {
    return inherit[key] !== false
  }
  return true
}

function metadataToHeadTags(metadata: RouteMetadata): HeadTag[] {
  const tags: HeadTag[] = []
  if (metadata.title !== undefined) {
    tags.push({ tag: 'title', key: 'title', props: { children: metadata.title } })
  }
  if (metadata.description !== undefined) {
    tags.push({
      tag: 'meta',
      key: 'name:description',
      props: { name: 'description', content: metadata.description },
    })
  }
  if (metadata.canonical !== undefined) {
    tags.push({
      tag: 'link',
      key: 'rel:canonical',
      props: { rel: 'canonical', href: metadata.canonical },
    })
  }
  for (const meta of metadata.meta ?? []) {
    tags.push({
      tag: 'meta',
      key: meta.name !== undefined ? `name:${meta.name}` : `property:${meta.property}`,
      props:
        meta.name !== undefined
          ? { name: meta.name, content: meta.content }
          : { property: meta.property, content: meta.content },
    })
  }
  for (const link of metadata.links ?? []) {
    tags.push({
      tag: 'link',
      key: `rel:${link.rel}:${link.href}`,
      props: { rel: link.rel, href: link.href },
    })
  }
  return tags
}

function wrapRouteComponent(
  Comp: Component<any>,
  metadata: RouteMetadata | undefined,
  loading: Component<any> | undefined,
  error: Component<ErrorComponentProps> | undefined,
): Component<any> {
  const DevError: Component<ErrorComponentProps> = (props) => {
    if (DEV) {
      console.error(untrack(() => props.error))
    }
    return null
  }
  const ErrorComp = error ?? DevError

  return (props) => {
    if (metadata) {
      useHead(() => metadataToHeadTags(metadata))
    }
    return createComponent(Errored, {
      fallback: (err: () => unknown, reset: () => void) =>
        createComponent(ErrorComp, {
          get error() {
            return err()
          },
          reset,
        }),
      get children() {
        return loading
          ? createComponent(Loading, {
              get fallback() {
                return createComponent(loading, props)
              },
              get children() {
                return createComponent(Comp, props)
              },
            })
          : createComponent(Comp, props)
      },
    })
  }
}

interface AdaptResult {
  routes: RouteEntry[]
  routeInfo: Record<string, unknown>
  routeMetadata: Record<string, RouteMetadata>
}

/**
 * Depth-first adaptation of the official `fileRoutes()` route-definition
 * tree: inherited loading/error boundaries, `useHead` metadata and
 * production draft filtering.
 */
export function adaptFileRoutes(entries: readonly RouteEntry[]): AdaptResult {
  const routeInfo: Record<string, unknown> = {}
  const routeMetadata: Record<string, RouteMetadata> = {}

  const visit = (
    entry: RouteEntry,
    parent: InheritContext,
    parentPath: string,
  ): RouteEntry | undefined => {
    if (!DEV && entry.draft === true) {
      return undefined
    }
    const loading = inheritAllowed(entry.inherit, 'loading')
      ? (entry.loadingComponent ?? parent.loading)
      : entry.loadingComponent
    const error = inheritAllowed(entry.inherit, 'error')
      ? (entry.errorComponent ?? parent.error)
      : entry.errorComponent
    const childPath = typeof entry.path === 'string' ? entry.path : ''
    const path = (parentPath.endsWith('/') ? parentPath.slice(0, -1) : parentPath) + childPath
    const info = entry.info as Record<string, unknown> | undefined
    if (info) {
      routeInfo[path || '/'] = info
    }
    if (entry.metadata) {
      routeMetadata[path || '/'] = entry.metadata
    }
    const children = entry.children
      ? (Array.isArray(entry.children) ? entry.children : [entry.children])
          .map((child) => visit(child, { loading, error }, path))
          .filter((child): child is RouteEntry => !!child)
      : undefined
    const { loadingComponent: _l, errorComponent: _e, inherit: _i, metadata, draft: _d, ...rest } = entry
    return {
      ...rest,
      component:
        entry.component || loading || error || metadata
          ? wrapRouteComponent(entry.component ?? (() => null), metadata, loading, error)
          : undefined,
      children: children?.length ? children : undefined,
    }
  }

  const routes = entries
    .map((entry) => visit(entry, {}, ''))
    .filter((entry): entry is RouteEntry => !!entry)

  return { routes, routeInfo, routeMetadata }
}
