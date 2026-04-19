import { glob } from 'tinyglobby'
import { normalizePath } from 'vite'

import { logger } from '../const'

import { generateDefinition, assembleDefinition } from './definition'
import type { InheritanceConfig, RouteEntry } from './definition'
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

const REG_IS_ROUTE_FILE = /\.(jsx|tsx|mdx)$/

function normalizeBaseDir(baseDir: string): string {
  return baseDir ? normalizePath(baseDir).replace(/\/$/, '') : ''
}

export class RouteRegistry {
  private root = ''
  private pagesDir = ''
  private outputPath = ''
  private readonly pagesDirBase: string
  private readonly files = new Set<string>()
  private typesDirty = true
  private readonly definitionCache = new Map<string, RouteEntry>()
  private readonly routesFilter: string

  constructor(private readonly options: RouteRegistryOption) {
    const baseDir = normalizeBaseDir(options.baseDir)
    this.pagesDirBase = `${baseDir ? `${baseDir}/` : ''}src/pages`
    this.routesFilter = `${this.pagesDirBase}/**/*.{jsx,tsx,mdx}`
  }

  markChanged(file: string): boolean {
    const normalized = normalizePath(file)
    if (!this.isRouteFileNormalized(normalized)) {
      return false
    }

    invalidateCache(normalized)
    log(`Route changed: ${normalized}`)
    return true
  }

  async addFile(file: string): Promise<boolean> {
    const normalized = normalizePath(file)
    if (!this.isRouteFileNormalized(normalized) || this.files.has(normalized)) {
      return false
    }

    this.files.add(normalized)
    generateDefinition([normalized], this.definitionCache)
    this.typesDirty = true
    log(`Route added: ${normalized}`)
    return true
  }

  async removeFile(file: string): Promise<boolean> {
    const normalized = normalizePath(file)
    if (!this.files.delete(normalized)) {
      return false
    }

    invalidateCache(normalized)
    this.definitionCache.delete(normalized)
    this.typesDirty = true
    log(`Route removed: ${normalized}`)
    return true
  }

  async getDefinition(lazy: boolean): Promise<string> {
    const files = [...this.files].sort()

    if (this.typesDirty) {
      generateRouteTypes(files, this.outputPath, this.options.infoDts)
      this.typesDirty = false
    }
    log(`Generated ${this.definitionCache.size} routes, Mode: ${lazy ? 'Lazy' : 'Eager'}`)

    const code = assembleDefinition(
      files,
      this.definitionCache,
      lazy,
      this.options.inheritance,
      this.options.verboseLog,
    )

    return code
  }

  async initialize(root: string): Promise<void> {
    this.root = normalizePath(root)
    this.pagesDir = `${this.root}/${this.pagesDirBase}`.replace(/\/+$/g, '')
    this.outputPath = normalizePath(`${this.root}/${this.options.output}`)
    const files = await glob(this.routesFilter, {
      cwd: this.root,
      ignore: this.options.ignore,
      absolute: true,
    })

    this.files.clear()
    for (const file of files) {
      this.files.add(normalizePath(file))
    }

    this.typesDirty = true
    this.definitionCache.clear()
    generateDefinition([...this.files].sort(), this.definitionCache)
  }

  private isRouteFileNormalized(file: string): boolean {
    return file.startsWith(`${this.pagesDir}/`) && REG_IS_ROUTE_FILE.test(file)
  }
}

function log(message: string, timestamp = true) {
  logger.info(message, { timestamp })
}
