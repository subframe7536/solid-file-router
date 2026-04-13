declare module 'virtual:routes' {
  import type { RouteDefinition } from '@solidjs/router'
  import type { FileRouteInfoMap } from 'solid-file-router'
  import type { Component, JSXElement } from 'solid-js'

  export const Root: Component
  export const fileRoutes: RouteDefinition
  export const routeInfo: FileRouteInfoMap
  export const FileRouter: (props: { base?: string; url?: string }) => JSXElement
}

declare module 'virtual:router-entry' {
  import type { Component, JSX } from 'solid-js'

  export interface RenderServerResult {
    html: string
    head: string
  }

  export interface RenderServerOptions {
    url: string
    Router?: Component<{ url?: string }>
    renderApp?: (
      app: () => JSX.Element,
      context: { url: string; Router: Component<{ url?: string }> },
    ) => Promise<string> | string
    extraHead?: (context: {
      url: string
      Router: Component<{ url?: string }>
      html: string
      hydrationScript: string
    }) => Promise<string | void> | string | void
    onRenderError?: (
      error: unknown,
      context: { url: string; Router: Component<{ url?: string }> },
    ) => Promise<RenderServerResult | void> | RenderServerResult | void
    transformResult?: (
      result: RenderServerResult,
      context: { url: string; Router: Component<{ url?: string }> },
    ) => Promise<RenderServerResult> | RenderServerResult
  }

  export function renderClient(component: () => JSX.Element, elementId?: string): unknown
  export function renderServer(options: RenderServerOptions): Promise<RenderServerResult>
}
