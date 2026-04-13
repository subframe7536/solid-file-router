import type { Plugin } from 'vite'

import {
  ID_HELPER,
  VID_HELPER,
  VID_HELPER_RESOLVED,
  VID_ROUTER_ENTRY,
  VID_ROUTER_ENTRY_RESOLVED,
} from '../const'

declare const __LOADER__: string

const routerEntryHelper = `
import { createComponent } from 'solid-js'
import { generateHydrationScript, hydrate, render, renderToStringAsync } from 'solid-js/web'
import { FileRouter } from 'virtual:routes'

export function renderClient(component, elementId = 'app') {
  const element = document.getElementById(elementId)
  if (!element) {
    throw new Error(\`Mount element with id "\${elementId}" not found\`)
  }

  return (element.hasChildNodes() ? hydrate : render)(component, element)
}

export async function renderServer(options) {
  const {
    url,
    Router = FileRouter,
    renderApp,
    extraHead,
    onRenderError,
    transformResult,
  } = options

  if (!url || typeof url !== 'string') {
    throw new Error('renderServer requires a string url option')
  }

  const app = () => createComponent(Router, { url })
  const renderContext = { url, Router }

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
        hydrationScript,
      })
    : ''

  const result = {
    html,
    head: hydrationScript + (extra || ''),
  }

  return transformResult ? await transformResult(result, renderContext) : result
}
`

export const helper: Plugin = {
  name: ID_HELPER,
  resolveId: {
    filter: {
      id: new RegExp(`${VID_HELPER}|${VID_ROUTER_ENTRY}`),
    },
    handler(id) {
      if (id === VID_ROUTER_ENTRY) {
        return VID_ROUTER_ENTRY_RESOLVED
      }
      return VID_HELPER_RESOLVED
    },
  },
  load: {
    filter: {
      id: new RegExp(`${VID_HELPER_RESOLVED}|${VID_ROUTER_ENTRY_RESOLVED}`),
    },
    handler(id) {
      if (id === VID_ROUTER_ENTRY_RESOLVED) {
        return routerEntryHelper
      }
      return __LOADER__
    },
  },
}
