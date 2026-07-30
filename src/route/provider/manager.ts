import { glob } from 'tinyglobby'
import { createFilter, normalizePath } from 'vite'

import { invalidateCache } from '../extract'

import { defineRouteProvider } from './contract'
import type { RouteProvider, RouteProviderLoadContext } from './contract'
import { mergeRouteProviderEntries, normalizeRouteProviderEntry } from './entry'
import type { NormalizedRouteProviderEntry } from './entry'
import { createRouteProviderWatchConfig, getRouteProviderFilterPath } from './watch'
import type { RouteProviderWatchConfig } from './watch'

export interface RouteProviderChange {
  matched: boolean
  structureChanged: boolean
  changedModuleIds: string[]
  changedFiles: string[]
}

const noChange = (): RouteProviderChange => ({
  matched: false,
  structureChanged: false,
  changedModuleIds: [],
  changedFiles: [],
})

interface ProviderState<TData> {
  provider: RouteProvider<TData>
  watch: RouteProviderWatchConfig
  entries: NormalizedRouteProviderEntry<TData>[]
}

interface ProviderModule<TData> {
  provider: RouteProvider<TData>
  context: RouteProviderLoadContext<TData>
}

export class RouteProviderManager<TData> {
  private root = ''
  private states: ProviderState<TData>[] = []
  private readonly entries = new Map<string, NormalizedRouteProviderEntry<TData>>()
  private readonly modules = new Map<string, ProviderModule<TData>>()
  private readonly sourcePaths = new Map<string, string>()
  private readonly fileFilter: ReturnType<typeof createFilter>
  readonly providers: readonly RouteProvider<TData>[]

  constructor(routeProviders: readonly RouteProvider<TData>[], ignore: string[]) {
    this.providers = routeProviders.map((provider) => defineRouteProvider(provider))
    this.fileFilter = createFilter(['**/*'], ignore)
  }

  get enabled(): boolean {
    return this.providers.length > 0
  }

  async initialize(root: string): Promise<void> {
    this.root = normalizePath(root)
    this.states = this.providers.map((provider) => ({
      provider,
      watch: createRouteProviderWatchConfig(this.root, [
        provider.filter,
        ...(provider.watch ?? []),
      ]),
      entries: [],
    }))
    await this.refresh()
  }

  getEntries(): NormalizedRouteProviderEntry<TData>[] {
    return [...this.entries.values()].sort(
      (a, b) => a.routePath.localeCompare(b.routePath) || a.routeId.localeCompare(b.routeId),
    )
  }

  getWatchFiles(): string[] {
    const roots = this.states.flatMap((state) => state.watch.roots)
    const uncovered = [...this.sourcePaths.keys()].filter(
      (path) => !roots.some((root) => path === root || path.startsWith(`${root}/`)),
    )
    return [...new Set([...roots, ...uncovered])]
  }

  async loadModule(id: string): Promise<string | undefined> {
    const module = this.modules.get(normalizePath(id).replace(/\?.*$/, ''))
    if (!module) {
      return undefined
    }
    const code = await module.provider.load(module.context)
    if (!code) {
      throw new Error(
        `[solid-file-router] routeProvider.load returned no code for routeId: ${module.context.routeId}`,
      )
    }
    return code
  }

  async handleChange(file: string): Promise<RouteProviderChange> {
    const normalized = normalizePath(file)
    const providerIndexes = this.getMatchingProviderIndexes(normalized)
    if (providerIndexes.length === 0) {
      return noChange()
    }

    const previousModuleIds = this.getModuleIds()
    const previousModuleId = this.sourcePaths.get(normalized)
    const structureChanged = await this.refresh(this.getSnapshot(), providerIndexes)
    const nextModuleId = this.sourcePaths.get(normalized)
    const changedModuleIds = structureChanged
      ? uniqueModuleIds(previousModuleIds, this.getModuleIds())
      : previousModuleId || nextModuleId
        ? uniqueModuleIds([previousModuleId, nextModuleId])
        : this.getModuleIdsForProviders(providerIndexes)

    changedModuleIds.forEach(invalidateCache)
    return {
      matched: true,
      structureChanged,
      changedModuleIds,
      changedFiles: [normalized],
    }
  }

  private async refresh(previousSnapshot = '', providerIndexes?: number[]): Promise<boolean> {
    const selected = providerIndexes ? new Set(providerIndexes) : undefined
    const scanned = await Promise.all(
      this.states.map(async (state, index) => {
        if (selected && !selected.has(index)) {
          return state.entries
        }
        return this.scanProvider(state.provider)
      }),
    )
    this.states.forEach((state, index) => {
      state.entries = scanned[index] ?? []
    })

    const entries = mergeRouteProviderEntries(scanned)
    const structureChanged = previousSnapshot !== getSnapshot(entries)
    this.entries.clear()
    this.modules.clear()
    this.sourcePaths.clear()
    for (const entry of entries) {
      const sourceIndex = scanned.findIndex((items) => items.includes(entry))
      const provider = this.states[sourceIndex]?.provider
      if (!provider) {
        continue
      }
      this.entries.set(entry.moduleId, entry)
      this.modules.set(entry.moduleId, {
        provider,
        context: {
          routeId: entry.routeId,
          path: entry.routePath,
          sourcePath: entry.sourcePath!,
          moduleId: entry.moduleId,
          data: entry.data,
        } satisfies RouteProviderLoadContext<TData>,
      })
      this.sourcePaths.set(entry.sourcePath!, entry.moduleId)
    }
    return structureChanged
  }

  private async scanProvider(
    provider: RouteProvider<TData>,
  ): Promise<NormalizedRouteProviderEntry<TData>[]> {
    const files = await provider.glob!(glob, provider.filter, this.root)
    return files
      .map(normalizePath)
      .filter((file) => this.fileFilter(getRouteProviderFilterPath(this.root, file)))
      .map((file) => normalizeRouteProviderEntry(this.root, file, provider.transformPath!(file)))
  }

  private getMatchingProviderIndexes(file: string): number[] {
    return this.states
      .map((state, index) =>
        state.entries.some((entry) => entry.sourcePath === file) || state.watch.filter(file)
          ? index
          : -1,
      )
      .filter((index) => index >= 0)
  }

  private getModuleIdsForProviders(providerIndexes: number[]): string[] {
    const selected = new Set(providerIndexes)
    return [...this.modules.entries()]
      .filter(([moduleId]) => {
        const sourcePath = this.entries.get(moduleId)?.sourcePath
        return (
          !!sourcePath && this.getMatchingProviderIndexes(sourcePath).some((i) => selected.has(i))
        )
      })
      .map(([moduleId]) => moduleId)
  }

  private getModuleIds(): string[] {
    return [...this.modules.keys()]
  }

  private getSnapshot(): string {
    return getSnapshot(this.getEntries())
  }
}

function getSnapshot(entries: NormalizedRouteProviderEntry<unknown>[]): string {
  return entries
    .map(
      (entry) => `${entry.moduleId}|${entry.routeId}|${entry.routePath}|${entry.sourcePath ?? ''}`,
    )
    .sort()
    .join('\n')
}

function uniqueModuleIds(...groups: Array<Array<string | undefined>>): string[] {
  return [...new Set(groups.flat().filter((id): id is string => !!id))]
}
