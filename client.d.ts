declare module 'virtual:routes' {
  import type { Component, JSXElement } from 'solid-js'
  import type { RouteDefinition } from '@solidjs/router'
  export const Root: Component
  export const fileRoutes: RouteDefinition
  export const FileRouter: (props: { base?: string }) => JSXElement
}
