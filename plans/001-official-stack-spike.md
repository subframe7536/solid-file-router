# 001 — 官方栈验证性样例（spike）

Written against `d049326`. 只做验证，不改动本仓库源码；产出是一个 `/tmp` 下的可
运行样例 + 一份「可行/不可行」清单。若任一项失败，先在此记录替代方案再推进 002。

## 背景

本包将迁移到：solid-js 2 RC + `@solidjs/router@next` + `filesystem-routing` +
`@solidjs/vite-plugin`（原 vite-plugin-solid）。下列假设影响架构，必须先验证。

## 待验证项

1. **最小可用链路**：`filesystem-routing/vite` 的 `fileRoutes()` +
   `@solidjs/router/fs` 的 `fileRoutes(pageRoutes)` + `createRouter` 在
   `@solidjs/vite-plugin` 下编译、渲染、`paths` 类型推导有效。
2. **`?pick=` 与 solid 插件**：`solid({ extensions: [".jsx", ".tsx"] })` 是否
   为必需；`.mdx?pick=route` 是否同样能被本包 transform 命中（正则
   `/\.(md|mdx)(\?.*)?$/`）。
3. **`toPath` 自定义**：`PageFileSystemRouter` 子类或 `fileRoutes({ toPath })`
   能否输出 `/(app)` 组段，使全体路由嵌套到 `_app`；`/(app)/index` 剥组后
   path 是否为 `/`。
4. **catch-all**：中立路径 `*404` 在 router 2 中是否作 not-found 通配；
   `*all` 是否匹配其父路径空尾（旧 `-[...all]` 语义）。
5. **`.mdx` 的 `route` 导出**：自定义 `toRoute` 返回
   `$$route: { src, pick: ["route"] }` 时，`src?pick=route` 经过
   「satteri 编译 transform（pre）→ fs tree-shake」后得到 `route` 常量。
6. **虚拟 src 的 `?pick=`**：自定义 `toRoute` 返回
   `$component: { src: "virtual:sfr-x", pick: ["default"] }`，本包 resolveId/load
   供给源码后，tree-shake 是否仍按 pick 收窄（CMS 可行性）。
7. **satteri 0.9.5 → Solid 2**：`mdxToJs` 产物能否被 `@solidjs/vite-plugin`
   （Solid 2 编译器）正常编译渲染。
8. **Vite 8**：`filesystem-routing` peer 声明 `^6||^7||^8`，本仓库现为 Vite 8 —
   确认无 peer 告警外的运行时问题（Vite 9 暂不支持）。
9. **SSR/预渲染入口**：`solid({ start: true, ssr: true })` 构建后
   `dist/server/server.js` 的 `handleRequest(request)` 是否可独立调用，
   输出含 `useHead` 注入的 head 标签。

## 步骤

```bash
mkdir -p /tmp/sfr-spike && cd /tmp/sfr-spike
npm init -y
npm i solid-js@next @solidjs/web@next @solidjs/router@next filesystem-routing@0.5.0
npm i -D vite@^8 @solidjs/vite-plugin@next satteri@^0.9.5 typescript
```

`vite.config.ts`：

```ts
import { resolve } from 'node:path'

import solid from '@solidjs/vite-plugin'
import { PageFileSystemRouter } from 'filesystem-routing'
import { fileRoutes } from 'filesystem-routing/vite'
import { defineConfig } from 'vite'

class AppRouter extends PageFileSystemRouter {
  toPath(src) {
    const file = src.slice(this.config.dir.length).replace(/\.[jt]sx?$/, '')
    // 最小验证版：index/参数/组/app 前缀
    if (file === '/_app') return '/(app)'
    const p = file
      .replace(/\/_layout$/, '')
      .replace(/(^|\/)index$/, '$1/')
      .replace(/\[([^\]]+)\]/g, ':$1')
      .replace(/\.\.\./g, '')
    return `/(app)${p}`
  }
}

export default defineConfig({
  plugins: [
    solid({ extensions: ['.jsx', '.tsx', '.mdx'] }),
    fileRoutes({
      router: new AppRouter({ dir: resolve('src/pages'), extensions: ['tsx', 'mdx'] }),
      types: 'src/routes.d.ts',
    }),
  ],
})
```

`src/pages`：`index.tsx`、`about.tsx`、`blog/[id].tsx`、`404.tsx`、`_app.tsx`、
`blog/_layout.tsx`、`post.mdx`。入口 `src/index.tsx`：

```tsx
import { createRouter } from '@solidjs/router'
import { fileRoutes } from '@solidjs/router/fs'
import { render } from '@solidjs/web'
import { pageRoutes } from 'virtual:file-routes'

const Router = createRouter({ routes: fileRoutes(pageRoutes) })
render(() => <Router>{(props) => <>{props.children}</>}</Router>, document.getElementById('root')!)
```

按 `fileRoutes({ types })` 生成的 `src/routes.d.ts` 引用后检查
`Router.paths` 推导。

## 验证命令与期望

| 检查      | 命令                                           | 期望                                                           |
| --------- | ---------------------------------------------- | -------------------------------------------------------------- |
| dev 渲染  | `vite dev` + curl / 浏览器                     | `/`、`/about`、`/blog/1`、未知路径 → 404                       |
| 类型      | `tsc --noEmit`                                 | `paths.blog('1')` 通过、`paths.nope` 报错                      |
| MDX       | 访问 `/post`                                   | satteri 产物渲染；`?pick=route` 模块可见 route 导出            |
| 构建      | `vite build`                                   | 路由分包 chunk 产出                                            |
| SSR       | `solid({start:true, ssr:true})` + `vite build` | `dist/server/server.js` 的 `handleRequest` 返回带 head 的 HTML |
| 虚拟 pick | 自定义 `toRoute` + resolveId/load              | pick 收窄生效，无 resolve 错误                                 |

## 产出

- `/tmp/sfr-spike` 保留；把每项验证结果记录到 `plans/README.md` 的
  「遗留决策/风险」节（修订该文件）。
- 若 6（虚拟 `?pick=`）失败：003 中 `routeProviders` 降级为「生成
  `.sfr-cache/` 临时文件再交给官方扫描器」方案。
- 若 7 失败：升级或替换 satteri（评估 `@mdx-js/mdx` + Solid JSX runtime）。

## 边界

- 不修改本仓库任何文件（`plans/` 记录除外）。
- 不提交 /tmp 代码到仓库。
