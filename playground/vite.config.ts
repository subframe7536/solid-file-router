import { fileURLToPath } from 'node:url'

import solid from '@solidjs/vite-plugin'
import { fileRouter } from 'solid-file-router/plugin'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^solid-file-router\/mdx(\/jsx-runtime)?$/,
        replacement: fileURLToPath(new URL('../src/mdx/index.ts', import.meta.url)),
      },
      {
        find: 'solid-file-router',
        replacement: fileURLToPath(new URL('../src/index.ts', import.meta.url)),
      },
    ],
  },
  plugins: [solid({ extensions: ['.jsx', '.tsx', '.mdx'] }), fileRouter({ mdx: true })],
  build: {
    minify: false,
  },
})
