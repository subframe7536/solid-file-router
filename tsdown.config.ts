import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { plugin: './src/index.ts', index: './src/runtime.ts' },
  deps: { skipNodeModulesBundle: true, neverBundle: ['virtual:routes'] },
  exports: {
    customExports(exports) {
      exports['./client'] = {
        types: './client.d.ts',
      }
      return exports
    },
  },
  ignoreWatch: ['./playground'],
})
