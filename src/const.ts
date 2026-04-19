import { createLogger } from 'vite'

import { name } from '../package.json'

export const PACKAGE_NAME = name

export const VID_EXTRACT = `virtual:routes`
export const VID_EXTRACT_RESOLVED = `\0${VID_EXTRACT}`

export const logger = createLogger('info', { prefix: `[${name}]` })

/**
 * Creates a formatted log header for visual separation
 */
export function createLogHeader(title: string): string {
  const width = 60
  const padding = Math.floor((width - title.length - 2) / 2)
  const left = '─'.repeat(padding)
  const right = '─'.repeat(width - padding - title.length - 2)
  return `\n${left} ${title} ${right}`
}

/**
 * Aligns key-value pairs for clean tabular output
 */
export function alignKeyValue(entries: Array<[string, string | number]>, minKeyWidth = 12): string {
  const maxKeyLen = Math.max(...entries.map(([key]) => key.length), minKeyWidth)
  return entries.map(([key, value]) => `${String(key).padEnd(maxKeyLen)} : ${value}`).join('\n')
}
