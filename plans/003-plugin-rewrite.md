# 003 — 插件层重写：`fileRouter` → `fileRoutes` 预设

Written against `d049326`. 依赖 002。产出：`src/plugin.ts` 变成薄预设，删除全部
自研扫描/抽取/类型生成/注册表/HMR 代码。

## 删除（整文件或整目录）

- `src/route/definition.ts`（706 行代码生成）
- `src/route/extract.ts`（Babel 抽取）
- `src/route/registry.ts`
- `src/route/plugin.ts`（自研 Vite 插件）
- `src/route/fs-provider.ts`、`src/route/type-gen.ts`
- `src/route/provider/`（contract/entry/index/manager/pages/watch）
- 对应测试：`tests/extract.test.ts`、`tests/registry.test.ts`、
  `tests/definition.test.ts`、`tests/plugin.test.ts`、`tests/route-type.test.ts`
  （007 按新架构重写，不在本计划内新建）

## 新 `fileRouter()`

```ts
// src/plugin.ts
import { fileRoutes } from 'filesystem-routing/vite'

export function fileRouter(options: FileRouterPluginOption = {}) {
  const router = resolveRouter(options) // 002：convention 适配器 → BaseFileSystemRouter
  return [
    fileRoutes({
      router,
      routers: options.routers,
      moduleId: options.moduleId ?? 'virtual:routes', // 保持旧虚拟模块名
      types: options.output ?? 'src/routes.d.ts', // 保持旧输出名
      buildInputs: options.ssg ? 'client' : undefined,
      codeSplitting: options.lazy === false ? false : undefined,
      optimizeDepsExclude: ['solid-file-router'],
    }),
    options.mdx ? createMdxPlugin(/* 006 */) : noopPlugin(),
    createSsgPlugin(options.ssg /* 005 */),
  ]
}
```

保留的兼容选项（重命名记录为破坏性变更）：

- `pagesDir` → 映射为 router `dir`（保留旧名或改 `dir`，二选一后写进迁移文档；
  建议保留 `pagesDir` 降低迁移成本，内部映射）。
- `ignore` → 官方 `BaseFileSystemRouter.glob()` 默认不带 ignore；
  `DefaultFileSystemRouter` 覆盖 `glob()` 追加 ignore globs（默认沿用
  `DEFAULT_IGNORES`：`**/components/**`、`**/node_modules/**`、`**/dist/**`）。
- `output` → 映射 `types`。
- `lazy` → `codeSplitting: false`（默认 true；官方 `codeSplitting: false` 需要
  `@solidjs/router > 2.0.0-next.14`，当前 next.44 满足）。
- `verboseLog` → 传 `logLevel` 类配置给官方插件（若无对应项则仅保留本包日志）。
- `mdx`、`ssg`、`router(s)`、`toPath`、`toRoute`、`convention` 见 002/005/006。

删除的选项：`reloadOnChange`（官方 HMR 已覆盖）、`infoDts`（改用
`declare module '@solidjs/router' { interface RouteInfo }`，文档给出示例）、
`inheritance`（编译期继承删除，语义由 004 运行时适配器接管）、`serverEntry`/
`renderTemplate`（005 重新定义）。

## 虚拟模块与类型

`moduleId: 'virtual:routes'` 保持 `virtual:routes` 导入不变；`types` 生成的
自包含 d.ts 取代 `client.d.ts` 的手写声明 → 删除 `client.d.ts` 中对
`virtual:routes` 的声明段（保留 `*.md`/`*.mdx` 声明并更新组件类型来源为
`solid-js`/`@solidjs/web`）。exports 的 `./client` 入口保留但内容精简。

package.json exports 不变（`.`、`/plugin`、`/mdx`、`./client`），
`/plugin` 产物里新增 `filesystem-routing` 为 external。

## `routeProviders`（CMS）处理

先实现 001#6 的结论：

- 若虚拟 `?pick=` 可行：提供 `defineRouteProvider` 兼容层——provider 的
  `load(context)` 产出模块源码挂到 `virtual:sfr/<hash>` id；自定义 `toRoute`
  返回 `{ $component: { src: <virtualId>, pick }, $$route: ... }`；插件
  `resolveId`/`load` 供源码；HMR 通过 router 的 `updateRoute/reload` 事件转发。
- 若不可行：provider `load()` 结果写入 `<root>/.sfr-cache/<id>.tsx` 临时文件
  （gitignore 提示），交给官方磁盘扫描；`sourcePath` 监视沿用 provider `watch`。
- 任一方案都收缩为内部实现细节，`RouteProvider` 公共接口
  （`glob`/`transformPath`/`load`/`watch`）尽量保留签名；文档标注实验性。

## 验证

```bash
pnpm typecheck
pnpm test -- tests/convention.test.ts   # 002 已存在
```

playground 验证留给 007。

## 边界

- 不实现运行时适配器（004）、SSG（005）、MDX（006）——本计划只留接口。
- 官方 `fileRoutes` 插件内部的 HMR/扫描行为不改写、不包装。
