import type { Plugin } from 'vite'

import {
  ID_HELPER,
  ID_ROUTER_ENTRY,
  VID_HELPER,
  VID_HELPER_RESOLVED,
  VID_ROUTER_ENTRY,
  VID_ROUTER_ENTRY_RESOLVED,
} from '../const'

declare const __LOADER__: string

function buildRouterEntryHelper(useHydrate = true) {
  const clientRenderer = useHydrate ? 'hydrate' : 'render'
  return `import { createComponent } from 'solid-js'
import { generateHydrationScript, ${clientRenderer}, renderToStringAsync, getAssets } from 'solid-js/web'
import { FileRouter } from 'virtual:routes'

export function renderClient(component, elementId = 'app') {
  const element = document.getElementById(elementId)
  if (!element) {
    throw new Error(\`Mount element with id "\${elementId}" not found\`)
  }

  return ${clientRenderer}(component, element)
}

export function renderServer(options = {}) {
  const {
    Router = FileRouter,
    renderApp,
    extraHead,
    onRenderError,
    transformResult,
  } = options

  return async (url) => {
    const app = () => createComponent(Router, { url })
    const renderContext = { url, Router, getAssets }

    let html
    try {
      html = renderApp ? await renderApp(app, renderContext) : await renderToStringAsync(app)
    } catch (error) {
      if (onRenderError) {
        const handled = await onRenderError(error, renderContext)
        if (handled) {
          return handled
        }
      }
      throw error
    }

    const hydrationScript = generateHydrationScript()
    const extra = extraHead
      ? await extraHead({
          ...renderContext,
          html,
        })
      : getAssets()

    const result = {
      html,
      head: hydrationScript + (extra || ''),
    }

    return transformResult ? await transformResult(result, renderContext) : result
  }
}
`
}

export function createHelperPlugin(hydrateRef: { value: boolean }): Plugin[] {
  return [
    {
      name: ID_HELPER,
      resolveId: {
        filter: {
          id: new RegExp(VID_HELPER),
        },
        handler() {
          return VID_HELPER_RESOLVED
        },
      },
      load: {
        filter: {
          id: new RegExp(VID_HELPER_RESOLVED),
        },
        handler() {
          return __LOADER__
        },
      },
    },
    {
      name: ID_ROUTER_ENTRY,
      resolveId: {
        filter: {
          id: new RegExp(VID_ROUTER_ENTRY),
        },
        handler() {
          return VID_ROUTER_ENTRY_RESOLVED
        },
      },
      load: {
        filter: {
          id: new RegExp(VID_ROUTER_ENTRY_RESOLVED),
        },
        handler() {
          return buildRouterEntryHelper(hydrateRef.value)
        },
      },
    },
  ]
}
