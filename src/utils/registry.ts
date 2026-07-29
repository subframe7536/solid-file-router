import { existsSync } from 'node:fs'

import { glob } from 'tinyglobby'
import { createFilter, normalizePath } from 'vite'

import { logger } from '../const'

import { generateDefinition, assembleDefinition, getRoutePath } from './definition'
import type { InheritanceConfig, NormalizedRouteEntry, RouteEntry, RouteInput } from './definition'
import { invalidateCache } from './extract'
import type { InfoTypeDefinition } from './route-type'
import { generateRouteTypes } from './route-type'
import { defineRouteSource } from './source'
import type { RouteSourceEntry, RouteSourceLoadContext, RouteSourceProvider } from './source'

interface RouteRegistryOption<TData> {
  pagesDir: string
  ignore: string[]
  output: string
  infoDts?: InfoTypeDefinition
  verboseLog?: boolean
  inheritance: InheritanceConfig
  routeSources?: readonly RouteSourceProvider<TData>[]
}

const REG_QUERY = /\?.*$/
const REG_ROUTE_SOURCE_EXT = /\.(jsx|tsx|md|mdx)$/i
const REG_GLOB_CHAR = /[*?[{]/
// Generated route-source modules must be recognized by this plugin and transformed as TSX.
const ROUTE_SOURCE_MODULE_SUFFIX = '-sfr.tsx'

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

interface NormalizedRouteSourceEntry<TData> extends NormalizedRouteEntry {
  data?: TData
}

interface RouteSourceWatchConfig {
  roots: string[]
  filter: (file: string) => boolean
}

interface RouteSourceState<TData> {
  provider: RouteSourceProvider<TData>
  watch: RouteSourceWatchConfig
  entries: NormalizedRouteSourceEntry<TData>[]
}

interface RouteSourceModule<TData> {
  provider: RouteSourceProvider<TData>
  context: RouteSourceLoadContext<TData>
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
    if (this.getRouteSources().length > 0) {
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
    if (this.getRouteSources().length > 0) {
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

    const entry = createFileEntry(normalized)
    this.entries.set(entry.moduleId, entry)
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
    if (this.getRouteSources().length > 0) {
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
    if (this.getRouteSources().length === 0) {
      return undefined
    }

    const moduleId = stripQuery(normalizePath(id))
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
    this.outputPath = normalizePath(`${this.root}/${this.options.output}`)
    if (this.getRouteSources().length > 0) {
      this.routeSourceStates = this.getRouteSources().map((provider) => ({
        provider,
        watch: createRouteSourceWatchConfig(this.root, getRouteSourceWatchFiles(provider)),
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
      this.entries.set(normalized, createFileEntry(normalized))
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
      .filter((file) => this.routeSourceFileFilter(file))
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
    if (this.getRouteSources().length > 0) {
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

  private getRouteSources(): readonly RouteSourceProvider<TData>[] {
    return this.routeSources
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

function resolveFromRoot(root: string, dir: string): string {
  if (!dir) {
    return root
  }
  return `${root}/${normalizePath(dir).replace(/^(?:\.\/|\/+)|\/+$/g, '')}`
}

function log(message: string, timestamp = true) {
  logger.info(message, { timestamp })
}

export function resolveRouteSourceModuleId(id: string): string | undefined {
  return isRouteSourceModuleId(id) ? normalizePath(id) : undefined
}

export function isRouteSourceModuleId(id: string): boolean {
  return stripQuery(normalizePath(id)).endsWith(ROUTE_SOURCE_MODULE_SUFFIX)
}

function createFileEntry(file: string): NormalizedRouteEntry {
  return {
    routeId: file,
    routePath: file,
    moduleId: file,
    sourcePath: file,
  }
}

function normalizeRouteSourceEntry<TData>(
  root: string,
  sourcePath: string,
  entry: RouteSourceEntry<TData>,
): NormalizedRouteSourceEntry<TData> {
  const seenIds = new Set<string>()
  const seenRoutePaths = new Set<string>()
  const seenSourcePaths = new Set<string>()

    const routePath = normalizeRoutePath(entry.path)
    const routeId = normalizeRouteId(entry.routeId ?? getDerivedRouteId(routePath))
    const resolvedSourcePath = resolveFromRoot(root, sourcePath)
    if (seenIds.has(routeId)) {
      throw new Error(
        `[solid-file-router] duplicate routeSource routeId: ${routeId} for sourcePath: ${sourcePath}`,
      )
    }
    if (seenRoutePaths.has(routePath)) {
      throw new Error(
        `[solid-file-router] duplicate routeSource routePath: ${routePath} for sourcePath: ${sourcePath}`,
      )
    }
    if (seenSourcePaths.has(resolvedSourcePath)) {
      throw new Error(`[solid-file-router] duplicate routeSource sourcePath: ${resolvedSourcePath}`)
    }

    seenIds.add(routeId)
    seenRoutePaths.add(routePath)
    seenSourcePaths.add(resolvedSourcePath)
    return {
      routeId,
      routePath,
      moduleId: getRouteSourceModuleId(resolvedSourcePath),
      sourcePath: resolvedSourcePath,
      data: entry.data,
    }
}

function mergeRouteSourceEntries<TData>(
  sourceEntries: NormalizedRouteSourceEntry<TData>[][],
): NormalizedRouteSourceEntry<TData>[] {
  const merged = new Map<string, NormalizedRouteSourceEntry<TData>>()

  for (const entries of sourceEntries) {
    for (const entry of entries) {
      for (const [key, current] of merged) {
        if (
          current.routeId === entry.routeId ||
          current.routePath === entry.routePath ||
          current.sourcePath === entry.sourcePath
        ) {
          merged.delete(key)
        }
      }
      merged.set(entry.moduleId, entry)
    }
  }

  return [...merged.values()]
}

function getDerivedRouteId(routePath: string): string {
  return getRoutePath(routePath, '') ?? `/${routePath.replace(REG_ROUTE_SOURCE_EXT, '')}`
}

function normalizeRouteId(routeId: string): string {
  const normalized = normalizePath(routeId).replace(/^(?:\.\/)|\/+$/g, '')
  if (!normalized) {
    return '/'
  }
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

function normalizeRoutePath(routePath: string): string {
  const normalized = normalizePath(routePath).replace(/^(?:\.\/|\/+)|\/+$/g, '')
  if (!normalized) {
    return 'index.tsx'
  }
  return normalized
}

function getRouteSourceModuleId(sourcePath: string): string {
  return `${sourcePath}${ROUTE_SOURCE_MODULE_SUFFIX}`
}

function stripQuery(id: string): string {
  return id.replace(REG_QUERY, '')
}

function createRouteSourceWatchConfig(root: string, patterns: string[]): RouteSourceWatchConfig {
  const includes: string[] = []
  const excludes: string[] = []
  const roots: string[] = []

  for (const pattern of patterns) {
    const isExclude = pattern.startsWith('!')
    const value = pattern.slice(isExclude ? 1 : 0)
    if (!value) {
      continue
    }

    const resolved = resolveFromRoot(root, value)
    if (isExclude) {
      excludes.push(resolved, `${resolved}/**`)
      continue
    }

    if (REG_GLOB_CHAR.test(resolved)) {
      includes.push(resolved)
    } else {
      includes.push(resolved, `${resolved}/**`)
    }
    roots.push(getGlobWatchRoot(resolved))
  }

  return {
    roots: [...new Set(roots)],
    filter: includes.length > 0 ? createFilter(includes, excludes) : () => false,
  }
}

function getRouteSourceWatchFiles<TData>(source: RouteSourceProvider<TData>): string[] {
  return [source.filter, ...(source.watch ?? [])]
}

function getGlobWatchRoot(pattern: string): string {
  const normalized = normalizePath(pattern).replace(/^(?:\.\/|\/+)/g, '')
  const globIndex = normalized.search(REG_GLOB_CHAR)
  if (globIndex < 0) {
    return normalized
  }

  const prefix = normalized.slice(0, globIndex)
  const lastSlashIndex = prefix.lastIndexOf('/')
  if (lastSlashIndex < 0) {
    return ''
  }

  return prefix.slice(0, lastSlashIndex)
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
