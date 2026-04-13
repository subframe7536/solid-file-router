import type { Plugin } from 'vite'

import {
  ID_HELPER,
  VID_CLIENT_ENTRY,
  VID_CLIENT_ENTRY_RESOLVED,
  VID_HELPER,
  VID_HELPER_RESOLVED,
} from '../const'

declare const __LOADER__: string

const clientEntryHelper = `
import { render } from 'solid-js/web'

export function mountRouterApp(component, elementId = 'app') {
  const element = document.getElementById(elementId)
  if (!element) {
    throw new Error(\`Mount element with id "\${elementId}" not found\`)
  }

  element.textContent = ''
  return render(component, element)
}
`

export const helper: Plugin = {
  name: ID_HELPER,
  resolveId: {
    filter: {
      id: new RegExp(`${VID_HELPER}|${VID_CLIENT_ENTRY}`),
    },
    handler(id) {
      if (id === VID_CLIENT_ENTRY) {
        return VID_CLIENT_ENTRY_RESOLVED
      }
      return VID_HELPER_RESOLVED
    },
  },
  load: {
    filter: {
      id: new RegExp(`${VID_HELPER_RESOLVED}|${VID_CLIENT_ENTRY_RESOLVED}`),
    },
    handler(id) {
      if (id === VID_CLIENT_ENTRY_RESOLVED) {
        return clientEntryHelper
      }
      return __LOADER__
    },
  },
}
