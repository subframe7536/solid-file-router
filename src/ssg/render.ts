import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { SSGRenderResult } from './types'

/**
 * Writes the raw HTML template as `fallback.html` in the output directory.
 *
 * This provides an SPA shell fallback for static file servers (e.g. Cloudflare Pages)
 * that serve `fallback.html` for requests that do not match any prerendered route.
 * Must be called before rendering individual routes so the fallback is always available.
 */
export function writeFallback(outDir: string, template: string): void {
  writeFileSync(join(outDir, 'fallback.html'), template)
}

export function injectHTML(template: string, result: SSGRenderResult, mountId: string): string {
  let html = template

  // Inject rendered HTML into mount element
  const mountSelector = mountId.replace(/^#/, '')
  const mountRegex = new RegExp(`(<div[^>]*id=["']${mountSelector}["'][^>]*>)(<!--[^>]*-->)?`)
  html = html.replace(mountRegex, `$1${result.html}`)

  // Inject head content (e.g. hydration script)
  if (result.head) {
    html = html.replace('</head>', `${result.head}\n</head>`)
  }

  return html
}

export function writeRoute(outDir: string, routePath: string, html: string): void {
  const path = routePath === '/' ? 'index.html' : `${routePath.replace(/^\/|\/$/g, '')}.html`
  const filePath = join(outDir, path)

  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, html)
}

export function readTemplate(outDir: string): string {
  return readFileSync(join(outDir, 'index.html'), 'utf-8')
}
