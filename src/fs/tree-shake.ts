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

interface AstNode {
  type: string
  start: number
  end: number
  name?: string
  value?: unknown
  id?: AstNode | null
  key?: AstNode | null
  init?: AstNode | null
  body?: AstNode | Array<AstNode> | null
  expression?: AstNode | null
  declaration?: AstNode | null
  declarations?: Array<AstNode>
  specifiers?: Array<AstNode>
  local?: AstNode
  imported?: AstNode
  exported?: AstNode
  argument?: AstNode | null
  left?: AstNode | null
  right?: AstNode | null
  object?: AstNode | null
  property?: AstNode | null
  computed?: boolean
  params?: Array<AstNode>
  properties?: Array<AstNode>
  elements?: Array<AstNode | null>
  source?: AstNode | null
  kind?: string
  declare?: boolean
  exportKind?: string
  superClass?: AstNode | null
  parameter?: AstNode | null
  moduleReference?: AstNode | null
  param?: AstNode | null
  discriminant?: AstNode | null
  cases?: Array<AstNode>
  consequent?: Array<AstNode>
  operator?: string
  decorators?: Array<AstNode>
}

interface Binding {
  kind: string
  declaration: AstNode
  references: Array<AstNode>
  violations: Array<AstNode>
}

interface Scope {
  parent?: Scope
  bindings: Map<string, Binding>
  hoists?: boolean
  ownsArguments?: boolean
  isParams?: boolean
}

interface TreeState {
  parents: Map<AstNode, AstNode>
  removed: Set<AstNode>
  unexported: Set<AstNode>
  localDeclarators: Set<AstNode>
}

function isAstNode(value: unknown): value is AstNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  )
}

function forEachChild(node: AstNode, visit: (child: AstNode) => void): void {
  for (const [, value] of Object.entries(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isAstNode(item)) {
          visit(item)
        }
      }
    } else if (isAstNode(value)) {
      visit(value)
    }
  }
}

function unwrapParentheses(node: AstNode): void {
  const record = node as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries(record)) {
    if (Array.isArray(value)) {
      value.forEach((item: unknown, index) => {
        let current = item
        while (isAstNode(current) && current.type === 'ParenthesizedExpression') {
          current = current.expression
          value[index] = current
        }
      })
    } else {
      let inner = value
      while (isAstNode(inner) && inner.type === 'ParenthesizedExpression') {
        inner = inner.expression
        record[key] = inner
      }
    }
  }
}

function isFunctionLike(node: AstNode): boolean {
  return (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression'
  )
}

function isClassLike(node: AstNode): boolean {
  return node.type === 'ClassDeclaration' || node.type === 'ClassExpression'
}

function isNamedDeclaration(node: AstNode | null | undefined): boolean {
  return node?.type === 'FunctionDeclaration' || node?.type === 'ClassDeclaration'
}

function isExportWrapper(node: AstNode | undefined): boolean {
  return node?.type === 'ExportNamedDeclaration' || node?.type === 'ExportDefaultDeclaration'
}

function isReference(
  node: AstNode,
  parent: AstNode | undefined,
  grandparent: AstNode | undefined,
): boolean {
  if (!parent) {
    return true
  }
  if (
    node.type === 'JSXIdentifier' &&
    parent.type !== 'JSXMemberExpression' &&
    /^[a-z]/.test(node.name ?? '')
  ) {
    return false
  }
  switch (parent.type) {
    case 'MemberExpression':
      return parent.property === node ? Boolean(parent.computed) : true
    case 'JSXMemberExpression':
      return parent.object === node
    case 'VariableDeclarator':
      return parent.init === node
    case 'ArrowFunctionExpression':
      return parent.body === node
    case 'Property':
      if (parent.key === node) {
        return Boolean(parent.computed)
      }
      return grandparent?.type !== 'ObjectPattern'
    case 'MethodDefinition':
    case 'TSAbstractMethodDefinition':
      return parent.key === node ? Boolean(parent.computed) : false
    case 'PropertyDefinition':
    case 'AccessorProperty':
    case 'TSAbstractPropertyDefinition':
    case 'TSAbstractAccessorProperty':
    case 'TSPropertySignature':
      return parent.key === node ? Boolean(parent.computed) : true
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
      return (parent.name as unknown) !== node
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

function patternIdentifiers(
  pattern: AstNode | null | undefined,
  out: Array<AstNode> = [],
): Array<AstNode> {
  switch (pattern?.type) {
    case 'Identifier':
      out.push(pattern)
      break
    case 'ObjectPattern':
      for (const property of pattern.properties ?? []) {
        const target =
          property.type === 'Property'
            ? isAstNode(property.value)
              ? property.value
              : undefined
            : property
        patternIdentifiers(target, out)
      }
      break
    case 'ArrayPattern':
      for (const element of pattern.elements ?? []) {
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

function lookup(start: Scope | undefined, name: string): Binding | undefined {
  let previous: Scope | undefined
  for (let scope = start; scope; previous = scope, scope = scope.parent) {
    const binding = scope.bindings.get(name)
    if (binding) {
      if (!previous?.isParams || binding.kind !== 'declared') {
        return binding
      }
    } else if (name === 'arguments' && scope.ownsArguments) {
      return undefined
    }
  }
  return undefined
}

function childScope(parent: Scope, options: Omit<Scope, 'parent' | 'bindings'> = {}): Scope {
  return {
    parent,
    bindings: new Map<string, Binding>(),
    ...options,
  }
}

function declareBinding(scope: Scope, name: string, declaration: AstNode, kind: string): void {
  const existing = scope.bindings.get(name)
  if (existing) {
    existing.violations.push(declaration)
  } else {
    scope.bindings.set(name, { kind, declaration, references: [], violations: [] })
  }
}

function crawl(
  program: AstNode,
  tree: TreeState,
): { bindingOf: (identifier: AstNode) => Binding | undefined } {
  const { parents, removed, unexported, localDeclarators } = tree
  const scopes = new Map<AstNode, Scope>()
  const references: Array<[string, Scope, AstNode]> = []
  const violations: Array<[string, Scope, AstNode]> = []

  function declareExportReferences(node: AstNode, scope: Scope): void {
    const declaration = node.declaration
    if (!declaration || unexported.has(node)) {
      return
    }
    if (isNamedDeclaration(declaration)) {
      if (declaration.id?.name) {
        references.push([declaration.id.name, scope, node])
      }
    } else if (declaration.type === 'VariableDeclaration') {
      for (const declarator of declaration.declarations ?? []) {
        if (removed.has(declarator) || localDeclarators.has(declarator)) {
          continue
        }
        for (const id of patternIdentifiers(declarator.id)) {
          if (id.name) {
            references.push([id.name, scope, node])
          }
        }
      }
    }
  }

  function visitChildren(node: AstNode, scope: Scope): void {
    forEachChild(node, (child) => visit(child, scope))
  }

  function visit(node: AstNode, scope: Scope): void {
    if (removed.has(node)) {
      return
    }
    switch (node.type) {
      case 'TSTypeAnnotation':
        return
      case 'TSImportEqualsDeclaration':
        if (node.id?.name) {
          declareBinding(scope, node.id.name, node, 'declared')
        }
        if (node.moduleReference) {
          visit(node.moduleReference, scope)
        }
        return
      case 'Identifier':
      case 'JSXIdentifier': {
        const parent = parents.get(node)
        if (node.name && isReference(node, parent, parent ? parents.get(parent) : undefined)) {
          references.push([node.name, scope, node])
        }
        break
      }
      case 'ImportDeclaration':
        for (const specifier of node.specifiers ?? []) {
          if (!removed.has(specifier) && specifier.local?.name) {
            declareBinding(scope, specifier.local.name, specifier, 'declared')
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
        for (const declarator of node.declarations ?? []) {
          if (removed.has(declarator)) {
            continue
          }
          for (const id of patternIdentifiers(declarator.id)) {
            if (id.name) {
              declareBinding(target, id.name, declarator, 'declared')
            }
          }
        }
        break
      }
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        if (node.type === 'FunctionDeclaration' && node.id?.name) {
          declareBinding(scope, node.id.name, node, 'declared')
        }
        const inner = childScope(scope, {
          hoists: true,
          ownsArguments: node.type !== 'ArrowFunctionExpression',
        })
        scopes.set(node, inner)
        if (node.type === 'FunctionExpression' && node.id?.name) {
          declareBinding(inner, node.id.name, node, 'local')
        }
        const paramsScope = childScope(inner, { isParams: true })
        const nodeParams = node.params ?? []
        for (const param of nodeParams) {
          for (const id of patternIdentifiers(param)) {
            if (id.name) {
              declareBinding(inner, id.name, param, 'param')
            }
          }
          visit(param, paramsScope)
        }
        forEachChild(node, (child) => {
          if (nodeParams.includes(child)) {
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
        if (node.type === 'ClassDeclaration' && node.id?.name && !node.declare) {
          declareBinding(scope, node.id.name, node, 'declared')
        }
        const inner = childScope(scope)
        scopes.set(node, inner)
        if (node.type === 'ClassExpression' && node.id?.name) {
          declareBinding(inner, node.id.name, node, 'local')
        }
        visitChildren(node, inner)
        return
      }
      case 'CatchClause': {
        const inner = childScope(scope)
        scopes.set(node, inner)
        for (const id of patternIdentifiers(node.param)) {
          if (id.name) {
            declareBinding(inner, id.name, node, 'declared')
          }
        }
        if (node.param) {
          visit(node.param, inner)
        }
        if (isAstNode(node.body)) {
          scopes.set(node.body, inner)
          visitChildren(node.body, inner)
        }
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
        if (node.discriminant) {
          visit(node.discriminant, scope)
        }
        const inner = childScope(scope)
        scopes.set(node, inner)
        for (const switchCase of node.cases ?? []) {
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
            if (id.name) {
              violations.push([id.name, inner, node])
            }
          }
        }
        visitChildren(node, inner)
        return
      }
      case 'AssignmentExpression':
        for (const id of patternIdentifiers(node.left)) {
          if (id.name) {
            violations.push([id.name, scope, node])
          }
        }
        break
      case 'UpdateExpression':
        if (node.argument?.type === 'Identifier' && node.argument.name) {
          violations.push([node.argument.name, scope, node])
        }
        break
      case 'UnaryExpression':
        if (
          node.operator === 'delete' &&
          node.argument?.type === 'Identifier' &&
          node.argument.name
        ) {
          violations.push([node.argument.name, scope, node])
        }
        break
    }
    visitChildren(node, scope)
  }

  const root: Scope = { bindings: new Map<string, Binding>(), hoists: true }
  scopes.set(program, root)
  visitChildren(program, root)

  for (const [name, scope, node] of references) {
    lookup(scope, name)?.references.push(node)
  }
  for (const [name, scope, node] of violations) {
    lookup(scope, name)?.violations.push(node)
  }

  function bindingOf(identifier: AstNode): Binding | undefined {
    let node = parents.get(identifier)
    if (node && isNamedDeclaration(node)) {
      node = parents.get(node)
    }
    while (node && !scopes.has(node)) {
      node = parents.get(node)
    }
    if (!node || !identifier.name) {
      return undefined
    }
    return lookup(scopes.get(node), identifier.name)
  }

  return { bindingOf }
}

function isTypeOnly(reference: AstNode, tree: TreeState): boolean {
  const { parents, localDeclarators } = tree
  for (let node: AstNode | undefined = reference; node; node = parents.get(node)) {
    if (TYPE_ONLY_ANCESTORS.has(node.type)) {
      return true
    }
    if (node.type === 'ExportSpecifier' && node.exportKind === 'type') {
      return true
    }
    if (node.type === 'ExportNamedDeclaration' && node.exportKind === 'type') {
      if (!node.declaration?.declarations?.some((d) => localDeclarators.has(d))) {
        return true
      }
    }
  }
  return false
}

function isInside(node: AstNode, ancestor: AstNode, parents: Map<AstNode, AstNode>): boolean {
  for (let parent = parents.get(node); parent; parent = parents.get(parent)) {
    if (parent === ancestor) {
      return true
    }
  }
  return false
}

function isBindingReferenced(
  binding: Binding | undefined,
  tree: TreeState,
  includeTypes: boolean,
): boolean {
  if (!binding) {
    return false
  }
  const references = binding.violations.concat(
    includeTypes
      ? binding.references
      : binding.references.filter((reference) => !isTypeOnly(reference, tree)),
  )
  if (!references.length) {
    return false
  }
  if (binding.declaration.type === 'FunctionDeclaration') {
    return !references.every((ref) => isInside(ref, binding.declaration, tree.parents))
  }
  return true
}

function boundIdentifier(node: AstNode, parents: Map<AstNode, AstNode>): AstNode | null {
  const parent = parents.get(node)
  if (parent?.type === 'VariableDeclarator') {
    return parent.id?.type === 'Identifier' ? parent.id : null
  }
  if (parent?.type === 'AssignmentExpression') {
    return parent.left?.type === 'Identifier' ? parent.left : null
  }
  if (node.type === 'ArrowFunctionExpression') {
    return null
  }
  return node.id?.type === 'Identifier' ? node.id : null
}

function isOwnExpressionName(identifier: AstNode, parents: Map<AstNode, AstNode>): boolean {
  const parent = parents.get(identifier)
  return (
    (parent?.type === 'FunctionExpression' || parent?.type === 'ClassExpression') &&
    parent.id === identifier
  )
}

function isKeptWithDeadBinding(identifier: AstNode, parents: Map<AstNode, AstNode>): boolean {
  const parent = parents.get(identifier)
  if (!parent) {
    return false
  }
  if (parent.type === 'AssignmentExpression') {
    return parents.get(parent)?.type !== 'ExpressionStatement'
  }
  return (
    parent.type === 'Property' && parents.get(parent)?.properties?.at(-1)?.type === 'RestElement'
  )
}

function patternLocals(pattern: AstNode): Array<[AstNode, AstNode]> {
  if (pattern.type === 'ObjectPattern') {
    return (pattern.properties ?? []).flatMap((property): Array<[AstNode, AstNode]> => {
      const local = property.type === 'Property' ? property.value : property.argument
      return isAstNode(local) && local.type === 'Identifier' ? [[property, local]] : []
    })
  }
  return (pattern.elements ?? []).flatMap((element): Array<[AstNode, AstNode]> => {
    if (element?.type === 'Identifier') {
      return [[element, element]]
    }
    if (element?.type === 'RestElement' && element.argument?.type === 'Identifier') {
      return [[element, element.argument]]
    }
    return []
  })
}

function exportedName(specifier: AstNode): string {
  const exported = specifier.exported
  if (!exported) {
    return ''
  }
  return exported.name ?? (typeof exported.value === 'string' ? exported.value : '')
}

function removeStatement(node: AstNode, tree: TreeState): void {
  tree.removed.add(node)
  const parent = tree.parents.get(node)
  if (parent && isExportWrapper(parent)) {
    tree.removed.add(parent)
  }
}

function removeDeclarator(declarator: AstNode, tree: TreeState): boolean {
  const { parents, removed } = tree
  const declaration = parents.get(declarator)
  if (!declaration) {
    return false
  }
  const owner = parents.get(declaration)
  if (
    owner &&
    (owner.type === 'ForInStatement' || owner.type === 'ForOfStatement') &&
    owner.left === declaration
  ) {
    return false
  }
  removed.add(declarator)
  if ((declaration.declarations ?? []).every((d) => removed.has(d))) {
    removeStatement(declaration, tree)
  }
  return true
}

function addOwner(owners: Map<Binding, Set<AstNode>>, binding: Binding, owner: AstNode): void {
  const nodes = owners.get(binding) ?? new Set<AstNode>()
  nodes.add(owner)
  owners.set(binding, nodes)
}

function removeUnreachable(
  program: AstNode,
  tree: TreeState,
  sweepable: Set<AstNode>,
  candidates: Set<AstNode>,
): void {
  const { parents, removed, unexported, localDeclarators } = tree
  const { bindingOf } = crawl(program, tree)
  const tracked = new Map<Binding, Set<AstNode>>()
  const candidateOwners = new Map<Binding, Set<AstNode>>()

  for (const identifier of sweepable) {
    if (isOwnExpressionName(identifier, parents) || isKeptWithDeadBinding(identifier, parents)) {
      continue
    }
    const binding = bindingOf(identifier)
    const owner = parents.get(identifier)
    if (!binding || !owner) {
      continue
    }
    addOwner(tracked, binding, owner)
    const isRemovableHelper =
      isNamedDeclaration(owner) ||
      (owner.type === 'VariableDeclarator' &&
        Boolean(owner.init) &&
        (isFunctionLike(owner.init as AstNode) || isClassLike(owner.init as AstNode)))
    if (candidates.has(identifier) || isRemovableHelper) {
      addOwner(candidateOwners, binding, owner)
    }
  }

  const isInsideExport = (owner: AstNode): boolean => {
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

  const ownerBindings = new Map<AstNode, Binding>()
  const dependencies = new Map<Binding, Set<Binding>>()
  const live = new Set<Binding>()

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
      target.references.filter((reference) => !isTypeOnly(reference, tree)),
    )
    for (const reference of references) {
      let node: AstNode | undefined = reference
      let deferred = false
      while (node && !ownerBindings.has(node)) {
        if (isFunctionLike(node)) {
          deferred = true
        }
        node = parents.get(node)
      }
      const ownName =
        node !== undefined &&
        (reference === node || reference === node.id || reference === node.left)
      const ownerBinding = node ? ownerBindings.get(node) : undefined
      if (node && ownerBinding && (deferred || ownName || isFunctionLike(node))) {
        dependencies.get(ownerBinding)?.add(target)
      } else {
        live.add(target)
      }
    }
  }

  const pending = [...live]
  while (pending.length) {
    const current = pending.pop()
    if (!current) {
      continue
    }
    for (const dependency of dependencies.get(current) ?? []) {
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

  function removeDeadDeclarators(node: AstNode): void {
    if (removed.has(node)) {
      return
    }
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') {
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

function sweepObjectPattern(
  declarator: AstNode,
  isDead: (id: AstNode) => boolean,
  tree: TreeState,
): boolean {
  const { removed } = tree
  const pattern = declarator.id
  if (!pattern) {
    return false
  }
  const properties = pattern.properties ?? []
  const rest = properties.at(-1)
  let changed = false
  for (const [slot, local] of patternLocals(pattern)) {
    if (removed.has(slot) || !isDead(local)) {
      continue
    }
    if (rest?.type === 'RestElement' && rest !== slot && !removed.has(rest)) {
      continue
    }
    removed.add(slot)
    changed = true
  }
  if (changed && properties.every((property) => removed.has(property))) {
    removeDeclarator(declarator, tree)
  }
  return changed
}

function sweepArrayPattern(
  declarator: AstNode,
  isDead: (id: AstNode) => boolean,
  tree: TreeState,
): boolean {
  const { removed } = tree
  const pattern = declarator.id
  if (!pattern) {
    return false
  }
  let changed = false
  for (const [slot, local] of patternLocals(pattern)) {
    if (!removed.has(slot) && isDead(local)) {
      removed.add(slot)
      changed = true
    }
  }
  if (changed && (pattern.elements ?? []).every((e) => e && removed.has(e))) {
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

function removeFromList(
  output: MagicString,
  items: ReadonlyArray<AstNode>,
  removed: Set<AstNode>,
): void {
  let previousKept: AstNode | undefined
  let runStart: AstNode | undefined
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
  const last = items.at(-1)
  if (runStart && previousKept && last) {
    output.remove(previousKept.end, last.end)
  }
}

function renderImport(
  node: AstNode,
  code: string,
  output: MagicString,
  removed: Set<AstNode>,
): void {
  const specifiers = node.specifiers ?? []
  const [first, ...rest] = specifiers
  if (first?.type !== 'ImportDefaultSpecifier' || !rest.length) {
    removeFromList(output, specifiers, removed)
    return
  }
  const lastRest = rest.at(-1)
  const firstRest = rest[0]
  if (removed.has(first)) {
    output.remove(first.start, nextToken(code, nextToken(code, first.end) + 1))
    removeFromList(output, rest, removed)
  } else if (lastRest && firstRest && rest.every((specifier) => removed.has(specifier))) {
    let end = lastRest.end
    if (firstRest.type === 'ImportSpecifier') {
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

function renderSplitExport(node: AstNode, output: MagicString, tree: TreeState): void {
  const { removed, localDeclarators } = tree
  const declaration = node.declaration
  if (!declaration) {
    return
  }
  const declarations = declaration.declarations ?? []
  function prefix(declarator: AstNode): string {
    return `${localDeclarators.has(declarator) ? '' : 'export '}${declaration?.declare ? 'declare ' : ''}${declaration?.kind ?? ''} `
  }
  const kept = declarations.filter((d) => !removed.has(d))
  const firstKept = kept[0]
  const lastKept = kept.at(-1)
  const last = declarations.at(-1)
  if (!firstKept || !lastKept || !last) {
    return
  }
  output.overwrite(node.start, firstKept.start, prefix(firstKept))
  kept.slice(1).forEach((declarator, index) => {
    const prev = kept[index]
    if (prev) {
      output.overwrite(prev.end, declarator.start, `;\n${prefix(declarator)}`)
    }
  })
  if (lastKept !== last) {
    output.remove(lastKept.end, last.end)
  }
}

function statementStart(node: AstNode): number {
  const decorator = (node.declaration ?? node).decorators?.[0]
  return decorator ? Math.min(node.start, decorator.start) : node.start
}

function renderRemovedStatement(
  node: AstNode,
  parent: AstNode,
  code: string,
  output: MagicString,
  removed: Set<AstNode>,
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
  const next = siblings.slice(siblings.indexOf(node) + 1).find((sibling) => !removed.has(sibling))
  let end = node.end
  while (code[end] === ' ' || code[end] === '\t') {
    end++
  }
  if (code[end] === '\r') {
    end++
  }
  end = code[end] === '\n' ? end + 1 : node.end
  const nextChar = next ? (code[next.start] ?? '') : ''
  if (next && /[([`+\-/*<]/.test(nextChar)) {
    output.overwrite(statementStart(node), end, ';')
  } else {
    output.remove(statementStart(node), end)
  }
}

function render(node: AstNode, code: string, output: MagicString, tree: TreeState): void {
  const { removed, unexported, localDeclarators } = tree
  let ownsRemovedChildren = false
  switch (node.type) {
    case 'ImportDeclaration':
      if ((node.specifiers ?? []).some((specifier) => removed.has(specifier))) {
        renderImport(node, code, output, removed)
      }
      return
    case 'ExportNamedDeclaration':
      ownsRemovedChildren = true
      removeFromList(output, node.specifiers ?? [], removed)
      if (unexported.has(node) && node.declaration) {
        output.remove(node.start, node.declaration.start)
      } else if (node.declaration?.declarations?.some((d) => localDeclarators.has(d))) {
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
      if (unexported.has(node) && node.declaration) {
        output.remove(node.start, node.declaration.start)
      }
      break
    case 'VariableDeclaration':
      ownsRemovedChildren = true
      removeFromList(output, node.declarations ?? [], removed)
      break
    case 'ObjectPattern':
      ownsRemovedChildren = true
      removeFromList(output, node.properties ?? [], removed)
      break
    case 'ArrayPattern':
      ownsRemovedChildren = true
      for (const element of node.elements ?? []) {
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
export function pickExports(
  code: string,
  id: string,
  pick: Array<string>,
): { code: string; map: ReturnType<MagicString['generateMap']> } {
  const parsed = parseSync(id, code, {
    lang: extname(id.split('?')[0] ?? id) === '.ts' ? 'ts' : 'tsx',
    astType: 'ts',
    sourceType: 'module',
  })
  const error = parsed.errors[0]
  if (error) {
    throw new SyntaxError(`Failed to parse ${id}:\n${error.message || String(error)}`)
  }
  const program = parsed.program as unknown as AstNode

  const parents = new Map<AstNode, AstNode>()
  function link(node: AstNode): void {
    unwrapParentheses(node)
    forEachChild(node, (child) => {
      parents.set(child, node)
      link(child)
    })
  }
  link(program)

  const tree: TreeState = {
    parents,
    removed: new Set<AstNode>(),
    unexported: new Set<AstNode>(),
    localDeclarators: new Set<AstNode>(),
  }
  const { removed, unexported, localDeclarators } = tree
  const before = crawl(program, tree)
  const candidates = new Set<AstNode>()
  const cssLocals = new Set<AstNode>()

  for (const node of (program.body as Array<AstNode> | null | undefined) ?? []) {
    switch (node.type) {
      case 'ImportDeclaration':
        if (
          typeof node.source?.value === 'string' &&
          node.source.value.endsWith('.css') &&
          !pick.includes('$css')
        ) {
          const specifiers = node.specifiers ?? []
          if (specifiers.length) {
            for (const s of specifiers) {
              if (s.local) {
                cssLocals.add(s.local)
              }
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
        const declaration = node.declaration
        if (declaration && isNamedDeclaration(declaration) && declaration.id) {
          unexported.add(node)
          candidates.add(declaration.id)
        } else {
          removed.add(node)
        }
        break
      }
      case 'ExportNamedDeclaration': {
        const specifiers = node.specifiers ?? []
        if (specifiers.length) {
          for (const specifier of specifiers) {
            if (!pick.includes(exportedName(specifier))) {
              removed.add(specifier)
            }
          }
          if (specifiers.every((specifier) => removed.has(specifier))) {
            removed.add(node)
          }
          break
        }
        const declaration = node.declaration
        if (declaration && isNamedDeclaration(declaration)) {
          if (declaration.id?.name && !pick.includes(declaration.id.name)) {
            unexported.add(node)
            candidates.add(declaration.id)
          }
        } else if (declaration?.type === 'VariableDeclaration') {
          for (const declarator of declaration.declarations ?? []) {
            if (
              declarator.id?.type === 'Identifier' &&
              declarator.id.name &&
              !pick.includes(declarator.id.name)
            ) {
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
  function markIfReferenced(identifier: AstNode): void {
    if (isBindingReferenced(before.bindingOf(identifier), tree, true)) {
      sweepable.add(identifier)
    }
  }
  function collect(node: AstNode): void {
    if (removed.has(node)) {
      return
    }
    if (node.type === 'VariableDeclarator') {
      if (node.id?.type === 'Identifier') {
        markIfReferenced(node.id)
      } else if (node.id?.type === 'ObjectPattern' || node.id?.type === 'ArrayPattern') {
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
      sweepable.add(node.local)
    }
    forEachChild(node, collect)
  }
  collect(program)
  removeUnreachable(program, tree, sweepable, candidates)

  let changed: boolean
  do {
    changed = false
    const { bindingOf } = crawl(program, tree)
    const isDead = (identifier: AstNode): boolean =>
      sweepable.has(identifier) && !isBindingReferenced(bindingOf(identifier), tree, false)
    const sweep = (node: AstNode): void => {
      if (removed.has(node)) {
        return
      }
      if (node.type === 'VariableDeclarator') {
        if (node.id?.type === 'Identifier') {
          if (isDead(node.id) && removeDeclarator(node, tree)) {
            changed = true
          }
        } else if (node.id?.type === 'ObjectPattern') {
          changed = sweepObjectPattern(node, isDead, tree) || changed
        } else if (node.id?.type === 'ArrayPattern') {
          changed = sweepArrayPattern(node, isDead, tree) || changed
        }
      } else if (isFunctionLike(node) || isClassLike(node)) {
        const identifier = boundIdentifier(node, parents)
        if (identifier && !isOwnExpressionName(identifier, parents) && isDead(identifier)) {
          const parent = parents.get(node)
          if (parent?.type === 'VariableDeclarator') {
            changed = removeDeclarator(parent, tree) || changed
          } else if (parent?.type === 'AssignmentExpression') {
            const statement = parents.get(parent)
            if (statement?.type === 'ExpressionStatement') {
              removeStatement(statement, tree)
              changed = true
            }
          } else {
            removeStatement(node, tree)
            changed = true
          }
        }
      } else if (node.type === 'ImportDeclaration') {
        const specifiers = node.specifiers ?? []
        for (const specifier of specifiers) {
          if (!removed.has(specifier) && specifier.local && isDead(specifier.local)) {
            removed.add(specifier)
            changed = true
          }
        }
        if (specifiers.length && specifiers.every((s) => removed.has(s))) {
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
export function toPickId(src: string, pick: Array<string>): string {
  const query = pick.map((p) => `pick=${p}`).join('&')
  const ext = extname(src).slice(1)
  return PICKABLE_EXTENSIONS.has(ext) ? `${src}?${query}&lang.${ext}` : `${src}?${query}`
}

const PICK_CHUNK_NAME_RE = /\.[cm]?[jt]sx?\?pick=[^?]*(?:&lang(?:\.[cm]?[jt]sx?)?)?$/
// eslint-disable-next-line no-control-regex
const INVALID_CHAR_RE = /[\u0000-\u001F"#$&*+,:;<=>?[\]^`{|}\u007F]/g
const DRIVE_LETTER_RE = /^[a-z]:/i

/** Drops `?pick=...&lang` so route chunks keep stable and clean filenames. */
export function sanitizeChunkFileName(name: string): string {
  const stripped = name.replace(PICK_CHUNK_NAME_RE, '')
  const driveLetter = DRIVE_LETTER_RE.exec(stripped)?.[0] ?? ''
  return driveLetter + stripped.slice(driveLetter.length).replaceAll(INVALID_CHAR_RE, '_')
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
