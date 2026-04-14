import { glob } from 'tinyglobby'
import { normalizePath } from 'vite'

import { createLogHeader, formatDuration, logger } from '../const'

import { generateDefinition } from './definition'
import type { InheritanceConfig } from './definition'
import { invalidateCache } from './extract'
import type { InfoTypeDefinition } from './route-type'
import { generateRouteTypes } from './route-type'

interface RouteRegistryOption {
  baseDir: string
  ignore: string[]
  output: string
  infoDts?: InfoTypeDefinition
  verboseLog?: boolean
  inheritance: InheritanceConfig
}

interface DefinitionMode {
  ssr: boolean
}

const REG_IS_ROUTE_FILE = /\.(jsx|tsx|mdx)$/
export class RouteRegistry {
  private root = ''
  private initialized = false
  private version = 0
  private typesVersion = -1
  private files = new Set<string>()
  private readonly definitionCache = new Map<string, { version: number; code: string }>()
  private readonly routesFilter: string

  constructor(private readonly options: RouteRegistryOption) {
    const baseDir = normalizePath(options.baseDir).replace(/\/$/, '')
    this.routesFilter = `${baseDir ? `${baseDir}/` : ''}src/pages/**/*.{jsx,tsx,mdx}`
  }

  setRoot(root: string) {
    this.root = normalizePath(root)
  }

  private logVerbose(message: string, timestamp = true) {
    if (!this.options.verboseLog) {
      return
    }
    logger.info(`routes: ${message}`, { timestamp })
  }

  isRouteFile(file: string): boolean {
    const normalized = normalizePath(file)
    return normalized.startsWith(`${this.pagesDir}/`) && REG_IS_ROUTE_FILE.test(normalized)
  }

  async ensureInitialized() {
    if (this.initialized) {
      return
    }

    const start = Date.now()
    const files = await glob(this.routesFilter, {
      cwd: this.root,
      ignore: this.options.ignore,
      absolute: true,
    })

    this.files = new Set(files.map((file) => normalizePath(file)))
    this.initialized = true
    this.version++
    this.logVerbose(
      `${createLogHeader('Registry Initialized')}
${alignKeyValue([
  ['Files', this.files.size],
  ['Time', formatDuration(Date.now() - start)],
])}`,
      false,
    )
  }

  markChanged(file: string) {
    const normalized = normalizePath(file)
    if (!this.isRouteFile(normalized)) {
      return
    }
    invalidateCache(normalized)
    this.logVerbose(`Cache invalidated: ${normalized}`)
  }

  async addFile(file: string): Promise<boolean> {
    await this.ensureInitialized()
    const normalized = normalizePath(file)
    if (!this.isRouteFile(normalized) || this.files.has(normalized)) {
      return false
    }
    this.files.add(normalized)
    this.bumpVersion()
    this.logVerbose(`Route added: ${normalized}`)
    return true
  }

  async removeFile(file: string): Promise<boolean> {
    await this.ensureInitialized()
    const normalized = normalizePath(file)
    if (!this.files.delete(normalized)) {
      return false
    }
    invalidateCache(normalized)
    this.bumpVersion()
    this.logVerbose(`Route removed: ${normalized}`)
    return true
  }

  async getDefinition(mode: DefinitionMode) {
    await this.ensureInitialized()

    const key = `${mode.ssr}`
    const cached = this.definitionCache.get(key)
    if (cached?.version === this.version) {
      this.logVerbose(`Cache hit: virtual:routes (${key})`)
      return cached.code
    }

    const files = this.getFiles()
    const start = Date.now()
    const code = await generateDefinition(
      files,
      this.options.verboseLog,
      this.options.inheritance,
      mode.ssr,
    )

    if (!mode.ssr && this.typesVersion !== this.version) {
      generateRouteTypes(
        files,
        normalizePath(`${this.root}/${this.options.output}`),
        this.options.infoDts,
      )
      this.typesVersion = this.version
      this.logVerbose(`Route types generated for ${files.length} routes`, false)
    }

    this.definitionCache.set(key, { version: this.version, code })
    this.logVerbose(
      `${createLogHeader('Virtual Module Generated')}
${alignKeyValue([
  ['Routes', files.length],
  ['Time', formatDuration(Date.now() - start)],
  ['Mode', mode.ssr ? 'SSR' : 'Client'],
])}`,
      false,
    )
    return code
  }

  private getFiles() {
    return [...this.files].sort()
  }

  private bumpVersion() {
    this.version++
    this.typesVersion = -1
    this.definitionCache.clear()
  }

  private get pagesDir() {
    const baseDir = normalizePath(this.options.baseDir).replace(/\/$/, '')
    return `${this.root}/${baseDir ? `${baseDir}/` : ''}src/pages`.replace(/\/+/g, '/')
  }
}

function alignKeyValue(entries: Array<[string, string | number]>, minKeyWidth = 12): string {
  const maxKeyLen = Math.max(...entries.map(([key]) => key.length), minKeyWidth)
  return entries.map(([key, value]) => `${String(key).padEnd(maxKeyLen)} : ${value}`).join('\n')
}
