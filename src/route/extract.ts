import type * as Babel from '@babel/core'

import { hashString, logger } from '../const'

export interface ExtractConfig {
  entryFn: string
  pick: string[]
  targetFn?: string
}

type State = Omit<Babel.PluginPass, 'opts'> & {
  opts: ExtractConfig
  hasExport: boolean
  routeBindings: Set<string>
  hasEntryBinding: boolean
}

interface TransformContext {
  t: typeof Babel.types
  entryFn: string
  pick: string[]
  targetFn?: string
}

/**
 * Validates a call expression matches the expected function and arguments
 */
function validateCallExpression(callExpr: any, ctx: TransformContext): void {
  const { t, entryFn } = ctx

  if (callExpr.arguments.length !== 1 || !t.isObjectExpression(callExpr.arguments[0])) {
    throw new Error(`Expected exactly one object argument for "${entryFn}"`)
  }
}

function isRouteCall(
  callExpr: Babel.types.CallExpression,
  state: State,
  t: typeof Babel.types,
): boolean {
  if (!t.isIdentifier(callExpr.callee)) {
    return false
  }
  if (state.routeBindings.size > 0) {
    return state.routeBindings.has(callExpr.callee.name)
  }
  // Preserve the historical transform for virtual/custom modules that omit an
  // import, while never accepting a binding from another module or local scope.
  return !state.hasEntryBinding && callExpr.callee.name === state.opts.entryFn
}

/**
 * Extracts and filters properties from an object expression
 */
function extractFilteredProperties(objExpr: any, ctx: TransformContext): any[] {
  const { t, pick, entryFn } = ctx

  // Ban spread at top level
  const hasSpread = objExpr.properties.some((prop: any) => t.isSpreadElement(prop))
  if (hasSpread) {
    throw new Error(
      `Spread expressions at the top level of ${entryFn}'s parameter will prevent treeshaking`,
    )
  }

  // Pick specified properties (shallow only)
  return objExpr.properties.filter((prop: any) => {
    if (t.isObjectProperty(prop) || t.isObjectMethod(prop)) {
      const key = prop.key
      if (t.isIdentifier(key)) {
        return pick.includes(key.name)
      }
      if (t.isStringLiteral(key) && prop.computed === false) {
        return pick.includes(key.value)
      }
    }
    return false
  })
}

/**
 * Creates the transformed node, optionally wrapped with targetFn
 */
function createTransformedNode(filteredProperties: any[], ctx: TransformContext): any {
  const { t, targetFn } = ctx

  const newNode = t.objectExpression(filteredProperties)
  return targetFn ? t.callExpression(t.identifier(targetFn), [newNode]) : newNode
}

export function extractPlugin({ types: t }: typeof Babel): Babel.PluginObj<State> {
  return {
    name: 'transform-default-export',
    post() {
      if (!this.hasExport) {
        throw new Error(`No default export with \`${this.opts.entryFn}({})\``)
      }
    },
    visitor: {
      Program(path, state) {
        state.routeBindings = new Set()
        state.hasEntryBinding = false
        for (const statement of path.node.body) {
          if (!t.isImportDeclaration(statement) || statement.source.value !== 'solid-file-router') {
            continue
          }
          for (const specifier of statement.specifiers) {
            if (
              t.isImportSpecifier(specifier) &&
              t.isIdentifier(specifier.imported) &&
              specifier.imported.name === state.opts.entryFn
            ) {
              state.routeBindings.add(specifier.local.name)
            }
          }
        }
        const binding = path.scope.getBinding(state.opts.entryFn)
        state.hasEntryBinding = !!binding
      },
      ExportNamedDeclaration(path, state) {
        const { entryFn, pick, targetFn } = state.opts

        // Check for export { x as default }
        const defaultSpec = path.node.specifiers.find(
          (spec) =>
            t.isExportSpecifier(spec) &&
            t.isIdentifier(spec.exported) &&
            spec.exported.name === 'default',
        )

        if (!defaultSpec || !t.isExportSpecifier(defaultSpec)) {
          return
        }

        const localName = (defaultSpec as any).local.name
        const binding = path.scope.getBinding(localName)

        if (binding && t.isVariableDeclarator(binding.path.node)) {
          const init = binding.path.node.init
          if (!t.isCallExpression(init) || !isRouteCall(init, state, t)) {
            return
          }

          state.hasExport = true

          const ctx = { t, entryFn, pick, targetFn }
          validateCallExpression(init, ctx)
          const filteredProperties = extractFilteredProperties(init.arguments[0], ctx)
          const targetNode = createTransformedNode(filteredProperties, ctx)

          // Update the variable declarator
          binding.path.node.init = targetNode
        }
      },
      ExportDefaultDeclaration(path, state) {
        const { entryFn, pick, targetFn } = state.opts

        let callExpr = null
        let updatePath: Babel.NodePath<Babel.types.Node> | null = null

        // Case 1: export default <functionName>(...)
        if (t.isCallExpression(path.node.declaration)) {
          callExpr = path.node.declaration
          updatePath = path
        }
        // Case 2: export default <identifier> (where identifier is assigned to a call expression)
        else if (t.isIdentifier(path.node.declaration)) {
          const binding = path.scope.getBinding(path.node.declaration.name)
          if (binding && t.isVariableDeclarator(binding.path.node)) {
            const init = binding.path.node.init
            if (t.isCallExpression(init)) {
              callExpr = init
              updatePath = binding.path
            }
          }
        }

        // Transform if we found a call expression
        if (!callExpr || !updatePath || !isRouteCall(callExpr, state, t)) {
          return
        }

        state.hasExport = true

        const ctx = { t, entryFn, pick, targetFn }
        validateCallExpression(callExpr, ctx)
        const filteredProperties = extractFilteredProperties(callExpr.arguments[0], ctx)
        const targetNode = createTransformedNode(filteredProperties, ctx)

        // Update the appropriate node
        if (updatePath === path) {
          path.node.declaration = targetNode
        } else if (updatePath.isVariableDeclarator()) {
          updatePath.node.init = targetNode
        }
      },
    },
  }
}

// Promise-based AST cache
const astPromiseCache = new Map<string, Promise<Babel.types.File | null>>()
let babelModulePromise: Promise<typeof Babel> | undefined

export function getAstCacheKey(id: string, code: string, ssr: boolean): string {
  return `${id}?ssr=${ssr}&hash=${hashString(code)}`
}

async function getBabel(): Promise<typeof Babel> {
  babelModulePromise ??= import('@babel/core')
  return await babelModulePromise
}

export function invalidateCache(id: string): void {
  for (const key of astPromiseCache.keys()) {
    if (key === id || key.startsWith(`${id}?`)) {
      astPromiseCache.delete(key)
    }
  }
}

export function clearCache(): void {
  astPromiseCache.clear()
}

export async function extract(
  code: string,
  id: string,
  config: ExtractConfig,
  verbose = false,
  cacheKey = getAstCacheKey(id, code, false),
  sourcePath?: string,
): Promise<{ code: string; map: Babel.BabelFileResult['map'] } | undefined> {
  const babel = await getBabel()

  // Get or create AST parsing promise
  let astPromise = astPromiseCache.get(cacheKey)

  if (!astPromise) {
    if (verbose) {
      logger.info(`AST cache miss: ${cacheKey}`, { timestamp: false })
    }

    astPromise = babel
      .parseAsync(code, {
        parserOpts: {
          plugins: ['jsx', 'typescript'],
        },
        filename: id,
      })
      .catch((error) => {
        // Remove failed promise from cache to allow retry
        astPromiseCache.delete(cacheKey)
        throw error
      })

    astPromiseCache.set(cacheKey, astPromise)
  } else if (verbose) {
    logger.info(`AST cache hit:  ${cacheKey}`, { timestamp: false })
  }

  const ast = await astPromise

  if (!ast) {
    return undefined
  }

  try {
    const transformed = await babel.transformFromAstAsync(ast, code, {
      plugins: [[extractPlugin, config]],
      filename: id,
      sourceFileName: sourcePath,
      sourceMaps: true,
      configFile: false,
      babelrc: false,
      cloneInputAst: true,
    })

    if (!transformed?.code) {
      return undefined
    }
    return {
      code: transformed.code,
      map: transformed.map ?? null,
    }
  } catch (error) {
    throw new Error(`[solid-file-router] Failed to extract route ${id}: ${error}`)
  }
}
