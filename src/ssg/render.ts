import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { SSGRenderResult } from './types'

const SLOT_APP = '<!--ssr-outlet-->'
const SLOT_HEAD = '<!--ssr-head-->'
const SLOT_ASSETS = '<!--ssr-assets-->'

function withHTMLSlots(template: string, mountId: string) {
  let html = template

  const mountSelector = mountId.replace(/^#/, '')
  const mountRegex = new RegExp(`(<[^>]*id=["']${mountSelector}["'][^>]*>)(?:${SLOT_APP})?`)
  if (!html.includes(SLOT_APP)) {
    html = html.replace(mountRegex, `$1${SLOT_APP}`)
  }

  if (!html.includes(SLOT_HEAD) || !html.includes(SLOT_ASSETS)) {
    html = html.replace(
      '</head>',
      `${html.includes(SLOT_HEAD) ? '' : SLOT_HEAD}${html.includes(SLOT_ASSETS) ? '' : SLOT_ASSETS}\n</head>`,
    )
  }

  return html
}

export function injectHTML(template: string, result: SSGRenderResult, mountId: string): string {
  const slots = result.slots ?? {
    app: result.html,
    head: result.head,
    assets: result.assets,
  }

  return withHTMLSlots(template, mountId)
    .replace(SLOT_APP, slots.app || '')
    .replace(SLOT_HEAD, slots.head || '')
    .replace(SLOT_ASSETS, slots.assets || '')
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
