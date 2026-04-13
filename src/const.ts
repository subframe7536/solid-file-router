import { createLogger } from 'vite'

import { name } from '../package.json'

export const PACKAGE_NAME = name
export const VID_RESOLVED_PREFIX = `\0`

export const ID_EXTRACT = `${name}:extract`
export const VID_EXTRACT = `virtual:routes`
export const VID_EXTRACT_RESOLVED = VID_RESOLVED_PREFIX + VID_EXTRACT
export const VID_ROUTE_INFO = `virtual:route-info`
export const VID_ROUTE_INFO_RESOLVED = VID_RESOLVED_PREFIX + VID_ROUTE_INFO

export const ID_HELPER = `${name}:helper`
export const VID_HELPER = `virtual:${name}-helper`
export const VID_HELPER_RESOLVED = VID_RESOLVED_PREFIX + VID_HELPER
export const VID_CLIENT_ENTRY = `virtual:${name}-client-entry`
export const VID_CLIENT_ENTRY_RESOLVED = VID_RESOLVED_PREFIX + VID_CLIENT_ENTRY

export const logger = createLogger('info', { prefix: `[${name}]` })
