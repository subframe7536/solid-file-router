# 008 — 迁移文档 + v1.0.0 发布

Written against `d049326`。依赖 002–007 全部完成。产出：`MIGRATION.md`、
版本号升级与发布流程。这是 v0.7.3 → v1.0.0 的破坏性发布，迁移文档是交付物
的一部分，不是附属说明。

## `MIGRATION.md`（仓库根，与 README 互链）

结构：先「30 秒概览」，再按用户工程文件逐项给 before/after，最后完整
删除/替换 API 对照表。所有示例用迁移后的真实 API（002–006 落定后的实现
为准，文档与实际代码不一致时以代码为准并回改文档）。

### 1. 依赖与配置

```diff
- "solid-file-router": "^0.7.3", "solid-js": "^1.9.x",
- "@solidjs/router": "^1.0.0",
- devDeps: "vite-plugin-solid"
+ "solid-file-router": "^1.0.0", "solid-js": "2.0.0-rc.x",
+ "@solidjs/web": "2.0.0-rc.x", "@solidjs/router": "2.0.0-next.x",
+ devDeps: "@solidjs/vite-plugin"
```

```ts
// vite.config.ts before → after
- import solidPlugin from 'vite-plugin-solid'
- plugins: [solidPlugin(), fileRouter({ infoDts, inheritance })]
+ import solid from '@solidjs/vite-plugin'
+ plugins: [solid({ extensions: ['.jsx', '.tsx', '.mdx'] }),
+   fileRouter({ convention: defaultConvention /* 可省略 */ })]
```

### 2. 路由模块写法（最大变更）

```diff
// src/pages/about.tsx
- import { createRoute } from 'solid-file-router'
- export default createRoute({
-   component: () => <h1>About</h1>,
-   info, preload, loadingComponent, errorComponent, metadata, draft, inherit,
- })
+ import type { RouteConfig } from 'solid-file-router' // 或 @solidjs/router/fs 的 defineFileRoute
+ export const route = { info, preload, loadingComponent, errorComponent,
+   metadata, draft, inherit } satisfies RouteConfig
+ export default function About() { return <h1>About</h1> }
```

要点说明：

- `component` 从 config 中移出成为默认导出；顶层 spread 限制消失
  （不再有 AST 抽取）。
- `export const route` 为可选；纯组件文件不写它。
- 需要 params/preload 返回类型时用 `defineFileRoute(pattern, config)`
  （pattern 是类型见证，运行时以文件名为准）。

### 3. 入口与挂载

```diff
- import { render } from 'solid-js/web'
- import { FileRouter } from 'virtual:routes'
- render(() => <FileRouter />, el)
+ import { render } from '@solidjs/web'
+ import { Router } from './router'   // 或 createFileRouter()
+ render(() => <Router>{(p) => <>{p.children}</>}</Router>, el)
```

```ts
// src/router.tsx（新约定，推荐集中导出）
import { createFileRouter } from 'solid-file-router'
export const Router = createFileRouter()
export const { paths } = Router
```

- `createClientEntry`/`createServerEntry` 删除 → start 模式
  `solid({ start: true })`（SPA）/ `ssr: true`（SSR）。
- `virtual:routes` 名字保留，但导出内容变化：`pageRoutes`/默认 manifest，
  不再有 `FileRouter`/`Root`/`fileRoutes`（路由树由 `createFileRouter` 组装）。
  `client.d.ts` 的手写声明改由 `fileRoutes({ types })` 生成的 `routes.d.ts` 替代；
  `tsconfig.types` 中 `solid-file-router/client` 改为引用生成文件。

### 4. 导航与数据

| 旧                                        | 新                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| `<A href>`                                | `<a href>`（router 委托拦截）                                                               |
| `generatePath('/blog/:id', { $id: '1' })` | `paths.blog('1')` / `paths()`                                                               |
| `useNavigate()` 参数类型                  | `paths` 节点（无 `$`/`'*'` 键对象）                                                         |
| `readRouteInfo(useCurrentMatches())`      | `useRouteMatches()` + `route.info`                                                          |
| `infoDts` 插件选项                        | `declare module '@solidjs/router' { interface RouteInfo { name?: string; role?: string } }` |
| `useCurrentMatches`                       | `useRouteMatches`                                                                           |
| `redirect`/`reload`（router）             | `@solidjs/web` 同名导出                                                                     |

### 5. 文件名约定（默认不变）

默认 `DefaultFileSystemRouter` 保持全部旧规则：`_app`/`_layout`/`404`/
`-[lang]`/`-[...all]`/`(group)`/`.` 分段/`_` 私有/`index`。逐条列出映射
（即 002 表格），并标注两处差异：

- `*x` splat 在 router 2 下的空尾匹配行为（001 实测结论，可能与旧可选
  splat 有出入）。
- `_app` 通过 `(app)` 组段嵌套实现，与手写 `/(app)/...` 文件的潜在冲突
  （文档约定：用户不应自己使用 `(app)` 组名——或改内部名 `__sfr_app`）。

换约定：`convention: solidStartConvention | flatConvention | 自定义`；
自定义写 `FileRouterConvention` 工厂或 `toPath`/`toRoute` 覆盖。

### 6. loading/error/metadata/draft

- `loadingComponent`/`errorComponent`/`inherit`/`draft` 语义不变，
  实现从编译期注入改为 `createFileRouter` 运行时适配——文档只需说明行为
  不变 + `inheritance` 全局插件选项删除（替代：删掉组件或写
  `inherit: false`）。
- `metadata` 声明式对象不变；底层 `useHead`，新增可选项：直接在组件里
  写 `<Title>`/`<Meta>`（`@solidjs/meta`）作为更强表达。
- `routeInfo`/`routeMetadata` manifest 仍可从 `createFileRouter` 返回值拿
  （若 004 实现保留），否则改读 `useRouteMatches`/`route.info`。

### 7. SSG

```diff
- fileRouter({ ssg: { serverEntry, id, routes, concurrency } }) + solidPlugin({ ssr: true })
- index.html 内 <!--solid-file-router-outlet--> / <!--solid-file-router-head-->
+ solid({ start: true, ssr: true }) + fileRouter({ ssg: { routes, concurrency } })
```

- `serverEntry`/`id`/`renderTemplate`/两个 HTML marker 全部删除；
  head 由 `useHead` 接管，模板即 `Document`（start 模式）。
- 输出规则不变：`/`→`index.html`、`/x`→`x.html`、必发 `404.html`、
  preview 404 回退保留。

### 8. MDX

- `fileRouter({ mdx: true })` 保留；页面模块内部变化（`route` 导出）
  对用户透明，但**直接消费生成模块的代码**（如 `import route from
  './x.mdx'`）需按新形态改。
- `MDXProvider`/`useMDXComponents` API 不变。

### 9. 完整删除/替换 API 对照表

| 删除                                                                   | 替代                                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------ |
| `createRoute`, `RouteConfig`                                           | `export const route` + `defineRoute`/`defineFileRoute` |
| `FileRouter`, `Root`, `fileRoutes`（virtual:routes 旧导出）            | `createFileRouter()`                                   |
| `createClientEntry`, `createServerEntry`                               | `solid({ start })`                                     |
| `generatePath`, `FileRoutePath`                                        | `Router.paths`                                         |
| `readRouteInfo`, `FileRouteInfoMap`, `FileRouteMetadataMap`, `infoDts` | `useRouteMatches` + `RouteInfo` 增强                   |
| `RouteMetadataManager`, `__routeMetadataRoot__`, `__loader__`          | `useHead` + 适配器内部实现                             |
| `renderTemplate`, `ID_PRERENDER`                                       | start handler                                          |
| `reloadOnChange`, `inheritance` 选项                                   | 官方 HMR / `inherit`                                   |
| `routeProviders`（若 003 降级/变化）                                   | 按 003 结论写                                          |
| `lazy` 选项语义                                                        | `codeSplitting`（语义反转，注意迁移）                  |

## 发布步骤

1. 全部计划完成、`pnpm typecheck && pnpm test && pnpm lint` 绿、
   `play:build` + `play:ssg:build` 通过。
2. `MIGRATION.md`、`README.md`、`docs/*` 与实现核对（docs/agents.md 的
   校验顺序：源类型→默认行为→测试→playground→散文）。
3. `package.json`：`version: 1.0.0`，peerDependencies 与 002 最终版本一致；
   `README` 顶部的 pre-1.0 警告改为 Solid 2 RC 前置条件说明。
4. `pnpm release`（build → qa → test → bumpp）或手动按仓库发布惯例。
5. GitHub Release notes：链 `MIGRATION.md`，标注所有官方依赖为
   prerelease（`solid-js@next` 等），提示锁版本。

## 边界

- 迁移文档只写「怎么迁」，不重复 docs/ 里的用法细节。
- 若某项功能（routeProviders、splat 可选语义）在 002–006 未落定，
  文档如实标注「实验性/有差异」，不补垫片 API。
