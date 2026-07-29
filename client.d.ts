declare module 'virtual:routes' {
  import type { RouteDefinition, Router } from '@solidjs/router'
  import type { FileRouteInfoMap } from 'solid-file-router'
  import type { Component, JSXElement } from 'solid-js'

  export const Root: Component
  export const fileRoutes: RouteDefinition
  export const routeInfo: FileRouteInfoMap
  /**
   * Wrap `@solidjs/router` 's `Router` with `root` and `children` from file system
   */
  export const FileRouter: typeof Router
}
