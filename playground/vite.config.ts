import solid from 'vite-plugin-solid'
import { defineConfig } from 'vite'
import { fileRouterPlugin } from '../src'

export default defineConfig({
  plugins: [solid(), fileRouterPlugin()],
  build: {
    minify: false,
  },
})
