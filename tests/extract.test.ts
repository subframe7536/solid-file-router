import { describe, it, expect, beforeEach, vi } from 'vitest'

import { logger } from '../src/const'
import type { ExtractConfig } from '../src/utils/extract'
import { clearCache, extract, getAstCacheKey, invalidateCache } from '../src/utils/extract'

describe('extractPlugin', () => {
  beforeEach(() => {
    clearCache()
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

  describe('AST cache variants', () => {
    it('reuses the parsed AST for the same source with different transform configs', async () => {
      const code = `
export default createRoute({
  info: { title: 'shared' },
  component: SharedPage
})
`
      const routeConfig: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['info'],
      }
      const componentConfig: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['component'],
      }
      const cacheKey = getAstCacheKey('shared.tsx', code, false)
      const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {})

      const routeResult = await extract(code, 'shared.tsx', routeConfig, true, cacheKey)
      const componentResult = await extract(code, 'shared.tsx', componentConfig, true, cacheKey)

      expect(routeResult).toContain('info')
      expect(routeResult).not.toContain('component')
      expect(componentResult).toContain('component')
      expect(componentResult).not.toContain('info')
      expect(infoSpy).toHaveBeenCalledWith(`AST cache miss: ${cacheKey}`, { timestamp: false })
      expect(infoSpy).toHaveBeenCalledWith(`AST cache hit:  ${cacheKey}`, { timestamp: false })

      infoSpy.mockRestore()
    })

    it('keeps changed source isolated by code hash', async () => {
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['info'],
      }
      await extract(
        `export default createRoute({ info: { title: 'before' } })`,
        'shared.tsx',
        config,
        false,
      )

      const result = await extract(
        `export default createRoute({ info: { title: 'after' } })`,
        'shared.tsx',
        config,
        false,
      )

      expect(result).toContain('after')
      expect(result).not.toContain('before')
    })

    it('keeps SSR cache entries isolated for the same source', async () => {
      const code = `export default createRoute({ info: { title: 'same' } })`
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['info'],
      }
      const clientKey = getAstCacheKey('shared.tsx', code, false)
      const serverKey = getAstCacheKey('shared.tsx', code, true)
      const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {})

      await extract(code, 'shared.tsx', config, true, clientKey)
      await extract(code, 'shared.tsx', config, true, serverKey)

      expect(infoSpy).toHaveBeenCalledWith(`AST cache miss: ${clientKey}`, { timestamp: false })
      expect(infoSpy).toHaveBeenCalledWith(`AST cache miss: ${serverKey}`, { timestamp: false })
      expect(infoSpy).not.toHaveBeenCalledWith(`AST cache hit:  ${serverKey}`, {
        timestamp: false,
      })

      infoSpy.mockRestore()
    })

    it('invalidates all cache variants for a route file', async () => {
      const config: ExtractConfig = {
        entryFn: 'createRoute',
        pick: ['info'],
      }
      const beforeCode = `export default createRoute({ info: { title: 'before' } })`
      const afterCode = `export default createRoute({ info: { title: 'after' } })`

      await extract(
        beforeCode,
        'route.tsx',
        config,
        false,
        getAstCacheKey('route.tsx', beforeCode, false),
      )
      await extract(
        beforeCode,
        'route.tsx',
        config,
        false,
        getAstCacheKey('route.tsx', beforeCode, true),
      )
      invalidateCache('route.tsx')

      const result = await extract(afterCode, 'route.tsx', config, false)

      expect(result).toContain('after')
      expect(result).not.toContain('before')
    })
  })
})
