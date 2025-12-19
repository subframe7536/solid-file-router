import { build, defineConfig } from 'tsdown'
import solidPlugin from 'vite-plugin-solid'

const result = await build({
  entry: './src/helper/loader.tsx',
  plugins: [solidPlugin()],
  write: false,
  dts: false,
  config: false,
})

const chunk = result[0].chunks[0]

export default defineConfig({
  entry: { plugin: './src/index.ts', index: './src/runtime.ts' },
  external: ['@babel/core', 'vite'],
  define:
    chunk.type === 'chunk'
      ? {
          __LOADER__: JSON.stringify(chunk.code),
        }
      : undefined,
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
