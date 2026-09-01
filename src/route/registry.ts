import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import { glob } from 'tinyglobby'
import { createFilter, normalizePath } from 'vite'

import { logger } from '../const'

import { assembleDefinition, generateDefinition } from './definition'
import type { InheritanceConfig, NormalizedRouteEntry, RouteEntry, RouteInput } from './definition'
import { extract, invalidateCache } from './extract'
import type { ExtractConfig } from './extract'
import { getRoutePath, hasPrivateSegment, isAppRoute, isLayoutRoute } from './path'
import { createNoRouteProviderChange, resolveFromRoot, RouteProviderManager } from './provider'
import type { RouteProvider, RouteProviderChange, RouteProviderModule } from './provider'
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

export type RouteRegistryChange = RouteProviderChange

const DRAFT_EXTRACT_CONFIG: ExtractConfig = {
  entryFn: 'createRoute',
  pick: ['draft'],
}

interface DraftRouteScope {
  path: string
  subtree: boolean
}

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
        return createNoRouteProviderChange()
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
        return createNoRouteProviderChange()
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
        return createNoRouteProviderChange()
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

  async getStaticRoutes(): Promise<string[]> {
    const routes = this.getEntries()
      .filter((entry) => !hasPrivateSegment(entry.routePath))
      .map((entry) => getRoutePath(entry.routeId, this.pagesDir))
      .filter(
        (route): route is string =>
          !!route && route !== '/404' && !route.includes(':') && !route.includes('*'),
      )
    return await this.filterDraftRoutes(routes)
  }

  async filterDraftRoutes(routes: readonly string[]): Promise<string[]> {
    const draftScopes = await this.getDraftRoutePaths()
    return routes.filter((route) => {
      const normalized = normalizeStaticRoute(route)
      return (
        !hasPrivateSegment(normalized) &&
        !draftScopes.some((scope) => isWithinDraftScope(normalized, scope))
      )
    })
  }

  async loadRouteProviderModule(id: string): Promise<RouteProviderModule | undefined> {
    return this.providerManager.enabled ? this.providerManager.loadModule(id) : undefined
  }

  private async handleProviderChange(
    file: string,
    kind: 'changed' | 'added' | 'removed',
  ): Promise<RouteRegistryChange> {
    const result = await this.providerManager.handleChange(file)
    if (!result.matched) {
      return createNoRouteProviderChange()
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

  private async getDraftRoutePaths(): Promise<DraftRouteScope[]> {
    const entries = this.getEntries().filter((entry) => {
      const route = getRouteScopePath(entry, this.pagesDir)
      return !!route && route !== '/404'
    })
    const draftPaths = await Promise.all(
      entries.map(async (entry) => {
        const module = this.providerManager.enabled
          ? await this.loadRouteProviderModule(entry.moduleId)
          : undefined
        const code =
          module?.code ??
          (this.providerManager.enabled ? undefined : await readFile(entry.moduleId, 'utf8'))
        const extracted = code
          ? await extract(code, entry.moduleId, DRAFT_EXTRACT_CONFIG)
          : undefined
        const isDraft = !!extracted?.code && /\bdraft\s*:\s*true\b/.test(extracted.code)
        const path = isDraft ? getRouteScopePath(entry, this.pagesDir) : undefined
        return path
          ? {
              path: normalizeStaticRoute(path),
              subtree: isAppRoute(entry.routePath) || isLayoutRoute(entry.routePath),
            }
          : undefined
      }),
    )
    return draftPaths.filter((scope): scope is DraftRouteScope => !!scope)
  }
}

function getRouteScopePath(entry: NormalizedRouteEntry, routeRoot: string): string | undefined {
  if (isAppRoute(entry.routePath)) {
    return '/'
  }
  if (isLayoutRoute(entry.routePath)) {
    const indexRoutePath = entry.routePath.replace(/_layout\.(jsx|tsx)$/i, 'index.$1')
    return getRoutePath(indexRoutePath, routeRoot)
  }
  return getRoutePath(entry.routeId, routeRoot)
}

function normalizeStaticRoute(route: string): string {
  const normalized = route.trim().replace(/^\/+|\/+$/g, '')
  return normalized ? `/${normalized}` : '/'
}

function isWithinDraftScope(route: string, scope: DraftRouteScope): boolean {
  const { path: draftPath, subtree } = scope
  const routeSegments = route.split('/').filter(Boolean)
  const draftSegments = draftPath.split('/').filter(Boolean)

  function match(draftIndex: number, routeIndex: number): boolean {
    if (draftIndex === draftSegments.length) {
      return subtree || routeIndex === routeSegments.length
    }

    const draftSegment = draftSegments[draftIndex]!
    if (draftSegment.startsWith('*')) {
      const minimumConsumed = draftSegment.endsWith('?') ? 0 : 1
      for (
        let consumed = minimumConsumed;
        routeIndex + consumed <= routeSegments.length;
        consumed += 1
      ) {
        if (match(draftIndex + 1, routeIndex + consumed)) {
          return true
        }
      }
      return false
    }

    const optional = draftSegment.startsWith(':') && draftSegment.endsWith('?')
    if (optional && match(draftIndex + 1, routeIndex)) {
      return true
    }
    if (routeIndex >= routeSegments.length) {
      return false
    }
    if (draftSegment.startsWith(':') || draftSegment === routeSegments[routeIndex]) {
      return match(draftIndex + 1, routeIndex + 1)
    }
    return false
  }

  return match(0, 0)
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
