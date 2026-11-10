# 005 — SSG：基于 start handler 的薄预渲染插件

Written against `d049326`. 依赖 004。产出：删除 `src/ssg/` 约 750 行自研
SSR/模板/head 注入，替换为 ~150 行「遍历路由 → `handleRequest` → 写文件」。

## 前提（用户侧）

```ts
// vite.config.ts
solid({ start: true, ssr: true }),  // 官方 start 模式，产出 dist/server/server.js
fileRouter({ ssg: {} }),
```

start 模式 `ssr: true` 时 `vite build` 输出 `dist/client` + `dist/server/server.js`，
默认导出 `{ fetch(request) }` 与具名 `handleRequest(request)`，head 标签由
`useHead`/`@solidjs/meta` 自动拼进 HTML——本包不再需要 `renderTemplate`、
`applyRouteMetadataToHtml`、head baseline、`HydrationScript` 注入。

## 新 `createSsgPlugin`（`src/ssg/index.ts` 重写）

职责三项：

1. **路由收集**：`registry` 不复存在 → 从 `virtual:routes` manifest（或注入
   的 routes 参数）取扁平 entries，过滤含 `:`/`*`/私有段的路径得静态路由；
   `ssg.routes`（数组或函数）可覆盖；draft 过滤复用 004 的语义（prod 剔除）。
2. **预渲染**（`generateBundle` / client env build 完成后，沿用旧
   `loadServerRenderer` 思路但目标换成 start handler）：
   - `import(<serverOutDir>/server.js)` → `handleRequest`；
   - `new Request('http://local' + route)` → `res.text()` →
     `getPrerenderAssetFileName(route)`（保留 `/`→`index.html`、`/x`→`x.html`、
     尾斜杠→`x/index.html` 旧规则）emit asset；
   - `/404` 必渲染为 `404.html`（保留旧不变式）；`concurrency`（默认 4）
     沿用 `mapWithConcurrency`（此函数保留，约 20 行）。
   - `ssg.serverEntry` 选项保留：允许非 start 模式的自托管 SSR entry，
     导出一个 `(request: Request) => Promise<Response|string>` 即可；
     返回 string 时视作 html。
3. **预览回退**：`createPreviewFallbackMiddleware` 基本原样保留
   （`acceptsHtml`/`getPreviewRoutePath`/`hasPreviewFile`/`404.html` 回写），
   仅去掉 base 处理里依赖自有 manifest 的部分。

## 删除

- `ID_PRERENDER`/`VID_PRERENDER` 虚拟 server entry（官方 handler 替代）
- `renderTemplate`/`applyRouteMetadataToHtml`/`createHeadBaseline`/
  `insertHeadBaseline`/`replaceRootOutlet`/所有 head marker 约定
  （`<!--solid-file-router-outlet-->`、`<!--solid-file-router-head-->`、
  `data-solid-file-router-head-default` 全部退役）
- `generateHydrationScript` 引用
- `findSsrEntryChunk`/`findIndexHtmlAsset`（不再需要定位 index.html 模板——
  start 模式直接产出含 head 的完整 HTML；`/` 路由以
  `emitFile(index.html)` 覆盖 client asset 同名文件即可）
- ENVIRONMENT.SERVER 自定义 `ssr` 环境配置（start 模式自己建环境）

## `SsgOptions`

```ts
interface SsgOptions {
  routes?: PrerenderRoutesSource // 保留
  concurrency?: number // 保留，默认 4
  serverEntry?: string // 非 start 模式下的自定义入口（可省）
  outDir?: string // 静态输出目录，默认 dist/client
}
```

`id`（root outlet id）与 `renderTemplate` 公开导出删除。

## 风险

- start 模式 `dist/server/server.js` 的确切文件名/导出形态以 001#9 实测为准；
  若不同，按实测调整解析逻辑。
- `handleRequest` 在纯构建（非 dev/preview）进程里直接 import 运行——旧
  `loadServerRenderer` 已这么做，沿用 `?t=<ts>` cache-bust。
- 若用户不开 start 模式，`ssg` 选项报错并指向文档（或走 `serverEntry`）。

## 验证

`tests/ssg.test.ts`：mock handler + manifest → 断言输出文件名、并发、
404 必发、非法 route 报错（`normalizeRoutePath` 保留）。

## 边界

- 不实现 SSR dev serving（start 模式全包）。
- 不保留 `virtual:solid-file-router/prerender-entry`。
