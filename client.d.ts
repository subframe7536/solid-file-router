declare module 'virtual:routes' {
  import type { RouteDefinition, Router } from '@solidjs/router'
  import type { FileRouteInfoMap, FileRouteMetadataMap } from 'solid-file-router'
  import type { Component, JSXElement } from 'solid-js'

  export const Root: Component
  export const fileRoutes: RouteDefinition
  export const routeInfo: FileRouteInfoMap
  export const routeMetadata: FileRouteMetadataMap
  /**
   * Wrap `@solidjs/router` 's `Router` with `root` and `children` from file system
   */
  export const FileRouter: typeof Router
}

declare module '*.mdx' {
  import type { Component } from 'solid-js'

  export interface MDXContentProps {
    components?: Record<string, Component<any>>
  }

  export const frontmatter: Record<string, unknown>

  const MDXContent: Component<MDXContentProps>
  export default MDXContent
}

declare module '*.md' {
  import type { Component } from 'solid-js'

  export interface MDXContentProps {
    components?: Record<string, Component<any>>
  }

  export const frontmatter: Record<string, unknown>

  const MDXContent: Component<MDXContentProps>
  export default MDXContent
}
