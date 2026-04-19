import { createLogger } from 'vite'

import { name } from '../package.json'

export const PACKAGE_NAME = name

export const VID_EXTRACT = `virtual:routes`
export const VID_EXTRACT_RESOLVED = `\0${VID_EXTRACT}`

export const logger = createLogger('info', { prefix: `[${name}]` })
