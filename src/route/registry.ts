import { existsSync } from 'node:fs'

import { glob } from 'tinyglobby'
import { createFilter, normalizePath } from 'vite'

import { logger } from '../const'

import { assembleDefinition, generateDefinition } from './definition'
import type { InheritanceConfig, NormalizedRouteEntry, RouteEntry, RouteInput } from './definition'
import { invalidateCache } from './extract'
import { getRoutePath } from './path'
import { resolveFromRoot, RouteProviderManager } from './provider'
import type { RouteProvider } from './provider'
import type { InfoTypeDefinition } from './type-gen'
import { generateRouteTypes } from './type-gen'

interface RouteRegistryOption<TData> {
  pagesDir: string
  ignore: string[]
  output: string
  infoDts?: InfoTypeDefinition
  verboseLog?: boolean
  inheritance: InheritanceConfig
  routeProviders?: readonly RouteProvider<TData>[]
}

export interface RouteRegistryChange {
  matched: boolean
  structureChanged: boolean
  changedModuleIds: string[]
  changedFiles: string[]
}

const noChange = (): RouteRegistryChange => ({
  matched: false,
  structureChanged: false,
  changedModuleIds: [],
  changedFiles: [],
})

export class RouteRegistry<TData = unknown> {
  private root = ''
  private pagesDir = ''
  private outputPath = ''
  private readonly entries = new Map<string, NormalizedRouteEntry>()
  private readonly definitionCache = new Map<string, RouteEntry>()
  private readonly routeFileFilter: ReturnType<typeof createFilter>
  private readonly providerManager: RouteProviderManager<TData>
  private typesDirty = true

  constructor(private readonly options: RouteRegistryOption<TData>) {
    this.routeFileFilter = createFilter(['**/*.{jsx,tsx}'], options.ignore)
    this.providerManager = new RouteProviderManager(options.routeProviders ?? [], options.ignore)
  }

  async initialize(root: string): Promise<void> {
    this.root = normalizePath(root)
    this.pagesDir = resolveFromRoot(this.root, this.options.pagesDir)
    this.outputPath = resolveFromRoot(this.root, this.options.output)
    if (this.providerManager.enabled) {
      await this.providerManager.initialize(this.root)
      this.replaceEntries(this.providerManager.getEntries())
      this.rebuildDefinitions()
      return
    }

    const files = await glob('**/*.{jsx,tsx}', {
      cwd: this.pagesDir,
      ignore: this.options.ignore,
      absolute: true,
    })
    this.replaceEntries(
      files.map((file) => {
        const moduleId = normalizePath(file)
        return { routeId: moduleId, routePath: moduleId, moduleId, sourcePath: moduleId }
      }),
    )
    this.rebuildDefinitions()
  }

  async markChanged(file: string): Promise<RouteRegistryChange> {
    const normalized = normalizePath(file)
    if (!this.providerManager.enabled) {
      if (!this.isRouteFile(normalized)) {
        return noChange()
      }
      invalidateCache(normalized)
      log(`Route changed: ${normalized}`)
      return change([normalized], normalized)
    }
    return this.handleProviderChange(normalized, 'changed')
  }

  async addFile(file: string): Promise<RouteRegistryChange> {
    const normalized = normalizePath(file)
    if (!this.providerManager.enabled) {
      if (!this.isRouteFile(normalized) || this.entries.has(normalized)) {
        return noChange()
      }
      this.entries.set(normalized, {
        routeId: normalized,
        routePath: normalized,
        moduleId: normalized,
        sourcePath: normalized,
      })
      generateDefinition([normalized], this.definitionCache, this.pagesDir)
      this.typesDirty = true
      log(`Route added: ${normalized}`)
      return change([normalized], normalized, true)
    }
    return this.handleProviderChange(normalized, 'added')
  }

  async removeFile(file: string): Promise<RouteRegistryChange> {
    const normalized = normalizePath(file)
    if (!this.providerManager.enabled) {
      if (!this.entries.delete(normalized)) {
        return noChange()
      }
      invalidateCache(normalized)
      this.definitionCache.delete(normalized)
      this.typesDirty = true
      log(`Route removed: ${normalized}`)
      return change([normalized], normalized, true)
    }
    return this.handleProviderChange(normalized, 'removed')
  }

  async getDefinition(lazy: boolean): Promise<string> {
    const entries = this.getRouteInputs()
    if (this.typesDirty || !existsSync(this.outputPath)) {
      generateRouteTypes(entries, this.outputPath, this.options.infoDts, this.pagesDir)
      this.typesDirty = false
    }
    log(`Generated ${this.definitionCache.size} routes, Mode: ${lazy ? 'Lazy' : 'Eager'}`)
    return assembleDefinition(
      entries,
      this.definitionCache,
      lazy,
      this.options.inheritance,
      this.options.verboseLog,
      this.pagesDir,
    )
  }

  getWatchFiles(): string[] {
    return this.providerManager.enabled ? this.providerManager.getWatchFiles() : []
  }

  getStaticRoutes(): string[] {
    return this.getEntries()
      .map((entry) => getRoutePath(entry.routeId, this.pagesDir))
      .filter(
        (route): route is string =>
          !!route && route !== '/404' && !route.includes(':') && !route.includes('*'),
      )
      .sort()
  }

  async loadRouteProviderModule(id: string): Promise<string | undefined> {
    return this.providerManager.enabled ? this.providerManager.loadModule(id) : undefined
  }

  private async handleProviderChange(
    file: string,
    kind: 'changed' | 'added' | 'removed',
  ): Promise<RouteRegistryChange> {
    const result = await this.providerManager.handleChange(file)
    if (!result.matched) {
      return noChange()
    }
    if (result.structureChanged) {
      this.replaceEntries(this.providerManager.getEntries())
      this.rebuildDefinitions()
      this.typesDirty = true
    }
    const label = kind === 'changed' ? 'changed' : kind === 'added' ? 'added' : 'removed'
    if (result.structureChanged || kind === 'changed') {
      log(`Route provider ${label}: ${file}`)
    }
    return result
  }

  private replaceEntries(entries: NormalizedRouteEntry[]): void {
    this.entries.clear()
    for (const entry of entries) {
      this.entries.set(entry.moduleId, entry)
    }
  }

  private rebuildDefinitions(): void {
    this.definitionCache.clear()
    generateDefinition(this.getRouteInputs(), this.definitionCache, this.pagesDir)
  }

  private getEntries(): NormalizedRouteEntry[] {
    return [...this.entries.values()].sort(
      (a, b) => a.routePath.localeCompare(b.routePath) || a.routeId.localeCompare(b.routeId),
    )
  }

  private getRouteInputs(): RouteInput[] {
    return this.providerManager.enabled
      ? this.getEntries()
      : this.getEntries().map((entry) => entry.moduleId)
  }

  private isRouteFile(file: string): boolean {
    return (
      file.startsWith(`${this.pagesDir}/`) &&
      this.routeFileFilter(file.slice(this.pagesDir.length + 1))
    )
  }
}

function change(
  changedModuleIds: string[],
  changedFile: string,
  structureChanged = false,
): RouteRegistryChange {
  return { matched: true, structureChanged, changedModuleIds, changedFiles: [changedFile] }
}

function log(message: string): void {
  logger.info(message, { timestamp: true })
}
