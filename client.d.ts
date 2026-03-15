declare module 'virtual:routes' {
  import type { RouteDefinition } from '@solidjs/router'
  import type { Component, JSXElement } from 'solid-js'
  export const Root: Component
  export const fileRoutes: RouteDefinition
  export const FileRouter: (props: { base?: string; url?: string }) => JSXElement
}
