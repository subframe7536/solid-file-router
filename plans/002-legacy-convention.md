# 002 — 依赖升级 + 内置约定 `DefaultFileSystemRouter` 与约定适配器

Written against `d049326`. 依赖 001 结论。产出：`src/route/convention.ts` 中
`DefaultFileSystemRouter`（`PageFileSystemRouter` 子类，承载本包文件名约定），
加约定适配器类型与内置适配器。不出现 "legacy" 命名。

## 包管理器迁移：bun → pnpm 12.6.0

- `package.json` 加 `"packageManager": "pnpm@12.6.0"`（配合 corepack；
  CI/本地统一）。
- 删除 `bun.lock`，`pnpm install` 生成 `pnpm-lock.yaml` 并提交。
- 删除 devDependency `bun-types`，`tsconfig.json` 的
  `"types": ["bun-types", "vite/client"]` 去掉 `bun-types`。
- 脚本无需改内部命令（scripts 不依赖 bun 特性）；所有文档/计划中的
  `bun run X` → `pnpm X`（`pnpm test -- ...`、`pnpm typecheck` 等）。
- 若有原生构建依赖被 pnpm 默认拦截，按需加 `pnpm.onlyBuiltDependencies`
  （当前依赖树预计无原生包，留作排障提示）。
- peer 依赖全部预发布版本时用精确/范围锁，pnpm 的严格 peer 校验
  失败时先检查版本声明而不是放宽 `.npmrc`。

## 依赖变更（package.json）

移除：`@babel/core`、`@solidjs/router`（旧 1.x peer）、`vite-plugin-solid`、
`tinyglobby`（官方包内部用 fast-glob）、`bun-types`。

新增 peerDependencies：

```jsonc
"peerDependencies": {
  "solid-js": "^2.0.0-rc.0",
  "@solidjs/web": "^2.0.0-rc.0",
  "@solidjs/router": "2.0.0-next.44",
  "filesystem-routing": "^0.5.0",
  "vite": "^8.1.5",
  "satteri": "^0.11.7",
  "yaml": "^2.9.1"
}
```

devDependencies（同时做全量升级）：

| 包                                           | 旧                  | 新                                  |
| -------------------------------------------- | ------------------- | ----------------------------------- |
| `solid-js` / `@solidjs/web`                  | `^1.9.14`           | `2.0.0-rc.21`（`next`）             |
| `@solidjs/router`                            | `^1.0.0`            | `2.0.0-next.44`                     |
| `filesystem-routing`                         | —                   | `0.5.0`                             |
| `vite-plugin-solid` → `@solidjs/vite-plugin` | `2.11.13`           | `3.0.0-next.35`                     |
| `vitest`                                     | `4.1.10`            | `5.1.0`                             |
| `tsdown`                                     | `0.22.14`           | `0.23.7`                            |
| `oxlint` / `oxfmt`                           | `1.75.0` / `0.60.0` | `1.93.0` / `0.78.0`                 |
| `jsdom`                                      | `30.0.1`            | `31.0.0`                            |
| `bumpp`                                      | `11.1.0`            | `12.3.0`                            |
| `@types/node`                                | `24.13.0`           | `26.6.6`                            |
| `@subf/config`                               | `0.2.1`             | `0.5.0`（检查 tsconfig 继承链兼容） |
| `satteri`                                    | `0.9.5`             | `0.11.7`（001#7 顺带验证新版）      |
| `yaml`                                       | `2.9.0`             | `2.9.1`                             |
| `typescript`                                 | `7.0.2`             | `7.0.2`（已最新）                   |
| `@solidjs/testing-library`                   | —                   | `@next`（007 需要时）               |

## 约定适配器模式（取代字符串 `convention` 选项）

约定即"生产 `BaseFileSystemRouter` 的适配器"，以值形式注入：

```ts
// src/route/convention.ts
export type FileRouterConvention = (config: {
  dir: string
  extensions: string[]
}) => BaseFileSystemRouter

// 内置适配器（命名不带 legacy）
export const defaultConvention: FileRouterConvention = (config) =>
  new DefaultFileSystemRouter(config)

export const solidStartConvention: FileRouterConvention = (config) =>
  new PageFileSystemRouter(config)

export const flatConvention: FileRouterConvention = (config) => new FlatFileSystemRouter(config)
```

用法：

```ts
fileRouter() // 默认 defaultConvention
fileRouter({ convention: solidStartConvention })
fileRouter({ convention: flatConvention })
fileRouter({ convention: (c) => new MyRouter(c) }) // 自定义
fileRouter({ router: myRouter }) // 完全自备实例（官方 router 选项直通）
fileRouter({ routers: { client: r1, ssr: r2 } }) // 分环境（官方 routers 选项直通）
```

- `convention` 与 `router`/`routers` 互斥（同时传则报错）。
- 不设字符串字面量选项；适配器就是函数/实例，与官方 `router`/`toPath`/
  `toRoute`/`FlatFileSystemRouter` 等接缝同构。

## `DefaultFileSystemRouter` 的 `toPath` 职责

输入：相对 pagesDir、已去扩展名的路由文件路径（参照 `cleanPath`）。
输出：中立路径（`:p`、`:p?`、`*rest`、`(group)`），`undefined` = 跳过。

统一前缀 `/(app)`：全体路由都产 `/(app)/...` 前缀，`_app.tsx` 自身产 `/(app)`。
无 `_app` 时组段被剥掉、无害；有 `_app` 时它成为全部路由的父 layout
（官方 `buildRouteTree` 前缀嵌套机制）。

| 旧文件                           | 中立路径                  | 说明                                      |
| -------------------------------- | ------------------------- | ----------------------------------------- |
| `_app.tsx`                       | `/(app)`                  | 根 layout                                 |
| `index.tsx`                      | `/(app)/`                 | 子路径 `/`                                |
| `about.tsx`                      | `/(app)/about`            |                                           |
| `blog/index.tsx`                 | `/(app)/blog/`            | 剥 `index` 留尾斜杠 → 嵌套为 `/blog` 的子 |
| `blog/_layout.tsx`               | `/(app)/blog`             | 与 `blog/` 下文件形成父子                 |
| `blog/[id].tsx`                  | `/(app)/blog/:id`         |                                           |
| `docs/-[lang]/index.tsx`         | `/(app)/docs/:lang?/`     | `-[x]` → `:x?`（旧可选参数）              |
| `blog/-[...all].tsx`             | `/(app)/blog/*all`        | 见「splat 语义」                          |
| `blog/[...all].tsx`              | `/(app)/blog/*all`        | 同上（记录行为差异）                      |
| `(auth)/login.tsx`               | `/(app)/(auth)/login`     | 组段保留，剥除后 `/login`                 |
| `account.settings.tsx`           | `/(app)/account/settings` | `.` 分段（先替换参数/splat 再按 `.` 拆）  |
| `404.tsx`                        | `/(app)/*404`             | router 2 not-found 通配                   |
| `nest/_layout.tsx` 等 `_` 私有段 | 见下                      |                                           |
| `components/x.tsx`、`_foo.tsx`   | `undefined`               | `_` 开头段跳过（除 `_app`/`_layout`）     |

实现要点（参照旧 `src/route/path.ts` 的 `getRoutePath`，原样保留语义）：

1. 先判断 `_app`/`404`/`_layout`/`_` 私有段（basename 正则同旧
   `REG_APP`/`REG_LAYOUT`/`REG_NOT_FOUND`）。
2. splat `[...x]` → `*x`、`-[...x]` → `*x`（顺序先于 `.` 拆分，否则
   `...` 会被当成分段点）。
3. `[x]` → `:x`、`-[x]` → `:x?`。
4. 逐段按 `.` 拆、`(group)` 段与 `index`/`_layout` 剔除逻辑对齐旧版。

**splat 语义差异**：旧 `-[...all]` 是「可选 splat」、旧 `[...all]` 必填一段；
官方 `*x` 是否匹配空尾由 router 2 决定（001 验证）。把差异写进
`docs/` 迁移章节；不要为兼容发明 `*x?`（中立语言无此形态）。

`toRoute`：不覆盖官方默认（默认 `toRoute` 已处理 default/route/httpMethods
导出分析）。`.md`/`.mdx` 的特判在 006 中通过 `toRoute` 包装处理。

## 文件

新建 `src/route/convention.ts`（`DefaultFileSystemRouter` +
`routePathFromFile` + `FileRouterConvention` 类型 + 三个内置适配器）。
删除 `src/route/path.ts`（其逻辑进 convention；`patterns` 常量随之删除）。

## 测试

新建 `tests/convention.test.ts`：纯字符串输入输出表驱动，覆盖上表每一行 +
私有段/嵌套 `_layout`/根 `_layout`（`src/pages/_layout.tsx` → `/(app)`？
注意：旧语义根 `_layout` 等价 `_app`——直接映射 `/(app)`，同 `_app` 冲突时
以后者为准，记录文档）。

运行：`pnpm test -- tests/convention.test.ts`，再 `pnpm typecheck`。

## 边界

- 不动 `src/index.ts`、`src/plugin.ts` 其余部分（003 处理）。
- 不改路由模块写法约定（`export const route` + default 组件由 004 文档化）。
- 不做 `infoDts`/`generatePath` 兼容垫片——破坏性删除随 004 文档记录。
