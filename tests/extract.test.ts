import { describe, it, expect, beforeEach } from 'vitest'

import type { ExtractConfig } from '../src/utils/extract'
import { extract, invalidateCache } from '../src/utils/extract'

describe('extractPlugin', () => {
  beforeEach(() => {
    invalidateCache('test.tsx')
  })
  describe('Case 1: direct export default call', () => {
    it('extracts properties from direct call expression', async () => {
      const code = `
export default createRoute({
  info: { title: 'Home' },
  component: HomePage,
  other: 'ignored'
})
`
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['info', 'component'],
      }
      const result = await extract(code, 'test.tsx', config)
      expect(result).toContain('info')
      expect(result).toContain('component')
      expect(result).not.toContain('other')
    })

    it('wraps with targetFn when provided', async () => {
      const code = `
export default createRoute({
  info: { title: 'Home' },
  component: HomePage
})
`
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['info', 'component'],
        targetFn: 'defineRoute',
      }
      const result = await extract(code, 'test.tsx', config)
      expect(result).toContain('defineRoute')
    })

    it('throws error when function name does not match', async () => {
      const code = `
export default wrongFunction({
  info: { title: 'Home' }
})
`
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['info'],
      }
      await expect(extract(code, 'test.tsx', config)).rejects.toThrow(
        'Expected function name to be "createRoute"',
      )
    })

    it('throws error when argument is not an object', async () => {
      const code = `
export default createRoute(someVariable)
`
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['info'],
      }
      await expect(extract(code, 'test.tsx', config)).rejects.toThrow(
        'Expected exactly one object argument',
      )
    })

    it('throws error when multiple arguments provided', async () => {
      const code = `
export default createRoute({ info: 'test' }, { extra: 'arg' })
`
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['info'],
      }
      await expect(extract(code, 'test.tsx', config)).rejects.toThrow(
        'Expected exactly one object argument',
      )
    })

    it('throws error when spread is used at top level', async () => {
      const code = `
const base = { info: 'test' }
export default createRoute({
  ...base,
  component: HomePage
})
`
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['info', 'component'],
      }
      await expect(extract(code, 'test.tsx', config)).rejects.toThrow('prevent treeshaking')
    })

    it('handles nested properties correctly (shallow pick)', async () => {
      const code = `
export default createRoute({
  info: { title: 'Home', nested: { deep: true } },
  component: HomePage,
  meta: { key: 'value' }
})
`
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['info', 'component'],
      }
      const result = await extract(code, 'test.tsx', config)
      expect(result).toContain('info')
      expect(result).toContain('component')
      expect(result).not.toContain('meta')
      // Should preserve nested structure
      expect(result).toContain('nested')
    })
  })

  describe('Case 2: identifier exported directly', () => {
    it('extracts from identifier assigned to createRoute call', async () => {
      const code = `
const routeConfig = createRoute({
  info: { title: 'Home' },
  component: HomePage,
  unused: 'value'
})
export default routeConfig
`
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['info', 'component'],
      }
      const result = await extract(code, 'test.tsx', config)
      expect(result).toContain('info')
      expect(result).toContain('component')
      expect(result).not.toContain('unused')
    })

    it('throws error when identifier is not a createRoute call', async () => {
      const code = `
const routeConfig = { info: 'test' }
export default routeConfig
`
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['info'],
      }
      await expect(extract(code, 'test.tsx', config)).rejects.toThrow(
        `No default export with \`createRoute({})\``,
      )
    })
  })

  describe('Case 3: identifier re-exported', () => {
    it('throws error when trying to use export specifier without binding', async () => {
      const code = `
export { createRoute as default }
`
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['info'],
      }
      // This throws a syntax error since createRoute is not defined
      await expect(extract(code, 'test.tsx', config)).rejects.toThrow()
    })
  })

  describe('edge cases', () => {
    it('handles empty pick array', async () => {
      const code = `
export default createRoute({
  info: { title: 'Home' },
  component: HomePage
})
`
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: [],
      }
      const result = await extract(code, 'test.tsx', config)
      expect(result).toBeTruthy()
    })

    it('handles pick array with non-existent properties', async () => {
      const code = `
export default createRoute({
  info: { title: 'Home' },
  component: HomePage
})
`
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['info', 'nonexistent', 'alsoMissing'],
      }
      const result = await extract(code, 'test.tsx', config)
      expect(result).toContain('info')
      expect(result).not.toContain('component')
    })

    it('throws error when no default export exists', async () => {
      const code = `
export const route = createRoute({
  info: { title: 'Home' }
})
`
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['info'],
      }
      await expect(extract(code, 'test.tsx', config)).rejects.toThrow(
        `No default export with \`createRoute({})\``,
      )
    })

    it('handles JSX in component property', async () => {
      const code = `
export default createRoute({
  info: { title: 'Home' },
  component: () => <div>Home</div>
})
`
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['info', 'component'],
      }
      const result = await extract(code, 'test.tsx', config)
      expect(result).toContain('info')
      expect(result).toContain('component')
    })

    it('preserves method shorthand properties', async () => {
      const code = `
export default createRoute({
  info: { title: 'Home' },
  loader() { return {} }
})
`
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['info', 'loader'],
      }
      const result = await extract(code, 'test.tsx', config)
      expect(result).toContain('info')
      expect(result).toContain('loader')
    })

    it('works with TypeScript annotations', async () => {
      const code = `
export default createRoute({
  info: { title: 'Home' } as const,
  component: HomePage as Component
})
`
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['info', 'component'],
      }
      const result = await extract(code, 'test.tsx', config)
      expect(result).toContain('info')
      expect(result).toContain('component')
    })

    it('filters out arrow function properties not in pick', async () => {
      const code = `
export default createRoute({
  info: { title: 'Home' },
  component: HomePage,
  preload: () => Promise.resolve(),
  loader: async () => ({})
})
`
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['info', 'component'],
      }
      const result = await extract(code, 'test.tsx', config)
      expect(result).toContain('info')
      expect(result).toContain('component')
      expect(result).not.toContain('preload')
      expect(result).not.toContain('loader')
    })

    it('handles computed property names', async () => {
      const code = `
const propName = 'info'
export default createRoute({
  [propName]: { title: 'Home' },
  component: HomePage
})
`
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['info', 'component'],
      }
      // Computed properties won't match by identifier check
      const result = await extract(code, 'test.tsx', config)
      expect(result).toContain('component')
    })
  })

  describe('Case 3: export { x as default }', () => {
    it('extracts properties from named export with default alias', async () => {
      const code = `
const route = createRoute({
  info: { title: 'Home' },
  component: HomePage,
  other: 'ignored'
})
export { route as default }
`
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['info', 'component'],
      }
      const result = await extract(code, 'test.tsx', config)
      expect(result).toContain('info')
      expect(result).toContain('component')
      expect(result).not.toContain('other')
    })

    it('wraps with targetFn when provided', async () => {
      const code = `
const route = createRoute({
  info: { title: 'Home' },
  component: HomePage
})
export { route as default }
`
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['info', 'component'],
        targetFn: 'defineRoute',
      }
      const result = await extract(code, 'test.tsx', config)
      expect(result).toContain('defineRoute')
    })

    it('throws error when function name does not match', async () => {
      const code = `
const route = wrongFunction({
  info: { title: 'Home' }
})
export { route as default }
`
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['info'],
      }
      await expect(extract(code, 'test.tsx', config)).rejects.toThrow(
        'Expected function name to be "createRoute"',
      )
    })

    it('throws error when spread is used at top level', async () => {
      const code = `
const base = { info: 'test' }
const route = createRoute({
  ...base,
  component: HomePage
})
export { route as default }
`
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['info', 'component'],
      }
      await expect(extract(code, 'test.tsx', config)).rejects.toThrow('prevent treeshaking')
    })
  })

  describe('real-world scenarios', () => {
    it('extracts meta from page with full route config', async () => {
      const code = `
const HomePage = lazy(() => import('./components/Home'))

export default createRoute({
  info: {
    title: 'Home',
    description: 'Welcome'
  },
  component: HomePage,
  preload: () => {},
  matchFilters: [],
  errorComponent: ErrorPage,
  loadingComponent: () => HomePage
})
`
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['info', 'preload', 'matchFilters'],
      }
      const result = await extract(code, 'test.tsx', config)
      expect(result).toContain('info')
      expect(result).toContain('preload')
      expect(result).toContain('matchFilters')
      expect(result).not.toContain('errorComponent')
    })

    it('transforms to component wrapper', async () => {
      const code = `
export default createRoute({
  component: HomePage,
  errorComponent: ErrorPage,
  loadingComponent: loadPage
})
`
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['component', 'errorComponent', 'loadingComponent'],
        targetFn: '__wrapRoute',
      }
      const result = await extract(code, 'test.tsx', config)
      expect(result).toContain('__wrapRoute')
    })
  })

  describe('?load and ?error transforms', () => {
    it('extracts only loadingComponent with ?load transform', async () => {
      const code = `
export default createRoute({
  component: HomePage,
  errorComponent: ErrorPage,
  loadingComponent: LoadingSpinner,
  info: { title: 'Home' }
})
`
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['loadingComponent'],
      }
      const result = await extract(code, 'test.tsx', config)
      expect(result).toContain('loadingComponent')
      expect(result).not.toContain('component')
      expect(result).not.toContain('errorComponent')
      expect(result).not.toContain('info')
    })

    it('extracts only errorComponent with ?error transform', async () => {
      const code = `
export default createRoute({
  component: HomePage,
  errorComponent: ErrorPage,
  loadingComponent: LoadingSpinner,
  info: { title: 'Home' }
})
`
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['errorComponent'],
      }
      const result = await extract(code, 'test.tsx', config)
      expect(result).toContain('errorComponent')
      expect(result).not.toContain('component')
      expect(result).not.toContain('loadingComponent')
      expect(result).not.toContain('info')
    })

    it('extracts only component with ?comp transform', async () => {
      const code = `
export default createRoute({
  component: HomePage,
  errorComponent: ErrorPage,
  loadingComponent: LoadingSpinner,
  info: { title: 'Home' }
})
`
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['component'],
        targetFn: '__comp',
      }
      const result = await extract(code, 'test.tsx', config)
      expect(result).toContain('__comp')
      expect(result).toContain('component')
      expect(result).not.toContain('errorComponent')
      expect(result).not.toContain('loadingComponent')
      expect(result).not.toContain('info')
    })

    it('handles missing loadingComponent gracefully', async () => {
      const code = `
export default createRoute({
  component: HomePage,
  errorComponent: ErrorPage
})
`
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['loadingComponent'],
      }
      const result = await extract(code, 'test.tsx', config)
      expect(result).toBeTruthy()
      expect(result).not.toContain('loadingComponent')
    })

    it('handles missing errorComponent gracefully', async () => {
      const code = `
export default createRoute({
  component: HomePage,
  loadingComponent: LoadingSpinner
})
`
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['errorComponent'],
      }
      const result = await extract(code, 'test.tsx', config)
      expect(result).toBeTruthy()
      expect(result).not.toContain('errorComponent')
    })

    it('extracts loadingComponent from layout file', async () => {
      const code = `
export default createRoute({
  component: LayoutWrapper,
  loadingComponent: () => <div>Loading layout...</div>,
  errorComponent: LayoutError
})
`
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['loadingComponent'],
      }
      const result = await extract(code, 'test.tsx', config)
      expect(result).toContain('loadingComponent')
      expect(result).toContain('Loading layout...')
    })

    it('extracts errorComponent from app file', async () => {
      const code = `
export default createRoute({
  component: AppRoot,
  errorComponent: GlobalErrorBoundary,
  loadingComponent: GlobalLoader
})
`
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['errorComponent'],
      }
      const result = await extract(code, 'test.tsx', config)
      expect(result).toContain('errorComponent')
      expect(result).toContain('GlobalErrorBoundary')
    })
  })
})
