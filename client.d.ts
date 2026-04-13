declare module 'virtual:routes' {
  import type { RouteDefinition } from '@solidjs/router'
  import type { Component, JSXElement } from 'solid-js'
  export const Root: Component
  export const fileRoutes: RouteDefinition
  export const FileRouter: (props: { base?: string; url?: string }) => JSXElement
}

declare module 'virtual:route-info' {
  import type { FileRouteInfoMap } from 'solid-file-router'

  export const routeInfo: FileRouteInfoMap
  export default routeInfo
}

declare module 'virtual:solid-file-router-client-entry' {
  import type { JSX } from 'solid-js'

  export function mountRouterApp(component: () => JSX.Element, elementId?: string): unknown
}
