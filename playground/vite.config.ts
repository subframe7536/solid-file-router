import solid from 'vite-plugin-solid'
import { defineConfig } from 'vite'
import { fileRouterPlugin } from 'solid-file-router/plugin'

export default defineConfig({
  plugins: [solid(), fileRouterPlugin()],
  build: {
    minify: false,
  },
})
