import { defineConfig } from 'tsdown'
// import solid from 'vite-plugin-solid'

// export both js and jsx
// export default defineConfig([
//   {
//     // use the solid plugin to handle jsx
//     plugins: [solid()],
//   },
//   {
//     outExtensions: () => ({ js: '.jsx' }),
//   },
// ])

export default defineConfig({
  entry: ['./src/index.ts'],
  external: ['@babel/core'],
  exports: true,
})
