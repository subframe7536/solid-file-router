# 004 — 运行时适配器：`createFileRouter` / 继承 / metadata→useHead / draft

Written against `d049326`. 依赖 003。产出：`src/index.ts` 全新公共运行时，
删除 `__loader__`/`generatePath`/`readRouteInfo`/`createClientEntry`/
`createServerEntry`/`__routeMetadataRoot__`/`RouteMetadataManager`/`metadata-shared.ts`。

## 路由模块新写法（破坏性变更，文档重点）

```tsx
// 旧
export default createRoute({ component: Page, info, preload, loadingComponent })

// 新：官方约定，config 为普通对象（不再需要 AST 抽取，spread 自由）
export const route = {
  info,
  preload,
  matchFilters, // @solidjs/router 原生键
  loadingComponent,
  errorComponent,
  inherit,
  metadata,
  draft, // sfr 扩展键
} satisfies FileRouteConfig
export default Page

// 需要 params/data 类型时
import { defineFileRoute } from '@solidjs/router/fs'
export const route = defineFileRoute('/blog/:id', {
  matchFilters: { id: int },
  preload: ({ params }) => getPost(params.id),
})
```

`sfr` 扩展键由 `$$route` 静态 ref 拾取并随 `...config` spread 进入路由定义，
运行时适配器统一消费。提供 `defineRoute`（薄封装：类型上扩展
`FileRouteConfig` 加入 sfr 键，运行时 identity）。

## `createFileRouter`

```ts
// src/index.ts
import { createRouter } from '@solidjs/router'
import { fileRoutes } from '@solidjs/router/fs'
import { pageRoutes } from 'virtual:routes'

export function createFileRouter(options?: {
  routes?: typeof pageRoutes // 注入，便于测试/自定义 moduleId
  router?: Parameters<typeof createRouter>[0] // base/preloadLinks 等透传
}) {
  const entries = options?.routes ?? pageRoutes
  return createRouter({
    routes: adaptFileRoutes(fileRoutes(entries)),
    ...options?.router,
  })
}
```

`adaptFileRoutes(routes)` 深度优先遍历嵌套 `FileRouteFrom` 树，完成四件事：

1. **继承的 loading/error**：沿树向下携带 `{ loading, error }` 上下文；
   每层 route 的 `route.loadingComponent`/`errorComponent` 覆盖上下文，
   `route.inherit === false | {loading:false,error:false}` 阻断对应继承
   （语义与旧 `inheritance` 一致，但 `inheritance` 全局插件选项删除——
   需要禁用继承的用户移除组件即可；文档注明）。
2. **包装 component**：`Loading`/`Errored`（solid-js 2 边界）按
   `Errored → Loading → Comp` 顺序包裹；无边界时原样返回（零开销）。
   旧 `__loader__` 的「无 errorComponent 时 DEV console.error」行为保留。
3. **metadata**：route `metadata`（`RouteMetadata` 旧类型保留：
   `title/description/canonical/meta[]/links[]`）在组件包裹层转 `useHead`
   注册——`<Errored>` 外层注册、失败路径不污染 head；
   后渲染的内层后注册、自然覆盖（useHead 「后到者赢」语义即旧
   「最深 match 生效」）。SSR 自动拼接 head，SSG/客户端导航天然生效。
4. **draft**：`import.meta.env.DEV` 为真时全保留；否则过滤
   `route.draft === true` 的节点，且祖先 draft 使子树整体消失
   （旧 `__filterDraftRoutes` 语义；`routeInfo`/`routeMetadata` manifest
   与 draft 联动过滤）。

返回值额外导出：`fileRoutes`（适配后树）、`routeInfo`、
`routeMetadata`（由适配层收集，`Record<path, info|metadata>`，键为剥组后
path——与旧行为一致）。

## 与 `_app` 的关系

`_app.tsx`/`/(app)` 组节点是真实 route entry：其 `route` config 的
loading/error/metadata 作为全体默认值（继承上下文起点），component 作根
layout。`<Router>` render-prop 只放应用级 providers，不再承载 layout 默认值。

## 删除/替换清单

| 删除                                                                      | 替代                                                       |
| ------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `createRoute`/`RouteConfig`                                               | `route` 对象约定 + `defineRoute`                           |
| `generatePath`                                                            | `Router.paths`（官方类型化代理）                           |
| `readRouteInfo`                                                           | `useRouteMatches()` + `route.info`（`RouteInfo` 模块增强） |
| `FileRoutePath`/`FileRouteInfo`/`FileRouteInfoMap`/`FileRouteMetadataMap` | 官方生成 d.ts + `RouteInfo` 增强                           |
| `createClientEntry`/`createServerEntry`                                   | start 模式生成入口 / 用户自写 `render()`                   |
| `FileRouter`/`Root`/`fileRoutes`（virtual:routes 旧导出）                 | `createFileRouter` 返回实例                                |
| `RouteMetadataManager`/`metadata-shared.ts`                               | `useHead`                                                  |
| `__routeMetadataRoot__`/`__loader__`                                      | `adaptFileRoutes`                                          |

保留：`RouteMetadata`/`RouteMetaTag`/`RouteMetadataLink` 类型（metadata 输入
形状不变），`ErrorComponentProps`（`error`/`reset`）。

## Solid 2 API 注意

- `Loading`/`Errored` 从 `solid-js` 导入；`Dynamic`/`lazy` 在 `@solidjs/web`。
- 不调用 `createComponent` 手写 props 代理——直接用 JSX 或组件函数（适配器在
  用户组件树外，写法无限制，但以组件函数返回 JSX 为宜）。
- `merge`（非 `mergeProps`）如需合并 props；`undefined` 现在显式覆盖。
- draft 过滤在 `createFileRouter` 调用时静态求值（`import.meta.env.DEV`），
  构建时被 rolldown 折叠，不产生运行时成本。

## 验证

`tests/adapter.test.ts`（新建）：手工构造 `FileRouteFrom` 嵌套树 →
`adaptFileRoutes` 输出断言：组件包装层数、继承链、draft 过滤、
metadata 收集 map。`pnpm test -- tests/adapter.test.ts` + typecheck。

## 边界

- 不动 satteri/`client.d.ts` 的 mdx 段（006）。
- `routeProviders` 公共 API 不动（003）。
- `RouteSectionProps` 等类型直接 re-export 自 `@solidjs/router`，不重新定义。
