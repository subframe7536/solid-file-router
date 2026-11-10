# 007 — 测试 / playground / 文档 全量改写

Written against `d049326`. 依赖 004–006。产出：与新架构一致的可交付状态。

## 测试重构

删除：`tests/extract.test.ts`、`registry.test.ts`、`definition.test.ts`、
`plugin.test.ts`、`route-type.test.ts`、`runtime.test.ts`、`generatePath.test.ts`
（其覆盖的行为已移交官方包）。

保留/新增：

| 文件                                   | 覆盖                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `tests/convention.test.ts`（002 新建） | 旧文件名→中立路径全表                                                                                              |
| `tests/adapter.test.ts`（004 新建）    | 继承链、Errored/Loading 包装、draft 过滤、metadata 收集                                                            |
| `tests/mdx-frontmatter.test.ts`        | frontmatter 解析（基本不变）                                                                                       |
| `tests/mdx-module.test.ts`（006 新建） | 生成模块含 `route` 导出                                                                                            |
| `tests/ssg.test.ts`（005 新建）        | 文件名映射、并发、404、非法路径                                                                                    |
| `tests/integration.test.ts`（新）      | 小型 Vite fixture：`fileRouter()` + 最小 pages → `vite build` 产出断言（可选，成本高时可并入 playground 构建验证） |

测试基建：`@solidjs/testing-library@next`（如需 DOM 断言）；组件级测试注意
Solid 2 批量写入——setter 后 `flush()` 再断言。

## playground 迁移

- `vite.config.ts`：`solidPlugin` → `import solid from '@solidjs/vite-plugin'`，
  `extensions: ['.jsx', '.tsx', '.mdx']`；`fileRouter({ mdx: true, ssg })`。
- `vite.ssg.config.ts`：`solid({ start: true, ssr: true })` + `ssg: {}`。
- `src/pages/*`：全部改为 `export const route = {...}` + `export default` 组件；
  `_app.tsx` 仅保留 component 与默认 loading/error；`data.tsx` 的
  `onMount` → `onSettled`；`404.tsx` 不变（convention 映射）。
- `index.tsx`：`createFileRouter()` 返回实例 → `render(() => <Router>{…}</Router>)`；
  `entry-server.tsx` 删除（start 模式）。
- `routes.d.ts` 改由 `fileRoutes({ types })` 生成，保留 gitignore/生成策略不变。
- `head-assets*.tsx`：改为 `useHead`/`@solidjs/meta` 组件写法。

## 文档改写

| 文件                                          | 变化                                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| `README.md`                                   | 定位改为「Solid 2 官方文件路由之上的约定预设」；安装命令、quickstart 全改    |
| `docs/guide.md`                               | 路由文件写法、`<a>`/`paths` 导航、`RouteInfo` 增强、`_app`/render-prop       |
| `docs/reference.md`                           | 新 `fileRouter` 选项表、`createFileRouter`、`defineRoute`、删除 API 清单     |
| `docs/ssg.md`                                 | start 模式前提、新 `ssg` 选项、删除模板/marker 约定                          |
| `docs/mdx.md`                                 | `route` 导出约定、`extendLoad`、frontmatter                                  |
| `docs/agents.md`/`docs/AGENTS.md`/`AGENTS.md` | 架构图、`virtual:routes` 新含义、不变式清单按官方机制重写；命令全部 bun→pnpm |

迁移文档（`MIGRATION.md`）与 v1.0.0 发布流程独立成计划 008。

## 验证基线（全部计划通用）

```bash
pnpm typecheck && pnpm test && pnpm lint
pnpm play:build        # SPA 构建
pnpm play:ssg:build    # SSG 端到端
```

## 边界

- 官方栈内部行为（`?pick=`、tree 构建、types 生成）不重测，交给上游。
- `routeProviders` 公共文档在 003 落定可行性后再补。
