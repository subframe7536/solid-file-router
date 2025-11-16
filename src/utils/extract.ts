import type * as Babel from '@babel/core'

export interface ExtractConfig {
  entryFn: string
  pick: string[]
  targetFn?: string
}

type State = Omit<Babel.PluginPass, 'opts'> & {
  opts: ExtractConfig
  hasExport: boolean
}

export function extractPlugin({
  types: t,
}: typeof Babel): Babel.PluginObj<State> {
  return {
    name: 'transform-default-export',
    post() {
      if (!this.hasExport) {
        throw new Error(`No default export with \`${this.opts.entryFn}({})\``)
      }
    },
    visitor: {
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
        } else {
          // Case 3: export { <identifier> as default } (where identifier is assigned to a call expression)
          const binding = path.scope.getBinding('default')
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
        // Validate function name
        if (
          !t.isIdentifier(callExpr.callee) ||
          callExpr.callee.name !== entryFn
        ) {
          throw new Error(
            `Expected function name to be "${entryFn}", but got "${
              (callExpr.callee as any).name || 'unknown'
            }"`,
          )
        }

        // Validate single object argument
        if (
          callExpr.arguments.length !== 1 ||
          !t.isObjectExpression(callExpr.arguments[0])
        ) {
          throw new Error(
            `Expected exactly one object argument for "${entryFn}"`,
          )
        }

        const objExpr = callExpr.arguments[0]

        // Ban spread at top level
        const hasSpread = objExpr.properties.some((prop) =>
          t.isSpreadElement(prop),
        )
        if (hasSpread) {
          throw new Error(
            `Spread expressions at the top level of ${entryFn}'s parameter will prevent treeshaking`,
          )
        }

        // Pick specified properties (shallow only)
        const filteredProperties = objExpr.properties.filter((prop) => {
          if (t.isObjectProperty(prop) || t.isObjectMethod(prop)) {
            const key = prop.key
            if (t.isIdentifier(key)) {
              return pick.includes(key.name)
            }
          }
          return false
        })

        // Create the new object with filtered properties
        const newNode = t.objectExpression(filteredProperties)
        // Wrap in finalFunctionName if provided, otherwise return plain object
        const targetNode = targetFn
          ? t.callExpression(t.identifier(targetFn), [newNode])
          : newNode

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

export async function extract(code: string, id: string, config: ExtractConfig) {
  const babel = await import('@babel/core')
  try {
    const transformed = await babel.transformAsync(code, {
      plugins: [[extractPlugin, config]],
      parserOpts: {
        plugins: ['jsx', 'typescript'],
      },
      filename: id,
      ast: false,
      sourceMaps: true,
      configFile: false,
      babelrc: false,
    })
    return transformed?.code
  } catch (error) {
    throw new Error(`${error}`)
  }
}
