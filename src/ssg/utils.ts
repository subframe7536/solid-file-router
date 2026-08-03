import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { generateHydrationScript } from 'solid-js/web'
import type { ResolvedConfig } from 'vite'
import { normalizePath } from 'vite'

import type { RouteMetadata } from '../metadata'
import { getLinkIdentity, getMetaIdentity, normalizeRouteMetadata } from '../metadata-shared'

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

export interface SsgRenderResult {
  html: string
  metadata?: RouteMetadata
}

export type SsgRenderOutput = string | SsgRenderResult

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
const HEAD_BASELINE_ATTRIBUTE = 'data-solid-file-router-head-default'

function trimTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value.codePointAt(end - 1) === SLASH_CODE_POINT) {
    end -= 1
  }
  return value.slice(0, end)
}

export function normalizeRoutePath(route: string): string {
  const hasControlCharacter = [...route].some((character) => {
    const codePoint = character.codePointAt(0)!
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159)
  })
  if (route.includes('?') || route.includes('#') || route.includes('\\') || hasControlCharacter) {
    throw new Error(
      `[solid-file-router] Invalid prerender route; expected a pathname without query, hash, or backslash: ${route}`,
    )
  }

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
): Promise<(props: { url: string }) => Promise<SsgRenderOutput>> {
  const serverOutDir = config.environments?.[ENVIRONMENT.SERVER]?.build?.outDir
  if (!serverOutDir) {
    throw new Error('Missing SSG server environment output directory')
  }

  const serverEntryUrl = pathToFileURL(path.join(config.root, serverOutDir, entryFileName)).href
  return import(`${serverEntryUrl}?${CACHE_BUST_PARAM}=${Date.now()}`).then((module) => {
    const exported = module.default ?? module
    return Promise.resolve(exported).then((renderer) => {
      if (typeof renderer !== 'function') {
        throw new TypeError('[solid-file-router] SSG server entry must export a renderer function')
      }
      return renderer
    })
  })
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll("'", '&#39;')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceOrInsertHeadTag(html: string, pattern: RegExp, replacement: string): string {
  return pattern.test(html)
    ? html.replace(pattern, replacement)
    : html.replace(/<\/head\s*>/i, `${replacement}\n</head>`)
}

function replaceOrInsertHeadTags(
  html: string,
  pattern: RegExp,
  replacements: readonly string[],
): string {
  const globalPattern = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`)
  const matches = [...html.matchAll(globalPattern)]
  const replacement = replacements.join('\n')
  if (matches.length === 0) {
    return html.replace(/<\/head\s*>/i, `${replacement}\n</head>`)
  }

  let output = ''
  let cursor = 0
  for (const [index, match] of matches.entries()) {
    const start = match.index ?? 0
    output += html.slice(cursor, start)
    if (index === 0) {
      output += replacement
    }
    cursor = start + match[0].length
  }
  return output + html.slice(cursor)
}

function metadataMetaPattern(attribute: 'name' | 'property', value: string): RegExp {
  return new RegExp(
    `<meta\\s+[^>]*\\b${attribute}\\s*=\\s*["']${escapeRegExp(value)}["'][^>]*>`,
    'i',
  )
}

function metadataLinkPattern(rel: string): RegExp {
  return new RegExp(`<link\\s+[^>]*\\brel\\s*=\\s*["']${escapeRegExp(rel)}["'][^>]*>`, 'i')
}

function decodeHtmlAttribute(value: string): string {
  return value.replace(
    /&(?:amp|quot|apos|#39|lt|gt);/gi,
    (entity) =>
      ({
        '&amp;': '&',
        '&quot;': '"',
        '&apos;': "'",
        '&#39;': "'",
        '&lt;': '<',
        '&gt;': '>',
      })[entity.toLowerCase()] ?? entity,
  )
}

function readHtmlAttribute(tag: string, attribute: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${attribute}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i'))
  return match ? decodeHtmlAttribute(match[2]) : undefined
}

function appendBaselineEntry(
  entries: Record<string, string[]>,
  identity: string | undefined,
  tag: string,
): void {
  if (identity) {
    const tags = entries[identity] ?? []
    tags.push(tag)
    entries[identity] = tags
  }
}

function createHeadBaseline(html: string): {
  title: string | null
  meta: Record<string, string[]>
  links: Record<string, string[]>
} {
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i)?.[1] ?? ''
  const title = head.match(/<title\b[^>]*>[\s\S]*?<\/title\s*>/i)?.[0] ?? null
  const meta: Record<string, string[]> = {}
  for (const match of head.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0]
    const name = readHtmlAttribute(tag, 'name')
    const property = readHtmlAttribute(tag, 'property')
    appendBaselineEntry(meta, getMetaIdentity(name, property), tag)
  }
  const links: Record<string, string[]> = {}
  for (const match of head.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0]
    const rel = readHtmlAttribute(tag, 'rel')
    appendBaselineEntry(links, rel === undefined ? undefined : getLinkIdentity(rel), tag)
  }
  return { title, meta, links }
}

function serializeHeadBaseline(baseline: ReturnType<typeof createHeadBaseline>): string {
  return JSON.stringify(baseline)
    .replaceAll('&', '\\u0026')
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
}

function insertHeadBaseline(html: string, baseline: ReturnType<typeof createHeadBaseline>): string {
  const script = `<script type="application/json" ${HEAD_BASELINE_ATTRIBUTE}>${serializeHeadBaseline(baseline)}</script>`
  if (html.includes(HEAD_MARKER)) {
    return html.replace(HEAD_MARKER, `${script}${HEAD_MARKER}`)
  }
  return html.replace(/<\/head\s*>/i, `${script}</head>`)
}

function replaceRootOutlet(html: string, id: string, app: string): string | undefined {
  const escapedId = escapeRegExp(id)
  const openingPattern = new RegExp(
    `<([a-z][\\w:-]*)\\b([^>]*\\bid\\s*=\\s*(['"])${escapedId}\\3[^>]*)>`,
    'i',
  )
  const opening = openingPattern.exec(html)
  if (!opening) {
    return undefined
  }

  const openingEnd = opening.index + opening[0].length
  if (/\/\s*>$/.test(opening[0])) {
    const attributes = opening[2].replace(/\/\s*$/, '')
    return `${html.slice(0, opening.index)}<${opening[1]}${attributes}>${app}</${opening[1]}>${html.slice(openingEnd)}`
  }

  const tokenPattern = new RegExp(`<\\/?${escapeRegExp(opening[1])}\\b[^>]*>`, 'gi')
  tokenPattern.lastIndex = openingEnd
  let depth = 1
  let token: RegExpExecArray | null
  while ((token = tokenPattern.exec(html))) {
    if (token[0].startsWith('</')) {
      depth -= 1
    } else if (!/\/\s*>$/.test(token[0])) {
      depth += 1
    }
    if (depth === 0) {
      return html.slice(0, openingEnd) + app + html.slice(token.index)
    }
  }

  return undefined
}

export function applyRouteMetadataToHtml(html: string, metadata?: RouteMetadata): string {
  if (!metadata) {
    return html
  }

  let output = html
  if (metadata.title !== undefined) {
    output = replaceOrInsertHeadTag(
      output,
      /<title\b[^>]*>[\s\S]*?<\/title>/i,
      `<title>${escapeHtml(metadata.title)}</title>`,
    )
  }
  const normalized = normalizeRouteMetadata(metadata)
  for (const tags of normalized.meta.values()) {
    const first = tags[0]
    if (!first) {
      continue
    }
    const attribute = first.name !== undefined ? 'name' : 'property'
    const value = first.name ?? first.property
    if (value === undefined) {
      continue
    }
    const replacements = tags.map((tag) => {
      const attributes = [
        tag.name === undefined ? undefined : `name="${escapeHtml(tag.name)}"`,
        tag.property === undefined ? undefined : `property="${escapeHtml(tag.property)}"`,
        `content="${escapeHtml(tag.content)}"`,
      ]
        .filter((item): item is string => item !== undefined)
        .join(' ')
      return `<meta ${attributes}>`
    })
    output = replaceOrInsertHeadTags(output, metadataMetaPattern(attribute, value), replacements)
  }
  for (const [identity, links] of normalized.links) {
    const rel = identity.slice('rel:'.length)
    output = replaceOrInsertHeadTags(
      output,
      metadataLinkPattern(rel),
      links.map((link) => `<link rel="${escapeHtml(link.rel)}" href="${escapeHtml(link.href)}">`),
    )
  }
  return output
}

export function renderTemplate(
  template: string,
  id: string,
  app: string,
  metadata?: RouteMetadata,
): string {
  const markerCount = template.split(OUTLET_MARKER).length - 1
  if (markerCount > 1) {
    throw new Error(`[solid-file-router] SSG found duplicate ${OUTLET_MARKER} markers`)
  }

  let rendered = template
  if (markerCount === 1) {
    rendered = rendered.replace(OUTLET_MARKER, `<div id="${id}">${app}</div>`)
  } else {
    const replaced = replaceRootOutlet(rendered, id, app)
    if (!replaced) {
      throw new Error(
        `[solid-file-router] SSG could not find an outlet in ${INDEX_HTML_FILE_NAME}.\nAdd ${OUTLET_MARKER} or an element with id="${id}".`,
      )
    }
    rendered = replaced
  }

  const baseline = metadata ? createHeadBaseline(rendered) : undefined
  rendered = applyRouteMetadataToHtml(rendered, metadata)
  if (baseline) {
    rendered = insertHeadBaseline(rendered, baseline)
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
