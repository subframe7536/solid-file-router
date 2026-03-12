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

export const logger = createLogger('info', { prefix: `[${name}]` })
