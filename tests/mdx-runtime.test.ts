import { resolve } from 'node:path'

import { renderToString } from '@solidjs/web'
// @ts-expect-error jsdom does not ship TypeScript declarations
import { JSDOM } from 'jsdom'
import { build } from 'vite'
import type { InlineConfig, Plugin } from 'vite'
import { describe, expect, it } from 'vitest'

import { createMdxPlugin } from '../src/mdx/plugin'
import { jsx, jsxDEV, jsxs } from '../src/mdx/runtime'

const mdxEntryPath = resolve(import.meta.dirname, '../src/mdx/index.ts')
const virtualMdxPath = resolve(import.meta.dirname, '__virtual_mdx_runtime_fixture__.mdx')
const virtualSsrEntryPath = resolve(import.meta.dirname, '__virtual_mdx_ssr_entry__.js')
const virtualEntryPath = resolve(import.meta.dirname, '__virtual_mdx_client_entry__.js')

const mdxAlias = [
  {
    find: /^solid-file-router\/mdx(?:\/jsx-(?:dev-)?runtime)?$/,
    replacement: mdxEntryPath,
  },
]

const mdxSource = `import { Dynamic } from '@solidjs/web'

export function Inner(props) {
  return <span data-inner={props.label}>inner:{props.label}</span>
}

export function MyComp(props) {
  return (
    <div data-mycomp="true" data-same-ref={String(props.component === Inner)}>
      <Dynamic component={props.component} label={props.label} />
    </div>
  )
}

# Title

<MyComp component={Inner} label="from-mycomp" />

<ProvidedComp component={Inner} label="from-provider" />

<Dynamic component={Inner} label="from-dynamic" />

<article data-intrinsic="ok">plain article</article>
`

function virtualModulePlugin(modules: Record<string, string>): Plugin {
  return {
    name: 'virtual-mdx-test-modules',
    enforce: 'pre',
    resolveId(id) {
      if (id in modules) {
        return id
      }
    },
    load(id) {
      if (id in modules) {
        return modules[id]
      }
    },
  }
}

async function bundleVirtualEntry(
  entryPath: string,
  entryCode: string,
  extraConfig: Pick<InlineConfig, 'ssr' | 'build'>,
): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    resolve: { alias: mdxAlias },
    plugins: [
      virtualModulePlugin({
        [virtualMdxPath]: mdxSource,
        [entryPath]: entryCode,
      }),
      createMdxPlugin({}),
    ],
    ...extraConfig,
  })

  const buildOutput = Array.isArray(result) ? result[0]! : result
  const outputChunk = 'output' in buildOutput ? buildOutput.output[0] : undefined
  return outputChunk && 'code' in outputChunk ? outputChunk.code : ''
}

describe('mDX automatic JSX runtime', () => {
  it('passes props directly to function components without overwriting component or evaluating getters', () => {
    const Inner = (props: { label: string }): string => props.label
    let receivedProps: Record<string, unknown> | undefined
    let getterEvaluated = false

    const MyComp = (props: Record<string, unknown>): string => {
      receivedProps = props
      return 'ok'
    }

    const inputProps = {
      component: Inner,
      get lazyValue() {
        getterEvaluated = true
        return 'lazy'
      },
    }

    expect(jsx(MyComp, inputProps)).toBe('ok')
    expect(receivedProps).toBe(inputProps)
    expect(receivedProps?.component).toBe(Inner)
    expect(getterEvaluated).toBe(false)

    // jsxs and jsxDEV alias the same runtime helper
    expect(jsxs).toBe(jsx)
    expect(jsxDEV).toBe(jsx)
  })

  it('routes non-function intrinsic elements through Dynamic in SSR', () => {
    const html = renderToString(() => jsx('article', { 'data-intrinsic': 'ok', children: 'hello' }))
    expect(html).toContain('<article')
    expect(html).toContain('data-intrinsic="ok"')
    expect(html).toContain('hello</article>')
  })

  it('preserves component prop for custom components and Dynamic in SSR', async () => {
    const ssrEntryCode = `
import { Dynamic, isServer, renderToString } from '@solidjs/web'
import { createComponent } from 'solid-js'
import MDXContent, { Inner } from ${JSON.stringify(virtualMdxPath)}

export function renderSsrFixture() {
  let providedReceivedSameRef = false
  function ProvidedComp(props) {
    providedReceivedSameRef = props.component === Inner
    return createComponent(Dynamic, {
      get component() {
        return props.component
      },
      get label() {
        return props.label
      },
    })
  }

  const html = renderToString(() =>
    createComponent(MDXContent, {
      components: { ProvidedComp },
    }),
  )

  return { isServer, providedReceivedSameRef, html }
}
`
    const bundledCode = await bundleVirtualEntry(virtualSsrEntryPath, ssrEntryCode, {
      ssr: { noExternal: true },
      build: {
        ssr: virtualSsrEntryPath,
        write: false,
        minify: false,
        rolldownOptions: {
          output: { format: 'es', codeSplitting: false },
        },
      },
    })
    expect(bundledCode).not.toBe('')

    const mod = (await import(
      `data:text/javascript;base64,${Buffer.from(bundledCode).toString('base64')}`
    )) as {
      renderSsrFixture: () => { isServer: boolean; providedReceivedSameRef: boolean; html: string }
    }
    const { isServer, providedReceivedSameRef, html } = mod.renderSsrFixture()

    expect(isServer).toBe(true)
    expect(providedReceivedSameRef).toBe(true)
    expect(html).toMatch(/<h1[^>]*>Title<\/h1>/)
    expect(html).toContain('data-mycomp="true"')
    expect(html).toContain('data-same-ref="true"')
    expect(html).toContain('data-inner="from-mycomp"')
    expect(html).toContain('inner:from-mycomp')
    expect(html).toContain('data-inner="from-provider"')
    expect(html).toContain('inner:from-provider')
    expect(html).toContain('data-inner="from-dynamic"')
    expect(html).toContain('inner:from-dynamic')
    expect(html).toMatch(/<article[^>]*data-intrinsic="ok"[^>]*>plain article<\/article>/)
  })

  it('preserves component prop for custom components and Dynamic on the client', async () => {
    const entryCode = `
import { Dynamic, isServer, render } from '@solidjs/web'
import { createComponent } from 'solid-js'
import MDXContent, { Inner } from ${JSON.stringify(virtualMdxPath)}

let providedReceivedSameRef = false
function ProvidedComp(props) {
  providedReceivedSameRef = props.component === Inner
  return createComponent(Dynamic, {
    get component() {
      return props.component
    },
    get label() {
      return props.label
    },
  })
}

const root = document.getElementById('app')
render(() => createComponent(MDXContent, { components: { ProvidedComp } }), root)
window.__testResult = {
  isServer,
  providedReceivedSameRef,
  h1: root.querySelector('h1')?.textContent,
  myCompSameRef: root.querySelector('[data-mycomp="true"]')?.getAttribute('data-same-ref'),
  myCompInner: root.querySelector('[data-mycomp="true"] [data-inner="from-mycomp"]')?.textContent,
  providerInner: root.querySelector('[data-inner="from-provider"]')?.textContent,
  dynamicInner: root.querySelector('[data-inner="from-dynamic"]')?.textContent,
  article: root.querySelector('article[data-intrinsic="ok"]')?.textContent,
}
`

    const bundledCode = await bundleVirtualEntry(virtualEntryPath, entryCode, {
      build: {
        write: false,
        minify: false,
        lib: {
          entry: virtualEntryPath,
          formats: ['iife'],
          name: 'MdxClientTest',
        },
      },
    })
    expect(bundledCode).not.toBe('')

    const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
      runScripts: 'dangerously',
    })
    dom.window.eval(bundledCode)

    const testResult = (dom.window as unknown as { __testResult: Record<string, unknown> })
      .__testResult
    expect(testResult.isServer).toBe(false)
    expect(testResult.providedReceivedSameRef).toBe(true)
    expect(testResult.h1).toBe('Title')
    expect(testResult.myCompSameRef).toBe('true')
    expect(testResult.myCompInner).toBe('inner:from-mycomp')
    expect(testResult.providerInner).toBe('inner:from-provider')
    expect(testResult.dynamicInner).toBe('inner:from-dynamic')
    expect(testResult.article).toBe('plain article')
  })
})
