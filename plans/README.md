# Solid 2 重构计划 — solid-file-router

Written against `d049326` (v0.7.3).

目标：以 Solid 2 官方栈为底座重构本包，允许破坏性更新。官方栈覆盖扫描/路由树/
代码分割/HMR/类型生成/链接与 head 管理；本包退化为薄预设（preset），仅保留官方
没有的能力：旧文件名约定、loading/error 组件继承、声明式 route metadata、
多页 SSG 预渲染、MDX 路由、draft 路由、route providers。

用户已确认：

- 采用方案 A（官方栈薄预设）
- 内置 `DefaultFileSystemRouter` 承载本包文件名约定
  （`_app`/`_layout`/`-[lang]`/`-[...all]`/`404`/`.` 分段/`_` 私有）；
  约定以适配器注入（`convention: defaultConvention | solidStartConvention |
  flatConvention | (c) => BaseFileSystemRouter`），不设字符串选项；
  `router`/`routers` 仍直通官方接缝

## 官方依赖（全部预发布，须精确锁版本）

| 包                     | 版本                     | 角色                                                 |
| ---------------------- | ------------------------ | ---------------------------------------------------- |
| `solid-js`             | `2.0.0-rc.21` (`next`)   | 核心                                                 |
| `@solidjs/web`         | `2.0.0-rc.21`            | DOM 渲染、`useHead`、`Dynamic`、SSR                  |
| `@solidjs/router`      | `2.0.0-next.44` (`next`) | `createRouter` + `./fs` 发射适配器                   |
| `filesystem-routing`   | `0.5.0`                  | 扫描、约定、Vite 虚拟模块、`?pick=` 树摇、types 生成 |
| `@solidjs/vite-plugin` | `3.0.0-next.35`          | JSX 编译（原 `vite-plugin-solid` 改名）              |
| `satteri`              | `^0.9.5`                 | MDX 编译（复用现状）                                 |

`@solidjs/start`（latest 2.2.2）仍是 Solid 1 体系，不进入依赖。
`@solidjs/meta` 是 `@solidjs/web` 里 `useHead` 的薄封装，可直接用 `useHead`，
不必新增依赖（如想要 `<Title>`/`<Meta>` 组件可列为 optional peer）。

## 计划索引

| #   | 计划                                                                                         | 依赖    | 状态 |
| --- | -------------------------------------------------------------------------------------------- | ------- | ---- |
| 001 | [官方栈验证性样例](001-official-stack-spike.md)                                              | —       | DONE |
| 002 | [bun→pnpm 迁移、依赖升级 + `DefaultFileSystemRouter` 与约定适配器](002-legacy-convention.md) | 001     | DONE |
| 003 | [插件层重写：fileRouter → fileRoutes 预设](003-plugin-rewrite.md)                            | 002     | DONE |
| 004 | [运行时适配器：createFileRouter / 继承 / metadata→useHead / draft](004-runtime-adapter.md)   | 003     | DONE |
| 005 | [SSG：基于 start handler 的薄预渲染插件](005-ssg-prerender.md)                               | 004     | DONE |
| 006 | [MDX：编译产物改为 `route` 导出 + 运行时移植](006-mdx.md)                                    | 004     | DONE |
| 007 | [测试 / playground / 文档 全量改写](007-tests-playground-docs.md)                            | 004–006 | DONE |
| 008 | [迁移文档 + v1.0.0 发布](008-migration-guide-release.md)                                     | 002–007 | DONE |

建议执行顺序：001 → 002 → 003 → 004 → 005、006 并行 → 007 → 008。

本计划全部完成后发布 **v1.0.0**（破坏性更新，随附 `MIGRATION.md`）。

## 已确认的官方机制（写进各计划，勿重复调研）

- `@solidjs/router@next`：`createRouter({ routes })` 返回实例即 Provider 组件，
  render-prop 子节点即根布局；`paths` 为类型化 URL 代理；链接是普通 `<a>`；
  `defineFileRoute(pattern, config)` 为路由文件内类型见证。
- `filesystem-routing`：`fileRoutes(options)` Vite 插件输出 `virtual:file-routes`
  （`moduleId` 可改），默认导出扁平 manifest，`pageRoutes` 为按路径前缀嵌套并
  剥掉 `(group)` 段的树。`toPath`（文件名→中立路径）与 `toRoute`（源文件→
  manifest entry）是两个扩展点。`$x` ref → 动态 import，`$$x` ref → 静态 import，
  各按 `pick` 列表树摇。`types` 选项写自包含 d.ts（manifest 为字面量元组）。
- 嵌套语义（`buildRouteTree`）：子路径以 `父id + "/"` 前缀判断；`blog.tsx`→`/blog`
  为 `blog/` 目录下一切的 layout；`blog/index.tsx`→`/blog/` 成为其子路由。
  `(app)` 组段不产生 URL 但参与嵌套：文件映射到 `/(app)` 即成为全体路由的父
  layout —— `_app.tsx` 由此映射。
- `PageFileSystemRouter.toRoute` 对 `.md`/`.mdx` 特判：只发 `$component`
  （`pick: ["$css"]`），不分析导出，因此 MDX 的 `route` 配置要靠自定义 `toRoute`。
- `analyzeRouteModule` 是 `fs.readFileSync` 读磁盘 + oxc-parser：
  CMS/虚拟路由文件不能用默认 `toRoute`，需要自定义（见 003 风险项）。
- `?pick=` 模块经 `vite-plugin-solid` 编译需在 solid 插件里显式
  `extensions: [".jsx", ".tsx"]`（含 `.md`/`.mdx` 则按需追加）——官方 README 明确。
- Solid 2 API 变更：`Suspense→Loading`、`ErrorBoundary→Errored`、
  `mergeProps→merge`（`undefined` 会覆盖）、`Context.Provider` 直接以 context 作
  provider、`Dynamic`/`lazy` 移入 `@solidjs/web`、`onMount→onSettled`、
  单回调 `createEffect` 拆分 compute/apply、setter 后即刻读需 `flush()`。
- start 模式（`solid({ start: true, ssr: true })`）：构建产出
  `dist/server/server.js`，默认导出 `{ fetch(request) }` + 具名 `handleRequest`，
  head 标签由 `useHead` 自动拼入 `<head>`；`ssr: false` 时只预渲染空壳。
- `useHead`（`@solidjs/web`）为环境级 head 注册表：后到者覆盖同 identity 标签，
  unmount 回退；SSR 自动拼接 —— 取代本仓库 `RouteMetadataManager` + SSG head 注入
  共约 600 行。

## 001 验证结果（/tmp/sfr-spike，全部实测）

| #   | 项                                                                       | 结果                                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 最小链路（fileRoutes + @solidjs/router/fs + createRouter + vite-plugin） | ✅ dev/build/SSR 全通，路由分包正常                                                                                                                                                                                                                                                                                          |
| 2   | `?pick=` 与 solid 插件                                                   | ✅ `extensions: ['.jsx','.tsx']` 必需；`&lang.tsx` 尾缀命中 filter；`.mdx?pick=route`（无 lang 尾缀）也被 mdx transform（`order:'pre'`、正则含 `(\?.*)?`）与 solid 编译命中                                                                                                                                                  |
| 3   | `toPath` 自定义（`/(app)` 组段）                                         | ✅ `PageFileSystemRouter` 子类覆盖 `toPath` 生效；`_app`→`/(app)` 成为全体父 layout，`/(app)/index`→`/`                                                                                                                                                                                                                      |
| 4   | catch-all                                                                | ✅ `*404` 作 not-found 通配（`/nowhere`→`params['404']='nowhere'`）；**`*x` 匹配空尾**（`/blog`→`all:""`）——即官方 splat 即旧 `-[...all]` 可选语义；旧 `[...all]`「必填一段」差异消失，记录为破坏性放宽                                                                                                                      |
| 5   | `.mdx` 的 `route` 导出                                                   | ✅ 自定义 `toRoute` 发 `$$route:{src,pick:['route']}` 可工作；**注意**：`.mdx` 不在 `PICKABLE_EXTENSIONS`，fs tree-shake 不收窄——`import {route}` 拉入整个编译产物（静态 import 进 manifest chunk，组件代码随入口打包）。006 倾向用虚拟模块方案保代码分割                                                                    |
| 6   | 虚拟 src 的 `?pick=`                                                     | ✅ 可行——但 resolveId 必须返回**非 `\0`** 虚拟路径（如 `/.sfr-virtual/x.tsx`）；`\0` id 跳过 solid transform（JSX 不编译）。pick 收窄正常                                                                                                                                                                                    |
| 7   | satteri → Solid 2                                                        | ⚠️ `jsx: true` 产物在 **SSR 下失败**：`<_components.h1>` 被编译为直接调用 `_components.h1(props)`，字符串 intrinsic 不可调用（`createComponent` 在服务端同样直接调用）。**解法**：`jsx: false` + 自有 `jsxImportSource`（`jsx/jsxs = (t,p) => Dynamic({component:t,...p})`、`Fragment`），SSR/CSR 均正确。satteri 0.9.5 可用 |
| 8   | Vite 8                                                                   | ✅ 8.3.7 无运行时问题                                                                                                                                                                                                                                                                                                        |
| 9   | start handler                                                            | ✅ `solid({start:true,ssr:true})` 产出 `dist/client` + `dist/server/server.js`（ESM）；`handleRequest(request)` 可独立调用，`useHead` 注入的 `<title data-dh>` 进入 `<head>`                                                                                                                                                 |

补充实测结论（写进实现注意）：

- `Router.paths` 代理节点是**可调用对象**：`paths.blog('1')` 返回 `TypedPath`/`PathEnd`
  节点（可传 `navigate`/`<a href>`），再次调用 `()`/`({search}, hash?)` 才得 string；
  `paths.about()` 直接返回 string。`tsc` 下 `paths.nope` 正确报错。
- tsc 的 `jsxImportSource` 应为 **`@solidjs/web`**（`solid-js/jsx-runtime` 在 Solid 2
  不存在）；`@solidjs/web/jsx-runtime` 只有类型、无运行时导出。
- `render`/`hydrate`/`Dynamic`/`useHead`/`lazy`（客户端）在 `@solidjs/web`；
  `createComponent` 仍在 `solid-js` 但 SSR 下不接受字符串 type。
- 虚拟/CMS 路由注入：`addRoute`/`updateRoute`/`isRoute` 被磁盘 glob 门控——
  须用 `router._addRoute(entry, src)` + `router.reload(path, type)`；
  `routePaths` 簿记（TS-private，运行时可写）需手动维护。
- `_addRoute` 在 `buildRoutes` 之前调用不会被清掉（build 只追加磁盘路由）。
- `useHead` 的 `props.children` 即标签文本内容。
- `useHead` 产物 `<title data-dh="title">` 带 `data-dh` 属性。

## 遗留决策/风险（计划在先，不阻塞编号执行）

- `routeProviders`（CMS）：**001#6 已验证可行**——走虚拟 `?pick=` 方案
  （003 主方案），resolveId 返回非 `\0` 路径；`/.sfr-virtual/` 或
  `<root>/node_modules/.sfr/` 风格 id 均可。.sfr-cache 临时文件方案仅作兜底。
- satteri 0.9.5 可编译并被 Solid 2 消费，但**必须 `jsx: false` + 自有运行时**
  （006 落实）。0.11.7 升级在 002 顺带做。
- `-[...all]` 旧语义已确认即官方 `*x`（可选 splat）；`[...all]` 旧必填语义
  无对应形态，破坏性放宽记入 MIGRATION（008）。
