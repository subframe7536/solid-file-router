import { fileURLToPath } from 'node:url'

import { fileRouter } from 'solid-file-router/plugin'
import { defineConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'

export default defineConfig({
  resolve: {
    alias: {
      'solid-file-router': fileURLToPath(new URL('../src/runtime.ts', import.meta.url)),
    },
  },
  plugins: [
    solidPlugin({ ssr: true }),
    fileRouter({
      infoDts: {
        name: 'string',
        role: 'string',
      },
      ssg: {
        routes: ['*'],
      },
      // verboseLog: true,
    }),
  ],
  build: {
    minify: false,
  },
})
