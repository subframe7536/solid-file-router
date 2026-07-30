import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    plugin: './src/plugin.ts',
    index: './src/index.ts',
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
