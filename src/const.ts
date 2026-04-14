import { createLogger } from 'vite'

import { name } from '../package.json'

export const PACKAGE_NAME = name
export const VID_RESOLVED_PREFIX = `\0`

export const ID_EXTRACT = `${name}:extract`
export const VID_EXTRACT = `virtual:routes`
export const VID_EXTRACT_RESOLVED = VID_RESOLVED_PREFIX + VID_EXTRACT

export const ID_HELPER = `${name}:helper`
export const VID_HELPER = `virtual:${name}-helper`
export const VID_HELPER_RESOLVED = VID_RESOLVED_PREFIX + VID_HELPER
export const VID_ROUTER_ENTRY = `virtual:router-entry`
export const VID_ROUTER_ENTRY_RESOLVED = VID_RESOLVED_PREFIX + VID_ROUTER_ENTRY

export const logger = createLogger('info', { prefix: `[${name}]` })

/**
 * Creates a formatted log header for visual separation
 */
export function createLogHeader(title: string): string {
  const width = 60
  const padding = Math.floor((width - title.length - 2) / 2)
  const left = '─'.repeat(padding)
  const right = '─'.repeat(width - padding - title.length - 2)
  return ` ${left} ${title} ${right}`
}

/**
 * Formats a duration in milliseconds with appropriate units
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`
  }
  return `${(ms / 1000).toFixed(2)}s`
}

/**
 * Aligns key-value pairs for clean tabular output
 */
export function alignKeyValue(
  entries: Array<[string, string | number]>,
  minKeyWidth = 12,
): string {
  const maxKeyLen = Math.max(...entries.map(([key]) => key.length), minKeyWidth)
  return entries.map(([key, value]) => `${String(key).padEnd(maxKeyLen)} : ${value}`).join('\n')
}
