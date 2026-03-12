import { fileRouter } from 'solid-file-router/plugin'
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

export default defineConfig({
  plugins: [
    solid(),
    fileRouter({
      infoDts: {
        name: 'string',
        role: 'string',
      },
      // verboseLog: true,
    }),
  ],
  build: {
    minify: false,
  },
})
