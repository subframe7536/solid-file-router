import { name } from '../package.json'

export const PACKAGE_NAME = name

export const ID_EXTRACT = `${name}:extract`
export const VID_EXTRACT = `virtual:routes`
export const VID_EXTRACT_RESOLVED = `\0${VID_EXTRACT}`

export const ID_HELPER = `${name}:helper`
export const VID_HELPER = `virtual:${name}-helper`
export const VID_HELPER_RESOLVED = `\0${VID_HELPER}`
