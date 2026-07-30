import { glob } from 'tinyglobby'
import { createFilter, normalizePath } from 'vite'

import { invalidateCache } from './extract'
import {
  createRouteSourceWatchConfig,
  getRouteSourceFilterPath,
  mergeRouteSourceEntries,
  normalizeRouteSourceEntry,
} from './registry-source'
import type {
  NormalizedRouteSourceEntry,
  RouteSourceModule,
  RouteSourceState,
} from './registry-source'
import { defineRouteSource } from './source'
import type { RouteSourceProvider, RouteSourceLoadContext } from './source'

export interface CustomRouteChange {
  matched: boolean
  structureChanged: boolean
  changedModuleIds: string[]
  changedFiles: string[]
}

const noChange = (): CustomRouteChange => ({
  matched: false,
  structureChanged: false,
  changedModuleIds: [],
  changedFiles: [],
})

export class CustomRouteRegistry<TData> {
  private root = ''
  private states: RouteSourceState<TData>[] = []
  private readonly entries = new Map<string, NormalizedRouteSourceEntry<TData>>()
  private readonly modules = new Map<string, RouteSourceModule<TData>>()
  private readonly sourcePaths = new Map<string, string>()
  private readonly fileFilter: ReturnType<typeof createFilter>
  readonly providers: readonly RouteSourceProvider<TData>[]

  constructor(routeSources: readonly RouteSourceProvider<TData>[], ignore: string[]) {
    this.providers = routeSources.map((source) => defineRouteSource(source))
    this.fileFilter = createFilter(['**/*'], ignore)
  }

  get enabled(): boolean {
    return this.providers.length > 0
  }

  async initialize(root: string): Promise<void> {
    this.root = normalizePath(root)
    this.states = this.providers.map((provider) => ({
      provider,
      watch: createRouteSourceWatchConfig(this.root, [provider.filter, ...(provider.watch ?? [])]),
      entries: [],
    }))
    await this.refresh()
  }

  getEntries(): NormalizedRouteSourceEntry<TData>[] {
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
    const source = this.modules.get(normalizePath(id).replace(/\?.*$/, ''))
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

  async handleChange(file: string): Promise<CustomRouteChange> {
    const normalized = normalizePath(file)
    const sourceIndexes = this.getMatchingSourceIndexes(normalized)
    if (sourceIndexes.length === 0) {
      return noChange()
    }

    const previousModuleIds = this.getModuleIds()
    const previousModuleId = this.sourcePaths.get(normalized)
    const structureChanged = await this.refresh(this.getSnapshot(), sourceIndexes)
    const nextModuleId = this.sourcePaths.get(normalized)
    const changedModuleIds = structureChanged
      ? uniqueModuleIds(previousModuleIds, this.getModuleIds())
      : previousModuleId || nextModuleId
        ? uniqueModuleIds([previousModuleId, nextModuleId])
        : this.getModuleIdsForSources(sourceIndexes)

    changedModuleIds.forEach(invalidateCache)
    return {
      matched: true,
      structureChanged,
      changedModuleIds,
      changedFiles: [normalized],
    }
  }

  private async refresh(previousSnapshot = '', sourceIndexes?: number[]): Promise<boolean> {
    const selected = sourceIndexes ? new Set(sourceIndexes) : undefined
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

    const entries = mergeRouteSourceEntries(scanned)
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
        } satisfies RouteSourceLoadContext<TData>,
      })
      this.sourcePaths.set(entry.sourcePath!, entry.moduleId)
    }
    return structureChanged
  }

  private async scanProvider(
    source: RouteSourceProvider<TData>,
  ): Promise<NormalizedRouteSourceEntry<TData>[]> {
    const files = await source.glob!(glob, source.filter, this.root)
    return files
      .map(normalizePath)
      .filter((file) => this.fileFilter(getRouteSourceFilterPath(this.root, file)))
      .map((file) => normalizeRouteSourceEntry(this.root, file, source.transformPath!(file)))
  }

  private getMatchingSourceIndexes(file: string): number[] {
    return this.states
      .map((state, index) =>
        state.entries.some((entry) => entry.sourcePath === file) || state.watch.filter(file)
          ? index
          : -1,
      )
      .filter((index) => index >= 0)
  }

  private getModuleIdsForSources(sourceIndexes: number[]): string[] {
    const selected = new Set(sourceIndexes)
    return [...this.modules.entries()]
      .filter(([moduleId]) => {
        const sourcePath = this.entries.get(moduleId)?.sourcePath
        return (
          !!sourcePath && this.getMatchingSourceIndexes(sourcePath).some((i) => selected.has(i))
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

function getSnapshot(entries: NormalizedRouteSourceEntry<unknown>[]): string {
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
