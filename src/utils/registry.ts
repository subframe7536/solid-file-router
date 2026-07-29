import { existsSync } from 'node:fs'

import { glob } from 'tinyglobby'
import { createFilter, normalizePath } from 'vite'

import { logger } from '../const'

import { generateDefinition, assembleDefinition, getRoutePath } from './definition'
import type { InheritanceConfig, NormalizedRouteEntry, RouteEntry, RouteInput } from './definition'
import { invalidateCache } from './extract'
import type { InfoTypeDefinition } from './route-type'
import { generateRouteTypes } from './route-type'
import type { RouteSourceEntry, RouteSourceLoadContext, RouteSourceProvider } from './source'

interface RouteRegistryOption<TData> {
  pagesDir: string
  ignore: string[]
  output: string
  infoDts?: InfoTypeDefinition
  verboseLog?: boolean
  inheritance: InheritanceConfig
  routeSource?: RouteSourceProvider<TData>
}

const REG_QUERY = /\?.*$/
const REG_ROUTE_SOURCE_EXT = /\.(jsx|tsx|mdx)$/i
const REG_GLOB_CHAR = /[*?[{]/
const ROUTE_SOURCE_MODULE_SUFFIX = '.solid-file-router.tsx'

export interface RouteRegistryChange {
  matched: boolean
  structureChanged: boolean
  changedModuleIds: string[]
  changedFiles: string[]
}

interface NormalizedRouteSourceEntry<TData> extends NormalizedRouteEntry {
  data?: TData
}

interface RouteSourceWatchConfig {
  roots: string[]
  filter: (file: string) => boolean
}

export class RouteRegistry<TData = unknown> {
  private root = ''
  private pagesDir = ''
  private outputPath = ''
  private readonly entries = new Map<string, NormalizedRouteEntry>()
  private readonly routeSourceModuleMap = new Map<string, RouteSourceLoadContext<TData>>()
  private readonly sourcePathMap = new Map<string, string>()
  private watchFiles: string[] = []
  private customWatchFilter: ((file: string) => boolean) | undefined
  private typesDirty = true
  private readonly definitionCache = new Map<string, RouteEntry>()
  private readonly routeFileFilter: ReturnType<typeof createFilter>

  constructor(private readonly options: RouteRegistryOption<TData>) {
    this.routeFileFilter = createFilter(['**/*.{jsx,tsx}'], options.ignore)
  }

  async markChanged(file: string): Promise<RouteRegistryChange> {
    const normalized = normalizePath(file)
    if (this.options.routeSource) {
      if (!this.isCustomWatchedFile(normalized)) {
        return noChange()
      }

      const before = this.getSnapshot()
      const previousModuleIds = this.getCustomModuleIds()
      const previousModuleId = this.sourcePathMap.get(normalized)
      const structureChanged = await this.refreshCustomEntries(before)
      const changedModuleIds = this.getCustomChangedModuleIds(
        structureChanged,
        previousModuleIds,
        previousModuleId,
        this.sourcePathMap.get(normalized),
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
    if (this.options.routeSource) {
      if (!this.isCustomWatchedFile(normalized)) {
        return noChange()
      }

      const previousModuleIds = this.getCustomModuleIds()
      const structureChanged = await this.refreshCustomEntries(this.getSnapshot())
      const changedModuleIds = this.getCustomChangedModuleIds(structureChanged, previousModuleIds)
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
    if (this.options.routeSource) {
      if (!this.isCustomWatchedFile(normalized)) {
        return noChange()
      }

      const previousModuleIds = this.getCustomModuleIds()
      const structureChanged = await this.refreshCustomEntries(this.getSnapshot())
      const changedModuleIds = this.getCustomChangedModuleIds(structureChanged, previousModuleIds)
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
    const uncoveredSources = [...this.sourcePathMap.keys()].filter(
      (sourcePath) =>
        !this.watchFiles.some(
          (watchFile) => sourcePath === watchFile || sourcePath.startsWith(`${watchFile}/`),
        ),
    )
    return [...this.watchFiles, ...uncoveredSources]
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
    if (!this.options.routeSource) {
      return undefined
    }

    const moduleId = stripQuery(normalizePath(id))
    const context = this.routeSourceModuleMap.get(moduleId)
    if (!context) {
      return undefined
    }

    const code = await this.options.routeSource.load(context)
    if (!code) {
      throw new Error(
        `[solid-file-router] routeSource.load returned no code for routeId: ${context.routeId}`,
      )
    }
    return code
  }

  async initialize(root: string): Promise<void> {
    this.root = normalizePath(root)

    this.pagesDir = resolveFromRoot(this.root, this.options.pagesDir)
    this.outputPath = normalizePath(`${this.root}/${this.options.output}`)
    if (this.options.routeSource) {
      const watchConfig = createRouteSourceWatchConfig(
        this.root,
        getRouteSourceWatchFiles(this.options.routeSource),
      )
      this.watchFiles = watchConfig.roots
      this.customWatchFilter = watchConfig.filter
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

  private async scanCustomRouteSource(): Promise<RouteSourceEntry<TData>[]> {
    const source = this.options.routeSource
    if (!source) {
      return []
    }

    if (typeof source.scan === 'string') {
      const files = await glob(source.scan, {
        cwd: this.root,
        ignore: this.options.ignore,
        absolute: false,
      })

      return files.map((file) => {
        const normalized = normalizePath(file)
        const pathWithoutExtension = normalized.replace(REG_ROUTE_SOURCE_EXT, '')
        return {
          routeId: getRoutePath(normalized, '') ?? `/${pathWithoutExtension}`,
          routePath: `${pathWithoutExtension}.tsx`,
          sourcePath: normalized,
        }
      })
    }

    return await source.scan(glob, this.root)
  }

  private async refreshCustomEntries(previousSnapshot: string): Promise<boolean> {
    const scannedEntries = await this.scanCustomRouteSource()
    const normalizedEntries = normalizeRouteSourceEntries(this.root, scannedEntries)
    const nextSnapshot = getSnapshot(normalizedEntries)
    const structureChanged = previousSnapshot !== nextSnapshot

    this.entries.clear()
    this.routeSourceModuleMap.clear()
    this.sourcePathMap.clear()

    for (const entry of normalizedEntries) {
      this.entries.set(entry.moduleId, entry)
      const sourcePath = entry.sourcePath!
      this.routeSourceModuleMap.set(entry.moduleId, {
        routeId: entry.routeId,
        routePath: entry.routePath,
        sourcePath,
        moduleId: entry.moduleId,
        data: entry.data,
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
    if (this.options.routeSource) {
      return entries
    }

    return entries.map((entry) => entry.moduleId)
  }

  private getSnapshot(): string {
    return getSnapshot(this.getEntries())
  }

  private isCustomWatchedFile(file: string): boolean {
    return this.sourcePathMap.has(file) || this.customWatchFilter?.(file) === true
  }

  private getCustomModuleIds(): string[] {
    return [...this.routeSourceModuleMap.keys()]
  }

  private getCustomChangedModuleIds(
    structureChanged: boolean,
    previousModuleIds: string[],
    previousModuleId?: string,
    nextModuleId?: string,
  ): string[] {
    if (structureChanged) {
      return uniqueModuleIds(previousModuleIds, this.getCustomModuleIds())
    }

    if (previousModuleId || nextModuleId) {
      return uniqueModuleIds([previousModuleId, nextModuleId])
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

function normalizeRouteSourceEntries<TData>(
  root: string,
  entries: RouteSourceEntry<TData>[],
): NormalizedRouteSourceEntry<TData>[] {
  const result: NormalizedRouteSourceEntry<TData>[] = []
  const seenIds = new Set<string>()
  const seenRoutePaths = new Set<string>()
  const seenSourcePaths = new Set<string>()

  for (const entry of entries) {
    if (!entry.sourcePath) {
      throw new Error('[solid-file-router] routeSource entry sourcePath is required')
    }
    if (!entry.routePath) {
      throw new Error(
        `[solid-file-router] routeSource entry routePath is required for sourcePath: ${entry.sourcePath}`,
      )
    }

    const routePath = normalizeRoutePath(entry.routePath)
    const routeId = normalizeRouteId(entry.routeId ?? getDerivedRouteId(routePath))
    const sourcePath = resolveFromRoot(root, entry.sourcePath)
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
    if (seenSourcePaths.has(sourcePath)) {
      throw new Error(`[solid-file-router] duplicate routeSource sourcePath: ${sourcePath}`)
    }

    seenIds.add(routeId)
    seenRoutePaths.add(routePath)
    seenSourcePaths.add(sourcePath)
    result.push({
      routeId,
      routePath,
      moduleId: getRouteSourceModuleId(sourcePath),
      sourcePath,
      data: entry.data,
    })
  }

  return result
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
  if (source.watchFiles) {
    return source.watchFiles
  }

  return typeof source.scan === 'string' ? [source.scan] : []
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
