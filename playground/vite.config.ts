import solid from 'vite-plugin-solid'
import { defineConfig } from 'vite'
import { fileRouter } from '../src/index'

export default defineConfig({
  plugins: [
    solid(),
    fileRouter({
      infoDts: {
        name: 'string',
        role: 'string',
      },
      verboseLog: true,
    }),
  ],
  build: {
    minify: false,
  },
})
