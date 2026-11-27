import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    plugin: './src/plugin.ts',
    index: './src/index.ts',
    mdx: './src/mdx/index.ts',
    api: './src/fs/api.ts',
  },
  dts: { generator: 'tsrs' },
  deps: { neverBundle: ['virtual:routes', 'satteri'] },
  exports: {
    customExports(exports) {
      exports['./mdx/jsx-runtime'] = './dist/mdx.mjs'
      exports['./mdx/jsx-dev-runtime'] = './dist/mdx.mjs'
      exports['./client'] = {
        types: './client.d.ts',
      }
      return exports
    },
  },
  ignoreWatch: ['./playground'],
})
