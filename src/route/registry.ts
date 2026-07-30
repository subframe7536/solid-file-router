import { existsSync } from 'node:fs'

import { glob } from 'tinyglobby'
import { createFilter, normalizePath } from 'vite'

import { logger } from '../const'

import { generateDefinition, assembleDefinition } from './definition'
import type { InheritanceConfig, NormalizedRouteEntry, RouteEntry, RouteInput } from './definition'
import { invalidateCache } from './extract'
import { getRoutePath } from './path'
import {
  createRouteSourceWatchConfig,
  getRouteSourceFilterPath,
  mergeRouteSourceEntries,
  normalizeRouteSourceEntry,
  resolveFromRoot,
} from './registry-source'
import type {
  NormalizedRouteSourceEntry,
  RouteSourceModule,
  RouteSourceState,
} from './registry-source'
import type { InfoTypeDefinition } from './route-type'
import { generateRouteTypes } from './route-type'
import { defineRouteSource } from './source'
import type { RouteSourceProvider } from './source'

interface RouteRegistryOption<TData> {
  pagesDir: string
  ignore: string[]
  output: string
  infoDts?: InfoTypeDefinition
  verboseLog?: boolean
  inheritance: InheritanceConfig
  routeSources?: readonly RouteSourceProvider<TData>[]
}

export interface RouteRegistryChange {
  /** Whether the changed file belongs to a route source. */
  matched: boolean
  /** Whether route topology or generated route types changed. */
  structureChanged: boolean
  /** Generated route modules invalidated by the change. */
  changedModuleIds: string[]
  /** Normalized source files associated with the change. */
  changedFiles: string[]
}

export class RouteRegistry<TData = unknown> {
  private root = ''
  private pagesDir = ''
  private outputPath = ''
  private readonly entries = new Map<string, NormalizedRouteEntry>()
  private readonly routeSourceModuleMap = new Map<string, RouteSourceModule<TData>>()
  private readonly sourcePathMap = new Map<string, string>()
  private routeSourceStates: RouteSourceState<TData>[] = []
  private typesDirty = true
  private readonly definitionCache = new Map<string, RouteEntry>()
  private readonly routeFileFilter: ReturnType<typeof createFilter>
  private readonly routeSourceFileFilter: ReturnType<typeof createFilter>
  private readonly routeSources: readonly RouteSourceProvider<TData>[]

  constructor(private readonly options: RouteRegistryOption<TData>) {
    this.routeFileFilter = createFilter(['**/*.{jsx,tsx}'], options.ignore)
    this.routeSourceFileFilter = createFilter(['**/*'], options.ignore)
    this.routeSources = (options.routeSources ?? []).map((source) => defineRouteSource(source))
  }

  async markChanged(file: string): Promise<RouteRegistryChange> {
    const normalized = normalizePath(file)
    if (this.routeSources.length > 0) {
      if (!this.isCustomWatchedFile(normalized)) {
        return noChange()
      }

      const before = this.getSnapshot()
      const previousModuleIds = this.getCustomModuleIds()
      const previousModuleId = this.sourcePathMap.get(normalized)
      const sourceIndexes = this.getMatchingSourceIndexes(normalized)
      const structureChanged = await this.refreshCustomEntries(before, sourceIndexes)
      const changedModuleIds = this.getCustomChangedModuleIds(
        structureChanged,
        previousModuleIds,
        previousModuleId,
        this.sourcePathMap.get(normalized),
        sourceIndexes,
      )
      for (const moduleId of changedModuleIds) {
        invalidateCache(moduleId)
      }
      log(`Route source changed: ${normalized}`)
      return {
        matched: true,
        structureChanged,
        changedModuleIds,
        changedFiles: [normalized],
      }
    }

    if (!this.isRouteFileNormalized(normalized)) {
      return noChange()
    }

    invalidateCache(normalized)
    log(`Route changed: ${normalized}`)
    return {
      matched: true,
      structureChanged: false,
      changedModuleIds: [normalized],
      changedFiles: [normalized],
    }
  }

  async addFile(file: string): Promise<RouteRegistryChange> {
    const normalized = normalizePath(file)
    if (this.routeSources.length > 0) {
      if (!this.isCustomWatchedFile(normalized)) {
        return noChange()
      }

      const previousModuleIds = this.getCustomModuleIds()
      const sourceIndexes = this.getMatchingSourceIndexes(normalized)
      const structureChanged = await this.refreshCustomEntries(this.getSnapshot(), sourceIndexes)
      const changedModuleIds = this.getCustomChangedModuleIds(
        structureChanged,
        previousModuleIds,
        undefined,
        undefined,
        sourceIndexes,
      )
      for (const moduleId of changedModuleIds) {
        invalidateCache(moduleId)
      }
      if (structureChanged) {
        log(`Route source added: ${normalized}`)
      }
      return {
        matched: true,
        structureChanged,
        changedModuleIds,
        changedFiles: [normalized],
      }
    }

    if (!this.isRouteFileNormalized(normalized) || this.entries.has(normalized)) {
      return noChange()
    }

    const entry = {
      routeId: normalized,
      routePath: normalized,
      moduleId: normalized,
      sourcePath: normalized,
    }
    this.entries.set(normalized, entry)
    generateDefinition([normalized], this.definitionCache, this.pagesDir)
    this.typesDirty = true
    log(`Route added: ${normalized}`)
    return {
      matched: true,
      structureChanged: true,
      changedModuleIds: [normalized],
      changedFiles: [normalized],
    }
  }

  async removeFile(file: string): Promise<RouteRegistryChange> {
    const normalized = normalizePath(file)
    if (this.routeSources.length > 0) {
      if (!this.isCustomWatchedFile(normalized)) {
        return noChange()
      }

      const previousModuleIds = this.getCustomModuleIds()
      const sourceIndexes = this.getMatchingSourceIndexes(normalized)
      const structureChanged = await this.refreshCustomEntries(this.getSnapshot(), sourceIndexes)
      const changedModuleIds = this.getCustomChangedModuleIds(
        structureChanged,
        previousModuleIds,
        undefined,
        undefined,
        sourceIndexes,
      )
      for (const moduleId of changedModuleIds) {
        invalidateCache(moduleId)
      }
      if (structureChanged) {
        log(`Route source removed: ${normalized}`)
      }
      return {
        matched: true,
        structureChanged,
        changedModuleIds,
        changedFiles: [normalized],
      }
    }

    if (!this.entries.delete(normalized)) {
      return noChange()
    }

    invalidateCache(normalized)
    this.definitionCache.delete(normalized)
    this.typesDirty = true
    log(`Route removed: ${normalized}`)
    return {
      matched: true,
      structureChanged: true,
      changedModuleIds: [normalized],
      changedFiles: [normalized],
    }
  }

  async getDefinition(lazy: boolean): Promise<string> {
    const entries = this.getRouteInputs()

    if (this.typesDirty || !existsSync(this.outputPath)) {
      generateRouteTypes(entries, this.outputPath, this.options.infoDts, this.pagesDir)
      this.typesDirty = false
    }
    log(`Generated ${this.definitionCache.size} routes, Mode: ${lazy ? 'Lazy' : 'Eager'}`)

    const code = assembleDefinition(
      entries,
      this.definitionCache,
      lazy,
      this.options.inheritance,
      this.options.verboseLog,
      this.pagesDir,
    )

    return code
  }

  getWatchFiles(): string[] {
    const watchFiles = this.routeSourceStates.flatMap((state) => state.watch.roots)
    const uncoveredSources = [...this.sourcePathMap.keys()].filter(
      (sourcePath) =>
        !watchFiles.some(
          (watchFile) => sourcePath === watchFile || sourcePath.startsWith(`${watchFile}/`),
        ),
    )
    return [...new Set([...watchFiles, ...uncoveredSources])]
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

  async loadRouteSourceModule(id: string): Promise<string | undefined> {
    if (this.routeSources.length === 0) {
      return undefined
    }

    const moduleId = normalizePath(id).replace(/\?.*$/, '')
    const source = this.routeSourceModuleMap.get(moduleId)
    if (!source) {
      return undefined
    }

    const code = await source.provider.load(source.context)
    if (!code) {
      throw new Error(
        `[solid-file-router] routeSource.load returned no code for routeId: ${source.context.routeId}`,
      )
    }
    return code
  }

  async initialize(root: string): Promise<void> {
    this.root = normalizePath(root)

    this.pagesDir = resolveFromRoot(this.root, this.options.pagesDir)
    this.outputPath = resolveFromRoot(this.root, this.options.output)
    if (this.routeSources.length > 0) {
      this.routeSourceStates = this.routeSources.map((provider) => ({
        provider,
        watch: createRouteSourceWatchConfig(this.root, [
          provider.filter,
          ...(provider.watch ?? []),
        ]),
        entries: [],
      }))
      await this.refreshCustomEntries('')
      return
    }

    const files = await glob('**/*.{jsx,tsx}', {
      cwd: this.pagesDir,
      ignore: this.options.ignore,
      absolute: true,
    })

    this.entries.clear()
    for (const file of files) {
      const normalized = normalizePath(file)
      this.entries.set(normalized, {
        routeId: normalized,
        routePath: normalized,
        moduleId: normalized,
        sourcePath: normalized,
      })
    }

    this.definitionCache.clear()
    generateDefinition(this.getRouteInputs(), this.definitionCache, this.pagesDir)
  }

  private isRouteFileNormalized(file: string): boolean {
    if (!file.startsWith(`${this.pagesDir}/`)) {
      return false
    }

    const relative = file.slice(this.pagesDir.length + 1)
    return this.routeFileFilter(relative)
  }

  private async scanProvider(
    source: RouteSourceProvider<TData>,
  ): Promise<NormalizedRouteSourceEntry<TData>[]> {
    const files = await source.glob!(glob, source.filter, this.root)
    return files
      .map(normalizePath)
      .filter((file) => this.routeSourceFileFilter(getRouteSourceFilterPath(this.root, file)))
      .map((sourcePath) => {
        const entry = source.transformPath!(sourcePath)
        return normalizeRouteSourceEntry(this.root, sourcePath, entry)
      })
  }

  private async refreshCustomEntries(
    previousSnapshot: string,
    sourceIndexes?: number[],
  ): Promise<boolean> {
    const selected = sourceIndexes ? new Set(sourceIndexes) : undefined
    const scannedEntries = await Promise.all(
      this.routeSourceStates.map(async (state, index) => {
        if (selected && !selected.has(index)) {
          return state.entries
        }
        return await this.scanProvider(state.provider)
      }),
    )
    this.routeSourceStates.forEach((state, index) => {
      state.entries = scannedEntries[index] ?? []
    })
    const normalizedEntries = mergeRouteSourceEntries(scannedEntries)
    const nextSnapshot = getSnapshot(normalizedEntries)
    const structureChanged = previousSnapshot !== nextSnapshot

    this.entries.clear()
    this.routeSourceModuleMap.clear()
    this.sourcePathMap.clear()

    for (const entry of normalizedEntries) {
      const sourceIndex = scannedEntries.findIndex((entries) => entries.includes(entry))
      const provider = this.routeSourceStates[sourceIndex]?.provider
      if (!provider) {
        continue
      }
      this.entries.set(entry.moduleId, entry)
      const sourcePath = entry.sourcePath!
      this.routeSourceModuleMap.set(entry.moduleId, {
        provider,
        context: {
          routeId: entry.routeId,
          path: entry.routePath,
          sourcePath,
          moduleId: entry.moduleId,
          data: entry.data,
        },
      })
      this.sourcePathMap.set(sourcePath, entry.moduleId)
    }

    if (structureChanged) {
      this.definitionCache.clear()
      generateDefinition(this.getRouteInputs(), this.definitionCache, this.pagesDir)
      this.typesDirty = true
    }

    return structureChanged
  }

  private getEntries(): NormalizedRouteEntry[] {
    return [...this.entries.values()].sort(
      (a, b) => a.routePath.localeCompare(b.routePath) || a.routeId.localeCompare(b.routeId),
    )
  }

  private getRouteInputs(): RouteInput[] {
    const entries = this.getEntries()
    if (this.routeSources.length > 0) {
      return entries
    }

    return entries.map((entry) => entry.moduleId)
  }

  private getSnapshot(): string {
    return getSnapshot(this.getEntries())
  }

  private isCustomWatchedFile(file: string): boolean {
    return this.getMatchingSourceIndexes(file).length > 0
  }

  private getMatchingSourceIndexes(file: string): number[] {
    return this.routeSourceStates
      .map((state, index) =>
        state.entries.some((entry) => entry.sourcePath === file) || state.watch.filter(file)
          ? index
          : -1,
      )
      .filter((index) => index >= 0)
  }

  private getCustomModuleIds(): string[] {
    return [...this.routeSourceModuleMap.keys()]
  }

  private getCustomChangedModuleIds(
    structureChanged: boolean,
    previousModuleIds: string[],
    previousModuleId?: string,
    nextModuleId?: string,
    sourceIndexes?: number[],
  ): string[] {
    if (structureChanged) {
      return uniqueModuleIds(previousModuleIds, this.getCustomModuleIds())
    }

    if (previousModuleId || nextModuleId) {
      return uniqueModuleIds([previousModuleId, nextModuleId])
    }

    if (sourceIndexes) {
      const selected = new Set(sourceIndexes)
      return [...this.routeSourceModuleMap.entries()]
        .filter(([moduleId]) => {
          const sourcePath = this.entries.get(moduleId)?.sourcePath
          return (
            sourcePath &&
            this.getMatchingSourceIndexes(sourcePath).some((index) => selected.has(index))
          )
        })
        .map(([moduleId]) => moduleId)
    }
    return this.getCustomModuleIds()
  }
}

export { isRouteSourceModuleId, resolveRouteSourceModuleId } from './registry-source'

function log(message: string, timestamp = true) {
  logger.info(message, { timestamp })
}

function uniqueModuleIds(...groups: Array<Array<string | undefined>>): string[] {
  return [...new Set(groups.flat().filter((id): id is string => !!id))]
}

function getSnapshot(entries: NormalizedRouteEntry[]): string {
  return entries
    .map(
      (entry) => `${entry.moduleId}|${entry.routeId}|${entry.routePath}|${entry.sourcePath ?? ''}`,
    )
    .sort()
    .join('\n')
}

function noChange(): RouteRegistryChange {
  return {
    matched: false,
    structureChanged: false,
    changedModuleIds: [],
    changedFiles: [],
  }
}
