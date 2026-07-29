import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    plugin: './src/index.ts',
    index: './src/runtime.ts',
    mdx: './src/mdx/index.ts',
  },
  deps: { neverBundle: ['virtual:routes', 'satteri'] },
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
