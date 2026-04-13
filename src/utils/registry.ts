import { glob } from 'tinyglobby'
import { normalizePath } from 'vite'

import { generateDefinition, generateRouteInfoModule } from './definition'
import type { InfoTypeDefinition } from './route-type'
import { generateRouteTypes } from './route-type'
import { invalidateCache } from './extract'
import type { InheritanceConfig } from './definition'

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
  ssgClient: boolean
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

  isRouteFile(file: string): boolean {
    const normalized = normalizePath(file)
    return normalized.startsWith(this.pagesDir + '/') && /\.(jsx|tsx|mdx)$/.test(normalized)
  }

  async ensureInitialized() {
    if (this.initialized) {
      return
    }

    const files = await glob(this.routesFilter, {
      cwd: this.root,
      ignore: this.options.ignore,
      absolute: true,
    })

    this.files = new Set(files.map((file) => normalizePath(file)))
    this.initialized = true
    this.version++
  }

  markChanged(file: string) {
    const normalized = normalizePath(file)
    if (!this.isRouteFile(normalized)) {
      return
    }
    invalidateCache(normalized)
  }

  async addFile(file: string): Promise<boolean> {
    await this.ensureInitialized()
    const normalized = normalizePath(file)
    if (!this.isRouteFile(normalized) || this.files.has(normalized)) {
      return false
    }
    this.files.add(normalized)
    this.bumpVersion()
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
    return true
  }

  async getDefinition(mode: DefinitionMode) {
    await this.ensureInitialized()

    const key = `${mode.ssr}:${mode.ssgClient}`
    const cached = this.definitionCache.get(key)
    if (cached?.version === this.version) {
      return cached.code
    }

    const files = this.getFiles()
    const code = await generateDefinition(
      files,
      this.options.verboseLog,
      this.options.inheritance,
      mode.ssr,
      mode.ssgClient,
    )

    if (!mode.ssr && this.typesVersion !== this.version) {
      generateRouteTypes(files, normalizePath(`${this.root}/${this.options.output}`), this.options.infoDts)
      this.typesVersion = this.version
    }

    this.definitionCache.set(key, { version: this.version, code })
    return code
  }

  async getRouteInfoModule() {
    await this.ensureInitialized()
    if (this.routeInfoVersion === this.version) {
      return this.routeInfoCache
    }

    this.routeInfoCache = generateRouteInfoModule(this.getFiles())
    this.routeInfoVersion = this.version
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
