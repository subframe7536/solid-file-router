export const patterns = {
  optional: [/^-(:?[\w-]+|\*)/, '$1?'],
  param: [/\[([^\]]+)]/g, ':$1'],
  route: [/^.*\/?src\/pages\/|\.(jsx|tsx|mdx)$/g, ''],
  slash: [/^index$|\./g, '/'],
  splat: [/\[\.{3}\w+\]/g, '*'],
  modal: [/\+|\([\w-]+\)\//g, ''],
  indexName: [/(\/)?index/g, ''],
  dots: [/\./g, '/'],
} as const

function wrapInline(code: string) {
  return `$###${code}###$`
}

function unwrapInline(str: object) {
  return JSON.stringify(str, null, 2)
    .replaceAll('"$###', '')
    .replaceAll('###$"', '')
    .replaceAll('"__": ', '')
}

interface BaseRoute {
  id?: string
  path?: string
  children?: BaseRoute[]
  component?: string
  __?: string
}

const REG_LAYOUT = /_layout\.(jsx|tsx)$/
const REG_GROUP = /\([\w-]+\)/
const REG_INSERT = /^\w|\//

export async function generateRegularRoutes(
  files: string[],
): Promise<[imports: string[], routs: BaseRoute[]]> {
  const imports = []

  const appPath = files.find((key) => key.endsWith('_app.tsx'))
  if (!appPath) {
    throw new Error('No `_app.tsx` found')
  }
  imports.push(`import __app_comp from '${appPath}?comp'`)

  const filtered = files.filter(
    (key) =>
      (!key.includes('/_') || REG_LAYOUT.test(key)) && !key.endsWith('404.tsx'),
  )
  const regularRoutes: BaseRoute[] = []
  for (let i = 0; i < filtered.length; i++) {
    const file = filtered[i]
    imports.push(`import __route${i}_meta from '${file}?meta'`)
    const route: BaseRoute = {
      id: file.replace(...patterns.route),
      component: wrapInline(`lazy(() => import('${file}?comp'))`),
      __: wrapInline(`...__route${i}_meta`),
    }

    const segments = file
      .replace(...patterns.route)
      .replace(...patterns.splat)
      .replace(...patterns.param)
      .split('/')
      .filter(Boolean)
    console.log(segments)

    segments.reduce((parent, segment, index) => {
      const path = segment
        .replace(...patterns.slash)
        .replace(...patterns.optional)
      const root = index === 0
      const leaf = index === segments.length - 1 && segments.length > 1
      const node = !root && !leaf
      const layout = segment === '_layout'
      const group = REG_GROUP.test(path)
      const insert = REG_INSERT.test(path) ? 'unshift' : 'push'

      if (root) {
        const last = segments.length === 1
        if (last) {
          regularRoutes.push({ path, ...route })
          return parent
        }
      }

      if (root || node) {
        const current = root ? regularRoutes : parent.children
        const found = current?.find(
          (r) =>
            r.path === path ||
            r.id?.replace('/_layout', '').split('/').pop() === path,
        )
        const props = group
          ? route?.component
            ? { id: path, path: '/' }
            : { id: path }
          : { path }
        if (found) {
          found.children ??= []
        } else {
          current?.[insert]({ ...props, children: [] })
        }
        return (
          found ||
          (current?.[
            insert === 'unshift' ? 0 : current.length - 1
          ] as BaseRoute)
        )
      }

      if (layout) {
        return Object.assign(parent, route)
      }

      if (leaf) {
        parent?.children?.[insert]({ path, ...route })
      }

      return parent
    }, {} as BaseRoute)
  }

  const notFoundPath = files.find((key) => key.endsWith('404.tsx'))
  if (!notFoundPath) {
    throw new Error('No `404.tsx` found')
  }
  imports.push(
    `import __404_comp from '${notFoundPath}?comp'`,
    `import __404_meta from '${notFoundPath}?meta'`,
  )
  regularRoutes.push({
    id: '*',
    path: '*',
    component: wrapInline('__404_comp'),
    __: wrapInline(`...__404_meta`),
  })

  return [imports, regularRoutes]
}

export async function generateDefinition(files: string[]): Promise<string> {
  const [imports, regularRoutes] = await generateRegularRoutes(files)
  const result = `${imports.join('\n')}
import { createComponent, lazy } from 'solid-js'
import { Router } from '@solidjs/router'

export const Root = __app_comp

export const fileRoutes = ${unwrapInline(regularRoutes)}
export const FileRouter = (props) => createComponent(Router, {
  get base() {
    return props.base
  },
  get root() {
    return Root
  },
  get children() {
    return fileRoutes
  }
})
  `
  return result
}
