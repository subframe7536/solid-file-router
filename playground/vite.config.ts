import { fileURLToPath } from 'node:url'

import { fileRouter } from 'solid-file-router/plugin'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    alias: {
      'solid-file-router': fileURLToPath(new URL('../src/runtime.ts', import.meta.url)),
    },
  },
  plugins: [
    fileRouter({
      mode: 'ssg',
      infoDts: {
        name: 'string',
        role: 'string',
      },
      ssg: {
        routes: ['*'],
      },
      verboseLog: true,
    }),
  ],
  build: {
    minify: false,
  },
})
