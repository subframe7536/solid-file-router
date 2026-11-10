declare module 'virtual:routes' {
  /** A code-split ref: the delivery adapter emits it as a dynamic import. */
  export interface FileRouteLazyRef<M = Record<string, unknown>> {
    src: string
    import(): Promise<M>
  }
  /** An eager ref: its picked exports are imported statically. */
  export interface FileRouteEagerRef<M = Record<string, unknown>> {
    src?: string
    require(): M
  }
  export interface FileRouteEntry {
    path: string
    page?: boolean
    server?: boolean
    $component?: FileRouteLazyRef<any> | FileRouteEagerRef<any>
    $$route?: FileRouteEagerRef<any>
    [key: string]: unknown
  }
  export interface FileRouteTreeEntry extends FileRouteEntry {
    id: string
    children?: readonly FileRouteTreeEntry[]
  }
  const routes: readonly FileRouteEntry[]
  export default routes
  export const pageRoutes: readonly FileRouteTreeEntry[]
}

declare module '*.mdx' {
  import type { Component } from 'solid-js'

  export interface MDXContentProps {
    components?: Record<string, Component<any>>
  }

  export const frontmatter: Record<string, unknown>
  export const route: Record<string, unknown>

  const MDXContent: Component<MDXContentProps>
  export default MDXContent
}

declare module '*.md' {
  import type { Component } from 'solid-js'

  export interface MDXContentProps {
    components?: Record<string, Component<any>>
  }

  export const frontmatter: Record<string, unknown>
  export const route: Record<string, unknown>

  const MDXContent: Component<MDXContentProps>
  export default MDXContent
}
