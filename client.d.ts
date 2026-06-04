declare module 'virtual:routes' {
  import type { RouteDefinition } from '@solidjs/router'
  import type { FileRouteInfoMap } from 'solid-file-router'
  import type { Component, JSXElement } from 'solid-js'

  export const Root: Component
  export const fileRoutes: RouteDefinition
  export const routeInfo: FileRouteInfoMap
  export const FileRouter: (props: { base?: string; url?: string }) => JSXElement
}
