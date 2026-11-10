import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

import type { PluginOption } from 'vite'

import { PageFileSystemRouter } from './convention'
import { normalizePath } from './router'
import type { BaseFileSystemRouter } from './router'
import { buildRouteTree } from './tree'
import { sanitizeChunkFileName, toPickId, treeShake } from './tree-shake'
import type { FileRoutesOptions, ModuleRef, RouteManifestEntry } from './types'
import { serializeTypes } from './types-gen'
import { fileSystemWatcher } from './watcher'

export const DEFAULT_EXTENSIONS = ['js', 'jsx', 'ts', 'tsx', 'tsrx']
export const DEFAULT_MODULE_ID = 'virtual:file-routes'
export const flagsId = 'filesystem-routing/flags'
export const resolvedFlagsId = `\0${flagsId}`

const HANDLER_REF = /^\$[A-Z]+$/

const isServerConsumer = (name: string, consumer?: string): boolean =>
  (consumer ?? (name === 'client' ? 'client' : 'server')) === 'server'

const toModuleId = (route: RouteManifestEntry, ref: ModuleRef, serverConsumer: boolean): string =>
  serverConsumer && route.server === true && ref.src === route.$component?.src
    ? ref.src
    : toPickId(ref.src, ref.pick)

function stripHandlerRefs(routes: readonly RouteManifestEntry[]): RouteManifestEntry[] {
  const stripped: RouteManifestEntry[] = []
  for (const route of routes) {
    const handlerKeys = Object.keys(route).filter((key) => HANDLER_REF.test(key))
    if (!handlerKeys.length) {
      stripped.push(route)
      continue
    }
    const rest = { ...route }
    for (const key of handlerKeys) {
      delete rest[key]
    }
    if (
      rest.page ||
      Object.keys(rest).some((key) => key.startsWith('$') && rest[key] !== undefined)
    ) {
      stripped.push(rest)
    }
  }
  return stripped
}

function jsCode(): {
  addNamedImport: (name: string, source: string) => string
  addNamespaceImport: (source: string) => string
  getImportStatements: () => string
} {
  const imports = new Map<string, Record<string, string>>()
  const namespaceImports = new Map<string, string>()
  let vars = 0

  function addNamedImport(name: string, source: string): string {
    let names = imports.get(source)
    if (!names) {
      names = {}
      imports.set(source, names)
    }
    const existing = names[name]
    if (existing) {
      return existing
    }
    const alias = `routeData${vars++}`
    names[name] = alias
    return alias
  }

  function addNamespaceImport(source: string): string {
    const existing = namespaceImports.get(source)
    if (existing) {
      return existing
    }
    const alias = `routeModule${namespaceImports.size}`
    namespaceImports.set(source, alias)
    return alias
  }

  function getImportStatements(): string {
    return [
      ...[...imports.entries()].map(
        ([source, names]) =>
          `import { ${Object.entries(names)
            .map(([name, alias]) => `${name} as ${alias}`)
            .join(', ')} } from '${source}';`,
      ),
      ...[...namespaceImports.entries()].map(
        ([source, alias]) => `import * as ${alias} from '${source}';`,
      ),
    ].join('\n')
  }

  return {
    addNamedImport,
    addNamespaceImport,
    getImportStatements,
  }
}

/**
 * Vite delivery plugin that serializes the neutral route manifest into virtual modules.
 */
export function fileRoutes(options: FileRoutesOptions = {}): PluginOption[] {
  const virtualId = options.moduleId ?? DEFAULT_MODULE_ID
  const codeSplitting = options.codeSplitting !== false
  const buildInputs = options.buildInputs
    ? Array.isArray(options.buildInputs)
      ? options.buildInputs
      : [options.buildInputs]
    : []
  let defaultRouter = options.router
  let root = process.cwd()

  const getRouter = (environment: string): BaseFileSystemRouter | undefined =>
    options.routers?.[environment] ?? defaultRouter

  async function writeTypes(): Promise<void> {
    if (!options.types) {
      return
    }
    const router = getRouter('client')
    if (!router) {
      return
    }
    const file = resolve(root, options.types === true ? 'src/routes.d.ts' : options.types)
    const routes = (await router.getRoutes()) ?? []
    const contents = serializeTypes(
      virtualId,
      routes,
      buildRouteTree(routes.filter((route) => route.page)),
      dirname(file),
      codeSplitting,
    )

    let previous: string | undefined
    try {
      previous = readFileSync(file, 'utf-8')
    } catch {}
    if (previous === contents) {
      return
    }
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, contents)
  }

  return [
    {
      name: 'solid-file-router:routes',
      enforce: 'pre',
      config() {
        return {
          build: {
            rollupOptions: {
              output: {
                sanitizeFileName: sanitizeChunkFileName,
              },
            },
          },
          ...(options.optimizeDepsExclude?.length
            ? { optimizeDeps: { exclude: options.optimizeDepsExclude } }
            : {}),
        }
      },
      configResolved(config) {
        root = config.root
        if (!defaultRouter) {
          defaultRouter = new PageFileSystemRouter({
            dir: normalizePath(resolve(config.root, options.dir ?? 'src/routes')),
            extensions: options.extensions ?? DEFAULT_EXTENSIONS,
            components: options.components,
            httpMethods: options.httpMethods,
            serverComponents: options.serverComponents,
            toPath: options.toPath,
            toRoute: options.toRoute,
          })
        }
      },
      async buildStart() {
        await writeTypes()
      },
      async configEnvironment(name, _config, env) {
        if (!codeSplitting) {
          return
        }
        if (env.command !== 'build' || !buildInputs.includes(name)) {
          return
        }
        const router = getRouter(name)
        if (!router) {
          return
        }
        const serverConsumer = isServerConsumer(name, _config.consumer)
        const routes =
          options.routers?.[name] || serverConsumer
            ? await router.getRoutes()
            : stripHandlerRefs(await router.getRoutes())

        const input: string[] = []
        for (const route of routes) {
          for (const [key, ref] of Object.entries(route)) {
            const moduleRef = ref as ModuleRef | undefined
            if (moduleRef && key.startsWith('$') && !key.startsWith('$$') && !moduleRef.eager) {
              input.push(toModuleId(route, moduleRef, serverConsumer))
            }
          }
        }
        if (!input.length) {
          return
        }
        return { build: { rollupOptions: { input } } }
      },
      resolveId(source) {
        if (source === virtualId) {
          return virtualId
        }
        if (source === flagsId) {
          return resolvedFlagsId
        }
      },
      async load(loadedId) {
        if (loadedId === resolvedFlagsId) {
          const router = getRouter(this.environment.name)
          const routes = (router && (await router.getRoutes())) ?? []
          const serverRoutes =
            this.environment.mode !== 'build' || routes.some((route) => route.server === true)
          return `export const serverRoutes = ${serverRoutes};`
        }
        if (loadedId !== virtualId) {
          return
        }
        const envRoot = this.environment.config.root
        const isBuild = this.environment.mode === 'build'
        const js = jsCode()
        const environmentName = this.environment.name
        const router = getRouter(environmentName)
        let routes = (router ? await router.getRoutes() : []) ?? []
        const serverConsumer = isServerConsumer(environmentName, this.environment.config.consumer)

        if (!options.routers?.[environmentName] && !serverConsumer) {
          routes = stripHandlerRefs(routes)
        }

        const serializeEntry = (entry: RouteManifestEntry): string =>
          JSON.stringify(entry, (key, value) => {
            if (value === undefined) {
              return undefined
            }
            if (key.startsWith('$$')) {
              const buildId = toModuleId(entry, value, serverConsumer)
              const refs: Record<string, string> = {}
              for (const pick of value.pick) {
                refs[pick] = js.addNamedImport(pick, buildId)
              }
              return {
                require: `_$() => ({ ${Object.entries(refs)
                  .map(([pick, namedImport]) => `'${pick}': ${namedImport}`)
                  .join(', ')} })$_`,
              }
            } else if (key.startsWith('$')) {
              const buildId = toModuleId(entry, value, serverConsumer)
              const src = normalizePath(relative(envRoot, buildId))
              if (!codeSplitting || value.eager) {
                return {
                  src,
                  require: `_$() => (${js.addNamespaceImport(buildId)})$_`,
                }
              }
              return {
                src,
                build: isBuild ? `_$() => import('${buildId}')$_` : undefined,
                import: `_$() => import('${buildId}')$_`,
              }
            }
            return value
          })
            .replaceAll('"_$(', '(')
            .replaceAll(')$_"', ')')

        const bindings = routes.map(
          (route, index) => `const route${index} = ${serializeEntry(route)};`,
        )
        const tree = buildRouteTree(
          routes
            .map((route, index) => ({ path: route.path, page: route.page, index }))
            .filter((stub) => stub.page) as any,
        )

        const serializeTree = (nodes: any[]): string =>
          `[${nodes
            .map((node) => {
              const fields = [
                `...route${node.index}`,
                `id: ${JSON.stringify(node.id)}`,
                `path: ${JSON.stringify(node.path)}`,
              ]
              if (node.children) {
                fields.push(`children: ${serializeTree(node.children)}`)
              }
              return `{ ${fields.join(', ')} }`
            })
            .join(', ')}]`

        return `${js.getImportStatements()}
${bindings.join('\n')}
const routes = [${routes.map((_, index) => `route${index}`).join(', ')}];
export default routes;
export const pageRoutes = ${serializeTree(tree)};
`
      },
    },
    treeShake(),
    fileSystemWatcher(getRouter, virtualId, writeTypes),
  ]
}
