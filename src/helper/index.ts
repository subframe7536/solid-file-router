import type { Plugin } from 'vite'
import { ID_HELPER, VID_HELPER, VID_HELPER_RESOLVED } from '../const'

declare const __LOADER__: string

export const helper: Plugin = {
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
}
