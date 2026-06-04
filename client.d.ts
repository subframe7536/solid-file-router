declare module 'virtual:routes' {
  import type { RouteDefinition } from '@solidjs/router'
  import type { FileRouteInfoMap } from 'solid-file-router'
  import type { Component, JSXElement } from 'solid-js'

  export interface ServerEntryProps {
    url: string
  }
  export interface CreateServerEntryOptions<Props extends ServerEntryProps = ServerEntryProps> {
    render?: (app: () => JSXElement, props: Props) => string | Promise<string>
    getRouterProps?: (props: Props) => {
      base?: string
      url?: string
    }
    createApp?: (props: Props) => JSXElement
  }

  export const Root: Component
  export const fileRoutes: RouteDefinition
  export const routeInfo: FileRouteInfoMap
  export const FileRouter: (props: { base?: string; url?: string }) => JSXElement
  export function createServerEntry<Props extends ServerEntryProps = ServerEntryProps>(
    options?: CreateServerEntryOptions<Props>,
  ): (props: Props) => Promise<string>
}
