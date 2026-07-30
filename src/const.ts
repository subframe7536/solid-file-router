import { createLogger } from 'vite'

import { name } from '../package.json'

export const PACKAGE_NAME = name

export const VID_EXTRACT = `virtual:routes`
export const VID_EXTRACT_RESOLVED = `\0${VID_EXTRACT}`

export const logger = createLogger('info', { prefix: `[${name}]` })

/** FNV-1a hash for stable route import names. */
export function hashString(value: string): string {
  let hash = 2166136261

  for (let index = 0; index < value.length; index++) {
    hash ^= value.codePointAt(index) ?? 0
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(36)
}
