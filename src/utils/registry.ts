import { glob } from 'tinyglobby'
import { normalizePath } from 'vite'

import { logger } from '../const'

import { generateDefinition, generateRouteInfoModule } from './definition'
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

export class RouteRegistry {
  private root = ''
  private initialized = false
  private version = 0
  private typesVersion = -1
  private routeInfoVersion = -1
  private files = new Set<string>()
  private readonly definitionCache = new Map<string, { version: number; code: string }>()
  private routeInfoCache = ''
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
    return normalized.startsWith(this.pagesDir + '/') && /\.(jsx|tsx|mdx)$/.test(normalized)
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
    this.logVerbose(`initialized registry (${this.files.size} files, ${Date.now() - start} ms)`)
  }

  markChanged(file: string) {
    const normalized = normalizePath(file)
    if (!this.isRouteFile(normalized)) {
      return
    }
    invalidateCache(normalized)
    this.logVerbose(`invalidated AST cache for ${normalized}`)
  }

  async addFile(file: string): Promise<boolean> {
    await this.ensureInitialized()
    const normalized = normalizePath(file)
    if (!this.isRouteFile(normalized) || this.files.has(normalized)) {
      return false
    }
    this.files.add(normalized)
    this.bumpVersion()
    this.logVerbose(`added route file ${normalized}`)
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
    this.logVerbose(`removed route file ${normalized}`)
    return true
  }

  async getDefinition(mode: DefinitionMode) {
    await this.ensureInitialized()

    const key = `${mode.ssr}`
    const cached = this.definitionCache.get(key)
    if (cached?.version === this.version) {
      this.logVerbose(`reused virtual:routes module (${key})`)
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
      this.logVerbose(`generated route types (${files.length} routes)`, false)
    }

    this.definitionCache.set(key, { version: this.version, code })
    this.logVerbose(
      `generated virtual:routes module (${files.length} routes, ${Date.now() - start} ms)`,
    )
    return code
  }

  async getRouteInfoModule() {
    await this.ensureInitialized()
    if (this.routeInfoVersion === this.version) {
      this.logVerbose(`reused virtual:route-info module`)
      return this.routeInfoCache
    }

    const start = Date.now()
    this.routeInfoCache = generateRouteInfoModule(this.getFiles())
    this.routeInfoVersion = this.version
    this.logVerbose(`generated virtual:route-info module (${Date.now() - start} ms)`)
    return this.routeInfoCache
  }

  private getFiles() {
    return [...this.files].sort()
  }

  private bumpVersion() {
    this.version++
    this.typesVersion = -1
    this.routeInfoVersion = -1
    this.definitionCache.clear()
  }

  private get pagesDir() {
    const baseDir = normalizePath(this.options.baseDir).replace(/\/$/, '')
    return `${this.root}/${baseDir ? `${baseDir}/` : ''}src/pages`.replace(/\/+/g, '/')
  }
}
