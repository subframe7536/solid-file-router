import type { Plugin } from 'vite'

import { PACKAGE_NAME } from '../const'

import { compileMdx } from './router'
import type { MdxOptions } from './router'

const REG_MARKDOWN_MODULE_ID = /\.(?:md|mdx)(?:\?.*)?$/i

/** Compiles Markdown route modules before Solid transforms run. */
export function createMdxPlugin(options: false | MdxOptions): Plugin {
  return {
    name: `${PACKAGE_NAME}:mdx`,
    apply: () => !!options,
    transform: {
      order: 'pre',
      filter: { id: REG_MARKDOWN_MODULE_ID },
      async handler(code, fullId) {
        if (!options) {
          return
        }
        return await compileMdx(code, fullId.split('?')[0]!, options)
      },
    },
  }
}
