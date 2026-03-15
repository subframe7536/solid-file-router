import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { logger } from '../const'

import type { SSGRenderResult } from './types'

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
  let filePath: string
  if (routePath === '/') {
    filePath = join(outDir, 'index.html')
  } else {
    const clean = routePath.replace(/^\/|\/$/g, '')
    filePath = join(outDir, clean + '.html')
  }

  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, html)
  logger.info(`  ${routePath} -> ${filePath}`)
}

export function readTemplate(outDir: string): string {
  return readFileSync(join(outDir, 'index.html'), 'utf-8')
}
