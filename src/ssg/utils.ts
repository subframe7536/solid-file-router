import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { generateHydrationScript } from 'solid-js/web'
import type { ResolvedConfig } from 'vite'
import { normalizePath } from 'vite'

export type Awaitable<T> = T | Promise<T>
/** A static route list or lazy route producer used by SSG. */
export type PrerenderRoutesSource = readonly string[] | (() => Awaitable<readonly string[]>)

export type BundleAsset = {
  type: 'asset'
  fileName: string
  source: string | Uint8Array
}
export type BundleChunk = {
  type: 'chunk'
  fileName: string
  facadeModuleId?: string | null
  isEntry?: boolean
}
export type BundleOutput = Record<string, BundleAsset | BundleChunk>

export const ENVIRONMENT = {
  CLIENT: 'client',
  SERVER: 'ssr',
} as const
export type EnvironmentName = (typeof ENVIRONMENT)[keyof typeof ENVIRONMENT]

const INDEX_HTML_FILE_NAME = 'index.html'
export const DEFAULT_PRERENDER_CONCURRENCY = 4
const CACHE_BUST_PARAM = 't'
const SLASH_CODE_POINT = '/'.codePointAt(0)!
export const ID_PRERENDER = 'virtual:solid-file-router/prerender-entry'
export const VID_PRERENDER = `\0${ID_PRERENDER}`
const OUTLET_MARKER = '<!--solid-file-router-outlet-->'
const HEAD_MARKER = '<!--solid-file-router-head-->'

function trimTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value.codePointAt(end - 1) === SLASH_CODE_POINT) {
    end -= 1
  }
  return value.slice(0, end)
}

export function normalizeRoutePath(route: string): string {
  const trimmedRoute = route.trim()
  if (!trimmedRoute || trimmedRoute === '/') {
    return '/'
  }

  const withLeadingSlash = trimmedRoute.startsWith('/') ? trimmedRoute : `/${trimmedRoute}`
  if (withLeadingSlash.split('/').some((segment) => segment === '..' || segment === '.')) {
    throw new Error(
      `[solid-file-router] Invalid prerender route outside output directory: ${route}`,
    )
  }
  return trimTrailingSlashes(withLeadingSlash) || '/'
}

export function getPrerenderAssetFileName(route: string): string {
  const normalizedRoute = normalizeRoutePath(route)
  if (normalizedRoute === '/') {
    return INDEX_HTML_FILE_NAME
  }

  const segments = normalizedRoute.slice(1).split('/')
  const lastSegment = segments.pop()!
  return path.posix.join(...segments, `${lastSegment}.html`)
}

export function findIndexHtmlAsset(bundle: BundleOutput): BundleAsset {
  const htmlAsset = Object.values(bundle).find(
    (item): item is BundleAsset => item.type === 'asset' && item.fileName === INDEX_HTML_FILE_NAME,
  )
  if (!htmlAsset) {
    throw new Error(`Missing client ${INDEX_HTML_FILE_NAME} asset in bundle`)
  }
  return htmlAsset
}

export function findSsrEntryChunk(
  bundle: BundleOutput,
  entryModuleId: string,
): BundleChunk | undefined {
  return Object.values(bundle)
    .filter((item): item is BundleChunk => item.type === 'chunk' && !!item.isEntry)
    .find((item) => normalizePath(item.facadeModuleId ?? '') === normalizePath(entryModuleId))
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++
      const item = items[currentIndex]
      if (item !== undefined) {
        results[currentIndex] = await mapper(item, currentIndex)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
  return results
}

export async function loadServerRenderer(
  config: ResolvedConfig,
  entryFileName: string,
): Promise<any> {
  const serverOutDir = config.environments?.[ENVIRONMENT.SERVER]?.build?.outDir
  if (!serverOutDir) {
    throw new Error('Missing SSG server environment output directory')
  }

  const serverEntryUrl = pathToFileURL(path.join(config.root, serverOutDir, entryFileName)).href
  return import(`${serverEntryUrl}?${CACHE_BUST_PARAM}=${Date.now()}`).then(
    (module) => module.default ?? module,
  )
}

export function renderTemplate(template: string, id: string, app: string): string {
  const markerCount = template.split(OUTLET_MARKER).length - 1
  if (markerCount > 1) {
    throw new Error(`[solid-file-router] SSG found duplicate ${OUTLET_MARKER} markers`)
  }

  let rendered = template
  if (markerCount === 1) {
    rendered = rendered.replace(OUTLET_MARKER, `<div id="${id}">${app}</div>`)
  } else {
    const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const rootPattern = new RegExp(
      `<([a-z][\\w:-]*)\\b([^>]*\\bid\\s*=\\s*(['"])${escapedId}\\3[^>]*)>[\\s\\S]*?</\\1>`,
      'i',
    )
    if (!rootPattern.test(rendered)) {
      throw new Error(
        `[solid-file-router] SSG could not find an outlet in ${INDEX_HTML_FILE_NAME}.\nAdd ${OUTLET_MARKER} or an element with id="${id}".`,
      )
    }
    rendered = rendered.replace(
      rootPattern,
      (_match, tag, attributes) => `<${tag}${attributes}>${app}</${tag}>`,
    )
  }

  const headAssets = generateHydrationScript()
  if (rendered.includes(HEAD_MARKER)) {
    return rendered.replace(HEAD_MARKER, headAssets)
  }
  if (!/<\/head\s*>/i.test(rendered)) {
    throw new Error(
      `[solid-file-router] SSG could not find </head> or ${HEAD_MARKER} in ${INDEX_HTML_FILE_NAME}`,
    )
  }
  return rendered.replace(/<\/head\s*>/i, `${headAssets}</head>`)
}
