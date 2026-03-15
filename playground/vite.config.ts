import { fileRouter } from 'solid-file-router/plugin'
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

export default defineConfig({
  plugins: [
    solid({ ssr: true }),
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
