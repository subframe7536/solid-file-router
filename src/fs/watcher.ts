import type { Plugin, ViteDevServer } from 'vite'

import type { BaseFileSystemRouter } from './router'

export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  delay: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (...args: Parameters<T>) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}

function setupWatcher(watcher: any, routes: BaseFileSystemRouter): void {
  watcher.on('unlink', (path: string) => routes.removeRoute(path))
  watcher.on('add', (path: string) => routes.addRoute(path))
  watcher.on('change', (path: string) => routes.updateRoute(path))
}

function createRoutesReloader(
  server: ViteDevServer,
  routes: BaseFileSystemRouter,
  environment: string,
  moduleId: string,
  onReload?: () => Promise<void> | void,
): (() => void) | undefined {
  const devEnv = (server.environments as Record<string, any>)[environment]
  if (!devEnv?.moduleGraph) {
    return
  }

  const invalidateModule = debounce((mod: any) => {
    devEnv.moduleGraph.invalidateModule(mod)
  }, 0)

  const reloadModule = debounce((mod: any) => {
    devEnv.reloadModule(mod)
  }, 200)

  return routes.on('reload', function handleRoutesReload(evt) {
    void onReload?.()
    const mod = devEnv.moduleGraph.getModuleById(moduleId)
    if (!mod) {
      devEnv.hot.send({ type: 'full-reload' })
      return
    }
    if (evt.detail.type !== 'update') {
      reloadModule(mod)
    } else {
      invalidateModule(mod)
    }
  })
}

export function fileSystemWatcher(
  getRouter: (environment: string) => BaseFileSystemRouter | undefined,
  moduleId: string,
  onReload?: () => Promise<void> | void,
): Plugin {
  return {
    name: 'solid-file-router:watcher',
    async configureServer(server) {
      const watched = new Set<BaseFileSystemRouter>()
      for (const environment of Object.keys(server.environments)) {
        const router = getRouter(environment)
        if (!router) {
          continue
        }
        if (!watched.has(router)) {
          watched.add(router)
          setupWatcher(server.watcher, router)
        }
        router
          .getRoutes()
          .then(() => createRoutesReloader(server, router, environment, moduleId, onReload))
      }
    },
  }
}
