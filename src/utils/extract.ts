import type * as Babel from '@babel/core'
import { logger } from '../const'

export interface ExtractConfig {
  entryFn: string
  pick: string[]
  targetFn?: string
}

type State = Omit<Babel.PluginPass, 'opts'> & {
  opts: ExtractConfig
  hasExport: boolean
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

  if (!t.isIdentifier(callExpr.callee) || callExpr.callee.name !== entryFn) {
    throw new Error(
      `Expected function name to be "${entryFn}", but got "${callExpr.callee.name || 'unknown'}"`,
    )
  }

  if (callExpr.arguments.length !== 1 || !t.isObjectExpression(callExpr.arguments[0])) {
    throw new Error(`Expected exactly one object argument for "${entryFn}"`)
  }
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
          if (!t.isCallExpression(init)) {
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
        let updatePath = null

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
        if (!callExpr || !updatePath) {
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
        } else {
          // @ts-expect-error 🤮
          updatePath.node.init = targetNode
        }
      },
    },
  }
}

interface AstCacheEntry {
  code: string
  ast: Babel.types.File
}

const astCache = new Map<string, AstCacheEntry>()

export function invalidateCache(id: string): void {
  astCache.delete(id)
}

async function parseToAst(code: string, id: string): Promise<Babel.types.File | null | undefined> {
  const babel = await import('@babel/core')
  const result = await babel.parseAsync(code, {
    parserOpts: {
      plugins: ['jsx', 'typescript'],
    },
    filename: id,
  })
  return result
}

export async function extract(code: string, id: string, config: ExtractConfig, verbose = false) {
  const babel = await import('@babel/core')

  let ast: Babel.types.File | null | undefined
  const cached = astCache.get(id)

  if (cached && cached.code === code) {
    ast = cached.ast
    if (verbose) {
      logger.info(`AST cache hit:  ${id}`, { timestamp: false })
    }
  } else {
    ast = await parseToAst(code, id)
    if (ast) {
      astCache.set(id, { code, ast })
      if (verbose) {
        logger.info(`AST cache save: ${id}`, { timestamp: false })
      }
    }
  }

  if (!ast) {
    return undefined
  }

  try {
    const transformed = await babel.transformFromAstAsync(ast, code, {
      plugins: [[extractPlugin, config]],
      filename: id,
      sourceMaps: true,
      configFile: false,
      babelrc: false,
      cloneInputAst: true,
    })

    return transformed?.code ?? undefined
  } catch (error) {
    throw new Error(`${error}`)
  }
}
