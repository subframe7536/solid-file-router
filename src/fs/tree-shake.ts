import { extname } from 'node:path'

import MagicString from 'magic-string'
import { parseSync } from 'vite'
import type { Plugin } from 'vite'

const PICKABLE_EXTENSIONS = new Set(['js', 'jsx', 'ts', 'tsx'])

const TYPE_ONLY_ANCESTORS = new Set([
  'TSArrayType',
  'TSClassImplements',
  'TSConditionalType',
  'TSConstructorType',
  'TSFunctionType',
  'TSImportType',
  'TSIndexedAccessType',
  'TSInferType',
  'TSInterfaceHeritage',
  'TSIntersectionType',
  'TSLiteralType',
  'TSMappedType',
  'TSOptionalType',
  'TSParenthesizedType',
  'TSRestType',
  'TSTemplateLiteralType',
  'TSThisType',
  'TSTupleType',
  'TSTypeLiteral',
  'TSTypeOperator',
  'TSTypePredicate',
  'TSTypeQuery',
  'TSTypeReference',
  'TSUnionType',
])

function forEachChild(node: any, visit: (child: any) => void): void {
  for (const key in node) {
    const value = node[key]
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item.type === 'string') {
          visit(item)
        }
      }
    } else if (value && typeof value.type === 'string') {
      visit(value)
    }
  }
}

function unwrapParentheses(node: any): void {
  for (const key in node) {
    const value = node[key]
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        while (item?.type === 'ParenthesizedExpression') {
          value[index] = item = item.expression
        }
      })
    } else {
      let inner = value
      while (inner?.type === 'ParenthesizedExpression') {
        node[key] = inner = inner.expression
      }
    }
  }
}

function isFunctionLike(node: any): boolean {
  return (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression'
  )
}

function isClassLike(node: any): boolean {
  return node.type === 'ClassDeclaration' || node.type === 'ClassExpression'
}

function isNamedDeclaration(node: any): boolean {
  return node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration'
}

function isExportWrapper(node: any): boolean {
  return node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration'
}

function isReference(node: any, parent: any, grandparent: any): boolean {
  if (
    node.type === 'JSXIdentifier' &&
    parent.type !== 'JSXMemberExpression' &&
    /^[a-z]/.test(node.name)
  ) {
    return false
  }
  switch (parent.type) {
    case 'MemberExpression':
      return parent.property === node ? parent.computed : true
    case 'JSXMemberExpression':
      return parent.object === node
    case 'VariableDeclarator':
      return parent.init === node
    case 'ArrowFunctionExpression':
      return parent.body === node
    case 'Property':
      if (parent.key === node) {
        return parent.computed
      }
      return grandparent?.type !== 'ObjectPattern'
    case 'MethodDefinition':
    case 'TSAbstractMethodDefinition':
      return parent.key === node ? parent.computed : false
    case 'PropertyDefinition':
    case 'AccessorProperty':
    case 'TSAbstractPropertyDefinition':
    case 'TSAbstractAccessorProperty':
    case 'TSPropertySignature':
      return parent.key === node ? parent.computed : true
    case 'ClassDeclaration':
    case 'ClassExpression':
      return parent.superClass === node
    case 'AssignmentExpression':
    case 'AssignmentPattern':
      return parent.right === node
    case 'ExportSpecifier':
      return parent.local === node && !grandparent?.source
    case 'TSEnumMember':
      return parent.id !== node
    case 'TSQualifiedName':
      return parent.right !== node
    case 'TSTypeParameter':
      return parent.name !== node
    case 'TSMappedType':
      return parent.key !== node
    case 'LabeledStatement':
    case 'CatchClause':
    case 'RestElement':
    case 'BreakStatement':
    case 'ContinueStatement':
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ExportAllDeclaration':
    case 'ImportDefaultSpecifier':
    case 'ImportNamespaceSpecifier':
    case 'ImportSpecifier':
    case 'ImportAttribute':
    case 'JSXAttribute':
    case 'ObjectPattern':
    case 'ArrayPattern':
    case 'MetaProperty':
      return false
    default:
      return true
  }
}

function patternIdentifiers(pattern: any, out: any[] = []): any[] {
  switch (pattern?.type) {
    case 'Identifier':
      out.push(pattern)
      break
    case 'ObjectPattern':
      for (const property of pattern.properties) {
        patternIdentifiers(property.type === 'Property' ? property.value : property, out)
      }
      break
    case 'ArrayPattern':
      for (const element of pattern.elements) {
        patternIdentifiers(element, out)
      }
      break
    case 'AssignmentPattern':
      patternIdentifiers(pattern.left, out)
      break
    case 'RestElement':
      patternIdentifiers(pattern.argument, out)
      break
    case 'TSParameterProperty':
      patternIdentifiers(pattern.parameter, out)
      break
  }
  return out
}

function lookup(start: any, name: string): any {
  let previous: any
  for (let scope = start; scope; previous = scope, scope = scope.parent) {
    const binding = scope.bindings.get(name)
    if (binding) {
      if (!previous?.isParams || binding.kind !== 'declared') {
        return binding
      }
    } else if (name === 'arguments' && scope.ownsArguments) {
      return
    }
  }
}

function crawl(program: any, tree: any): { bindingOf: (identifier: any) => any } {
  const { parents, removed, unexported, localDeclarators } = tree
  const scopes = new Map<any, any>()
  const references: [string, any, any][] = []
  const violations: [string, any, any][] = []

  function childScope(parent: any, options: any = {}): any {
    return {
      parent,
      bindings: new Map<string, any>(),
      ...options,
    }
  }

  function declare(scope: any, name: string, declaration: any, kind: string): void {
    const existing = scope.bindings.get(name)
    if (existing) {
      existing.violations.push(declaration)
    } else {
      scope.bindings.set(name, { kind, declaration, references: [], violations: [] })
    }
  }

  function declareExportReferences(node: any, scope: any): void {
    const declaration = node.declaration
    if (!declaration || unexported.has(node)) {
      return
    }
    if (isNamedDeclaration(declaration)) {
      if (declaration.id) {
        references.push([declaration.id.name, scope, node])
      }
    } else if (declaration.type === 'VariableDeclaration') {
      for (const declarator of declaration.declarations) {
        if (removed.has(declarator) || localDeclarators.has(declarator)) {
          continue
        }
        for (const id of patternIdentifiers(declarator.id)) {
          references.push([id.name, scope, node])
        }
      }
    }
  }

  function visitChildren(node: any, scope: any): void {
    forEachChild(node, (child) => visit(child, scope))
  }

  function visit(node: any, scope: any): void {
    if (removed.has(node)) {
      return
    }
    switch (node.type) {
      case 'TSTypeAnnotation':
        return
      case 'TSImportEqualsDeclaration':
        declare(scope, node.id.name, node, 'declared')
        visit(node.moduleReference, scope)
        return
      case 'Identifier':
      case 'JSXIdentifier':
        if (isReference(node, parents.get(node), parents.get(parents.get(node)))) {
          references.push([node.name, scope, node])
        }
        break
      case 'ImportDeclaration':
        for (const specifier of node.specifiers) {
          if (!removed.has(specifier)) {
            declare(scope, specifier.local.name, specifier, 'declared')
          }
        }
        return
      case 'ExportNamedDeclaration':
      case 'ExportDefaultDeclaration':
        declareExportReferences(node, scope)
        break
      case 'VariableDeclaration': {
        let target = scope
        if (node.kind === 'var') {
          while (!target.hoists && target.parent) {
            target = target.parent
          }
        }
        for (const declarator of node.declarations) {
          if (removed.has(declarator)) {
            continue
          }
          for (const id of patternIdentifiers(declarator.id)) {
            declare(target, id.name, declarator, 'declared')
          }
        }
        break
      }
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        if (node.type === 'FunctionDeclaration' && node.id) {
          declare(scope, node.id.name, node, 'declared')
        }
        const inner = childScope(scope, {
          hoists: true,
          ownsArguments: node.type !== 'ArrowFunctionExpression',
        })
        scopes.set(node, inner)
        if (node.type === 'FunctionExpression' && node.id) {
          declare(inner, node.id.name, node, 'local')
        }
        const params = childScope(inner, { isParams: true })
        for (const param of node.params) {
          for (const id of patternIdentifiers(param)) {
            declare(inner, id.name, param, 'param')
          }
          visit(param, params)
        }
        forEachChild(node, (child) => {
          if (node.params.includes(child)) {
            return
          }
          if (child === node.body && child.type === 'BlockStatement') {
            scopes.set(child, inner)
            visitChildren(child, inner)
          } else {
            visit(child, inner)
          }
        })
        return
      }
      case 'ClassDeclaration':
      case 'ClassExpression': {
        if (node.type === 'ClassDeclaration' && node.id && !node.declare) {
          declare(scope, node.id.name, node, 'declared')
        }
        const inner = childScope(scope)
        scopes.set(node, inner)
        if (node.type === 'ClassExpression' && node.id) {
          declare(inner, node.id.name, node, 'local')
        }
        visitChildren(node, inner)
        return
      }
      case 'CatchClause': {
        const inner = childScope(scope)
        scopes.set(node, inner)
        for (const id of patternIdentifiers(node.param)) {
          declare(inner, id.name, node, 'declared')
        }
        if (node.param) {
          visit(node.param, inner)
        }
        scopes.set(node.body, inner)
        visitChildren(node.body, inner)
        return
      }
      case 'StaticBlock':
      case 'TSModuleBlock': {
        const inner = childScope(scope, { hoists: true })
        scopes.set(node, inner)
        visitChildren(node, inner)
        return
      }
      case 'SwitchStatement': {
        visit(node.discriminant, scope)
        const inner = childScope(scope)
        scopes.set(node, inner)
        for (const switchCase of node.cases) {
          visit(switchCase, inner)
        }
        return
      }
      case 'ForInStatement':
      case 'ForOfStatement':
      case 'ForStatement':
      case 'BlockStatement':
      case 'WhileStatement':
      case 'DoWhileStatement': {
        const inner = childScope(scope)
        scopes.set(node, inner)
        if (node.left && node.left.type !== 'VariableDeclaration') {
          for (const id of patternIdentifiers(node.left)) {
            violations.push([id.name, inner, node])
          }
        }
        visitChildren(node, inner)
        return
      }
      case 'AssignmentExpression':
        for (const id of patternIdentifiers(node.left)) {
          violations.push([id.name, scope, node])
        }
        break
      case 'UpdateExpression':
        if (node.argument.type === 'Identifier') {
          violations.push([node.argument.name, scope, node])
        }
        break
      case 'UnaryExpression':
        if (node.operator === 'delete' && node.argument.type === 'Identifier') {
          violations.push([node.argument.name, scope, node])
        }
        break
    }
    visitChildren(node, scope)
  }

  const root = { bindings: new Map<string, any>(), hoists: true }
  scopes.set(program, root)
  visitChildren(program, root)

  for (const [name, scope, node] of references) {
    lookup(scope, name)?.references.push(node)
  }
  for (const [name, scope, node] of violations) {
    lookup(scope, name)?.violations.push(node)
  }

  function bindingOf(identifier: any): any {
    let node = parents.get(identifier)
    if (isNamedDeclaration(node)) {
      node = parents.get(node)
    }
    while (node && !scopes.has(node)) {
      node = parents.get(node)
    }
    return node && lookup(scopes.get(node), identifier.name)
  }

  return { bindingOf }
}

function isTypeOnly(reference: any, tree: any): boolean {
  const { parents, localDeclarators } = tree
  for (let node = reference; node; node = parents.get(node)) {
    if (TYPE_ONLY_ANCESTORS.has(node.type)) {
      return true
    }
    if (node.type === 'ExportSpecifier' && node.exportKind === 'type') {
      return true
    }
    if (node.type === 'ExportNamedDeclaration' && node.exportKind === 'type') {
      if (!node.declaration?.declarations?.some((d: any) => localDeclarators.has(d))) {
        return true
      }
    }
  }
  return false
}

function isInside(node: any, ancestor: any, parents: Map<any, any>): boolean {
  for (let parent = parents.get(node); parent; parent = parents.get(parent)) {
    if (parent === ancestor) {
      return true
    }
  }
  return false
}

function isBindingReferenced(binding: any, tree: any, includeTypes: boolean): boolean {
  if (!binding) {
    return false
  }
  const references = binding.violations.concat(
    includeTypes
      ? binding.references
      : binding.references.filter((reference: any) => !isTypeOnly(reference, tree)),
  )
  if (!references.length) {
    return false
  }
  if (binding.declaration.type === 'FunctionDeclaration') {
    return !references.every((ref: any) => isInside(ref, binding.declaration, tree.parents))
  }
  return true
}

function boundIdentifier(node: any, parents: Map<any, any>): any {
  const parent = parents.get(node)
  if (parent.type === 'VariableDeclarator') {
    return parent.id.type === 'Identifier' ? parent.id : null
  }
  if (parent.type === 'AssignmentExpression') {
    return parent.left.type === 'Identifier' ? parent.left : null
  }
  if (node.type === 'ArrowFunctionExpression') {
    return null
  }
  return node.id?.type === 'Identifier' ? node.id : null
}

function isOwnExpressionName(identifier: any, parents: Map<any, any>): boolean {
  const parent = parents.get(identifier)
  return (
    (parent.type === 'FunctionExpression' || parent.type === 'ClassExpression') &&
    parent.id === identifier
  )
}

function isKeptWithDeadBinding(identifier: any, parents: Map<any, any>): boolean {
  const parent = parents.get(identifier)
  if (parent.type === 'AssignmentExpression') {
    return parents.get(parent).type !== 'ExpressionStatement'
  }
  return parent.type === 'Property' && parents.get(parent).properties.at(-1).type === 'RestElement'
}

function patternLocals(pattern: any): [any, any][] {
  if (pattern.type === 'ObjectPattern') {
    return pattern.properties.flatMap((property: any) => {
      const local = property.type === 'Property' ? property.value : property.argument
      return local.type === 'Identifier' ? [[property, local]] : []
    })
  }
  return pattern.elements.flatMap((element: any) => {
    if (element?.type === 'Identifier') {
      return [[element, element]]
    }
    if (element?.type === 'RestElement' && element.argument.type === 'Identifier') {
      return [[element, element.argument]]
    }
    return []
  })
}

function exportedName(specifier: any): string {
  return specifier.exported.name ?? specifier.exported.value
}

function removeStatement(node: any, tree: any): void {
  tree.removed.add(node)
  const parent = tree.parents.get(node)
  if (isExportWrapper(parent)) {
    tree.removed.add(parent)
  }
}

function removeDeclarator(declarator: any, tree: any): boolean {
  const { parents, removed } = tree
  const declaration = parents.get(declarator)
  const owner = parents.get(declaration)
  if (
    (owner.type === 'ForInStatement' || owner.type === 'ForOfStatement') &&
    owner.left === declaration
  ) {
    return false
  }
  removed.add(declarator)
  if (declaration.declarations.every((d: any) => removed.has(d))) {
    removeStatement(declaration, tree)
  }
  return true
}

function removeUnreachable(
  program: any,
  tree: any,
  sweepable: Set<any>,
  candidates: Set<any>,
): void {
  const { parents, removed, unexported, localDeclarators } = tree
  const { bindingOf } = crawl(program, tree)
  const tracked = new Map<any, Set<any>>()
  const candidateOwners = new Map<any, Set<any>>()

  function addOwner(owners: Map<any, Set<any>>, binding: any, owner: any): void {
    const nodes = owners.get(binding) ?? new Set()
    nodes.add(owner)
    owners.set(binding, nodes)
  }

  for (const identifier of sweepable) {
    if (isOwnExpressionName(identifier, parents) || isKeptWithDeadBinding(identifier, parents)) {
      continue
    }
    const binding = bindingOf(identifier)
    if (!binding) {
      continue
    }
    addOwner(tracked, binding, parents.get(identifier))
    if (candidates.has(identifier)) {
      addOwner(candidateOwners, binding, parents.get(identifier))
    }
  }

  const isInsideExport = (owner: any): boolean => {
    if (localDeclarators.has(owner)) {
      return false
    }
    for (let node = parents.get(owner); node; node = parents.get(node)) {
      if (localDeclarators.has(node)) {
        return false
      }
      if (isExportWrapper(node) && !unexported.has(node)) {
        return true
      }
    }
    return false
  }

  const ownerBindings = new Map<any, any>()
  const dependencies = new Map<any, Set<any>>()
  const live = new Set<any>()

  for (const [binding, owners] of tracked) {
    dependencies.set(binding, new Set())
    for (const owner of owners) {
      ownerBindings.set(owner, binding)
      if (isInsideExport(owner)) {
        live.add(binding)
      }
    }
  }

  for (const target of tracked.keys()) {
    const references = target.violations.concat(
      target.references.filter((reference: any) => !isTypeOnly(reference, tree)),
    )
    for (const reference of references) {
      let node = reference
      let deferred = false
      while (node && !ownerBindings.has(node)) {
        if (isFunctionLike(node)) {
          deferred = true
        }
        node = parents.get(node)
      }
      const ownName =
        node && (reference === node || reference === node.id || reference === node.left)
      if (node && (deferred || ownName || isFunctionLike(node))) {
        dependencies.get(ownerBindings.get(node))?.add(target)
      } else {
        live.add(target)
      }
    }
  }

  const pending = [...live]
  while (pending.length) {
    for (const dependency of dependencies.get(pending.pop()) ?? []) {
      if (live.has(dependency)) {
        continue
      }
      live.add(dependency)
      pending.push(dependency)
    }
  }

  const dead = new Set([...candidateOwners.keys()].filter((binding) => !live.has(binding)))
  if (!dead.size) {
    return
  }

  function removeDeadDeclarators(node: any): void {
    if (removed.has(node)) {
      return
    }
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') {
      const binding = bindingOf(node.id)
      if (binding && dead.has(binding)) {
        removeDeclarator(node, tree)
      }
    }
    forEachChild(node, removeDeadDeclarators)
  }
  removeDeadDeclarators(program)

  for (const binding of dead) {
    for (const owner of candidateOwners.get(binding) ?? []) {
      if (owner.type !== 'VariableDeclarator' && !removed.has(owner)) {
        removeStatement(owner, tree)
      }
    }
  }
}

function sweepObjectPattern(declarator: any, isDead: (id: any) => boolean, tree: any): boolean {
  const { removed } = tree
  const { properties } = declarator.id
  const rest = properties.at(-1)
  let changed = false
  for (const [slot, local] of patternLocals(declarator.id)) {
    if (removed.has(slot) || !isDead(local)) {
      continue
    }
    if (rest?.type === 'RestElement' && rest !== slot && !removed.has(rest)) {
      continue
    }
    removed.add(slot)
    changed = true
  }
  if (changed && properties.every((property: any) => removed.has(property))) {
    removeDeclarator(declarator, tree)
  }
  return changed
}

function sweepArrayPattern(declarator: any, isDead: (id: any) => boolean, tree: any): boolean {
  const { removed } = tree
  let changed = false
  for (const [slot, local] of patternLocals(declarator.id)) {
    if (!removed.has(slot) && isDead(local)) {
      removed.add(slot)
      changed = true
    }
  }
  if (changed && declarator.id.elements.every((e: any) => e && removed.has(e))) {
    removeDeclarator(declarator, tree)
  }
  return changed
}

function nextToken(code: string, position: number): number {
  for (;;) {
    while (/\s/.test(code[position] ?? '')) {
      position++
    }
    if (code.startsWith('//', position)) {
      const end = code.indexOf('\n', position)
      position = end < 0 ? code.length : end
    } else if (code.startsWith('/*', position)) {
      position = code.indexOf('*/', position) + 2
    } else {
      return position
    }
  }
}

function removeFromList(output: MagicString, items: any[], removed: Set<any>): void {
  let previousKept: any
  let runStart: any
  for (const item of items) {
    if (removed.has(item)) {
      runStart ??= item
      continue
    }
    if (runStart) {
      output.remove(runStart.start, item.start)
    }
    runStart = undefined
    previousKept = item
  }
  if (runStart && previousKept) {
    output.remove(previousKept.end, items.at(-1).end)
  }
}

function renderImport(node: any, code: string, output: MagicString, removed: Set<any>): void {
  const [first, ...rest] = node.specifiers
  if (first?.type !== 'ImportDefaultSpecifier' || !rest.length) {
    removeFromList(output, node.specifiers, removed)
    return
  }
  if (removed.has(first)) {
    output.remove(first.start, nextToken(code, nextToken(code, first.end) + 1))
    removeFromList(output, rest, removed)
  } else if (rest.every((specifier: any) => removed.has(specifier))) {
    let end = rest.at(-1).end
    if (rest[0].type === 'ImportSpecifier') {
      end = nextToken(code, end)
      if (code[end] === ',') {
        end = nextToken(code, end + 1)
      }
      end++
    }
    output.remove(first.end, end)
  } else {
    removeFromList(output, rest, removed)
  }
}

function renderSplitExport(node: any, output: MagicString, tree: any): void {
  const { removed, localDeclarators } = tree
  const declaration = node.declaration
  function prefix(declarator: any): string {
    return `${localDeclarators.has(declarator) ? '' : 'export '}${declaration.declare ? 'declare ' : ''}${declaration.kind} `
  }
  const kept = declaration.declarations.filter((d: any) => !removed.has(d))
  output.overwrite(node.start, kept[0].start, prefix(kept[0]))
  kept.slice(1).forEach((declarator: any, index: number) => {
    output.overwrite(kept[index].end, declarator.start, `;\n${prefix(declarator)}`)
  })
  const lastKept = kept.at(-1)
  const last = declaration.declarations.at(-1)
  if (lastKept !== last) {
    output.remove(lastKept.end, last.end)
  }
}

function statementStart(node: any): number {
  const decorator = (node.declaration ?? node).decorators?.[0]
  return decorator ? Math.min(node.start, decorator.start) : node.start
}

function renderRemovedStatement(
  node: any,
  parent: any,
  code: string,
  output: MagicString,
  removed: Set<any>,
): void {
  const siblings = Array.isArray(parent.body)
    ? parent.body
    : parent.type === 'SwitchCase'
      ? parent.consequent
      : undefined
  if (!siblings) {
    if (parent.type === 'ForStatement' && parent.init === node) {
      output.remove(node.start, node.end)
    } else {
      output.overwrite(statementStart(node), node.end, '{}')
    }
    return
  }
  const next = siblings
    .slice(siblings.indexOf(node) + 1)
    .find((sibling: any) => !removed.has(sibling))
  let end = node.end
  while (code[end] === ' ' || code[end] === '\t') {
    end++
  }
  if (code[end] === '\r') {
    end++
  }
  end = code[end] === '\n' ? end + 1 : node.end
  if (next && /[([`+\-/*<]/.test(code[next.start])) {
    output.overwrite(statementStart(node), end, ';')
  } else {
    output.remove(statementStart(node), end)
  }
}

function render(node: any, code: string, output: MagicString, tree: any): void {
  const { removed, unexported, localDeclarators } = tree
  let ownsRemovedChildren = false
  switch (node.type) {
    case 'ImportDeclaration':
      if (node.specifiers.some((specifier: any) => removed.has(specifier))) {
        renderImport(node, code, output, removed)
      }
      return
    case 'ExportNamedDeclaration':
      ownsRemovedChildren = true
      removeFromList(output, node.specifiers, removed)
      if (unexported.has(node)) {
        output.remove(node.start, node.declaration.start)
      } else if (node.declaration?.declarations?.some((d: any) => localDeclarators.has(d))) {
        renderSplitExport(node, output, tree)
        for (const declarator of node.declaration.declarations) {
          if (!removed.has(declarator)) {
            render(declarator, code, output, tree)
          }
        }
        return
      }
      break
    case 'ExportDefaultDeclaration':
      if (unexported.has(node)) {
        output.remove(node.start, node.declaration.start)
      }
      break
    case 'VariableDeclaration':
      ownsRemovedChildren = true
      removeFromList(output, node.declarations, removed)
      break
    case 'ObjectPattern':
      ownsRemovedChildren = true
      removeFromList(output, node.properties, removed)
      break
    case 'ArrayPattern':
      ownsRemovedChildren = true
      for (const element of node.elements) {
        if (element && removed.has(element)) {
          output.remove(element.start, element.end)
        }
      }
      break
  }
  forEachChild(node, (child) => {
    if (!removed.has(child)) {
      render(child, code, output, tree)
    } else if (!ownsRemovedChildren) {
      renderRemovedStatement(child, node, code, output, removed)
    }
  })
}

/**
 * Eliminates unpicked exports and their dead dependencies from a module's source.
 */
export function pickExports(code: string, id: string, pick: string[]): { code: string; map: any } {
  const { program, errors } = parseSync(id, code, {
    lang: extname(id.split('?')[0]!) === '.ts' ? 'ts' : 'tsx',
    astType: 'ts',
    sourceType: 'module',
  })
  const error = errors[0]
  if (error) {
    throw new SyntaxError(`Failed to parse ${id}:\n${error.message || String(error)}`)
  }

  const parents = new Map<any, any>()
  function link(node: any): void {
    unwrapParentheses(node)
    forEachChild(node, (child) => {
      parents.set(child, node)
      link(child)
    })
  }
  link(program)

  const tree = {
    parents,
    removed: new Set<any>(),
    unexported: new Set<any>(),
    localDeclarators: new Set<any>(),
  }
  const { removed, unexported, localDeclarators } = tree
  const before = crawl(program, tree)
  const candidates = new Set<any>()
  const cssLocals = new Set<any>()

  for (const node of program.body) {
    switch (node.type) {
      case 'ImportDeclaration':
        if (node.source.value.endsWith('.css') && !pick.includes('$css')) {
          if (node.specifiers.length) {
            for (const s of node.specifiers) {
              cssLocals.add(s.local)
            }
          } else {
            removed.add(node)
          }
        }
        break
      case 'ExportAllDeclaration':
        if (node.exported && !pick.includes(exportedName(node))) {
          removed.add(node)
        }
        break
      case 'ExportDefaultDeclaration': {
        if (pick.includes('default')) {
          break
        }
        const declaration: any = node.declaration
        if (isNamedDeclaration(declaration) && declaration.id) {
          unexported.add(node)
          candidates.add(declaration.id)
        } else {
          removed.add(node)
        }
        break
      }
      case 'ExportNamedDeclaration': {
        if (node.specifiers.length) {
          for (const specifier of node.specifiers) {
            if (!pick.includes(exportedName(specifier))) {
              removed.add(specifier)
            }
          }
          if (node.specifiers.every((specifier: any) => removed.has(specifier))) {
            removed.add(node)
          }
          break
        }
        const declaration: any = node.declaration
        if (declaration && isNamedDeclaration(declaration)) {
          if (declaration.id && !pick.includes(declaration.id.name)) {
            unexported.add(node)
            candidates.add(declaration.id)
          }
        } else if (declaration?.type === 'VariableDeclaration') {
          for (const declarator of declaration.declarations) {
            if (declarator.id.type === 'Identifier' && !pick.includes(declarator.id.name)) {
              localDeclarators.add(declarator)
              candidates.add(declarator.id)
            }
          }
        }
        break
      }
    }
  }

  const sweepable = new Set([...candidates, ...cssLocals])
  function markIfReferenced(identifier: any): void {
    if (isBindingReferenced(before.bindingOf(identifier), tree, true)) {
      sweepable.add(identifier)
    }
  }
  function collect(node: any): void {
    if (removed.has(node)) {
      return
    }
    if (node.type === 'VariableDeclarator') {
      if (node.id.type === 'Identifier') {
        markIfReferenced(node.id)
      } else if (node.id.type === 'ObjectPattern' || node.id.type === 'ArrayPattern') {
        for (const [, local] of patternLocals(node.id)) {
          markIfReferenced(local)
        }
      }
    } else if (isFunctionLike(node) || isClassLike(node)) {
      const identifier = boundIdentifier(node, parents)
      if (identifier) {
        markIfReferenced(identifier)
      }
    } else if (node.type.startsWith('Import') && node.local) {
      markIfReferenced(node.local)
    }
    forEachChild(node, collect)
  }
  collect(program)
  removeUnreachable(program, tree, sweepable, candidates)

  let changed: boolean
  do {
    changed = false
    const { bindingOf } = crawl(program, tree)
    const isDead = (identifier: any): boolean =>
      sweepable.has(identifier) && !isBindingReferenced(bindingOf(identifier), tree, false)
    const sweep = (node: any): void => {
      if (removed.has(node)) {
        return
      }
      if (node.type === 'VariableDeclarator') {
        if (node.id.type === 'Identifier') {
          if (isDead(node.id) && removeDeclarator(node, tree)) {
            changed = true
          }
        } else if (node.id.type === 'ObjectPattern') {
          changed = sweepObjectPattern(node, isDead, tree) || changed
        } else if (node.id.type === 'ArrayPattern') {
          changed = sweepArrayPattern(node, isDead, tree) || changed
        }
      } else if (isFunctionLike(node) || isClassLike(node)) {
        const identifier = boundIdentifier(node, parents)
        if (identifier && !isOwnExpressionName(identifier, parents) && isDead(identifier)) {
          const parent = parents.get(node)
          if (parent.type === 'VariableDeclarator') {
            changed = removeDeclarator(parent, tree) || changed
          } else if (parent.type === 'AssignmentExpression') {
            const statement = parents.get(parent)
            if (statement.type === 'ExpressionStatement') {
              removeStatement(statement, tree)
              changed = true
            }
          } else {
            removeStatement(node, tree)
            changed = true
          }
        }
      } else if (node.type === 'ImportDeclaration') {
        for (const specifier of node.specifiers) {
          if (!removed.has(specifier) && isDead(specifier.local)) {
            removed.add(specifier)
            changed = true
          }
        }
        if (node.specifiers.length && node.specifiers.every((s: any) => removed.has(s))) {
          removed.add(node)
        }
        return
      }
      if (!removed.has(node)) {
        forEachChild(node, sweep)
      }
    }
    sweep(program)
  } while (changed)

  const output = new MagicString(code)
  render(program, code, output, tree)
  return {
    code: output.toString(),
    map: output.generateMap({ source: id, includeContent: true, hires: 'boundary' }),
  }
}

/**
 * Builds the module id used to import a subset of a route file's exports.
 * Appends `?pick=...&lang.<ext>` query so other plugins matching extensions still trigger.
 */
export function toPickId(src: string, pick: string[]): string {
  const query = pick.map((p) => `pick=${p}`).join('&')
  const ext = extname(src).slice(1)
  return PICKABLE_EXTENSIONS.has(ext) ? `${src}?${query}&lang.${ext}` : `${src}?${query}`
}

const PICK_CHUNK_NAME_RE = /\.[cm]?[jt]sx?\?pick=[^?]*&lang$/
// eslint-disable-next-line no-control-regex
const INVALID_CHAR_RE = /[\u0000-\u001F"#$&*+,:;<=>?[\]^`{|}\u007F]/g
const DRIVE_LETTER_RE = /^[a-z]:/i

/** Drops `?pick=...&lang` so route chunks keep stable and clean filenames. */
export function sanitizeChunkFileName(name: string): string {
  const stripped = name.replace(PICK_CHUNK_NAME_RE, '')
  const driveLetter = DRIVE_LETTER_RE.exec(stripped)?.[0] ?? ''
  return driveLetter + stripped.slice(driveLetter.length).replace(INVALID_CHAR_RE, '_')
}

export function treeShake(): Plugin {
  return {
    name: 'solid-file-router:tree-shake',
    enforce: 'pre',
    transform(code, id) {
      const [path, queryString] = id.split('?')
      if (!path) {
        return
      }
      const query = new URLSearchParams(queryString)
      if (query.has('pick') && PICKABLE_EXTENSIONS.has(extname(path).slice(1))) {
        return pickExports(code, id, query.getAll('pick'))
      }
    },
  }
}
