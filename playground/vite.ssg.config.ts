import { fileURLToPath } from 'node:url'

import { fileRouter } from 'solid-file-router/plugin'
import { defineConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'

export default defineConfig({
  resolve: {
    alias: [
      {
        find: 'solid-file-router/mdx',
        replacement: fileURLToPath(new URL('../src/mdx/index.ts', import.meta.url)),
      },
      {
        find: 'solid-file-router',
        replacement: fileURLToPath(new URL('../src/index.ts', import.meta.url)),
      },
    ],
  },
  plugins: [
    solidPlugin({ ssr: true }),
    fileRouter({
      infoDts: {
        name: 'string',
        role: 'string',
      },
      ssg: {
        serverEntry: 'src/entry-server.tsx',
        // routes: ['/', '/about'],
        concurrency: 4,
      },
    }),
  ],
  build: {
    minify: false,
  },
})
