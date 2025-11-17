import solid from 'vite-plugin-solid'
import { defineConfig } from 'vite'
import { fileRouterPlugin } from '../src/index'

export default defineConfig({
  plugins: [solid(), fileRouterPlugin()],
  build: {
    minify: false,
  },
})
