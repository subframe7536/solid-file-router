import type { JSX } from '@solidjs/web'
import { Dynamic } from '@solidjs/web'
import { createComponent, createContext, merge, useContext } from 'solid-js'
import type { Component, ParentProps } from 'solid-js'

/** A component that can override an MDX element or component. */
export type MDXComponent<Props = Record<string, unknown>> = (props: Props) => JSX.Element
/** Component overrides supplied to `MDXProvider` or `useMDXComponents`. */
export type MDXComponents = {
  [Name in keyof JSX.IntrinsicElements]?: MDXComponent<JSX.IntrinsicElements[Name]>
} & {
  [name: string]: MDXComponent<never> | undefined
  wrapper?: MDXComponent<ParentProps>
}

const intrinsicNames = [
  'a',
  'aside',
  'blockquote',
  'br',
  'code',
  'del',
  'details',
  'div',
  'em',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'img',
  'input',
  'kbd',
  'li',
  'mark',
  'ol',
  'p',
  'pre',
  'section',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
  'video',
] as const

const intrinsicComponents = Object.fromEntries(
  intrinsicNames.map((name) => [
    name,
    (rawProps: Record<string, unknown>) =>
      createComponent(
        Dynamic as Component<Record<string, unknown>>,
        merge(rawProps, { component: name }),
      ),
  ]),
) as MDXComponents

const MDXContext = createContext<MDXComponents>(intrinsicComponents)

/** Provides runtime component overrides to descendants rendered from MDX. */
export function MDXProvider(props: ParentProps<{ components?: MDXComponents }>): JSX.Element {
  const parentComponents = useContext(MDXContext)

  return createComponent(MDXContext, {
    get value() {
      return { ...parentComponents, ...props.components }
    },
    get children() {
      return props.children
    },
  })
}

/**
 * Resolves intrinsic and locally supplied MDX component overrides.
 * @default `{}` for `localComponents`.
 */
export function useMDXComponents(localComponents: MDXComponents = {}): MDXComponents {
  return { ...useContext(MDXContext), ...localComponents }
}

/**
 * Automatic JSX runtime used by compiled MDX output. Invokes function components
 * directly with `createComponent` so `component` props and reactive getters are
 * preserved; routes non-function elements (such as intrinsic tag strings) through
 * `Dynamic` so they work on both server and client in Solid 2.
 */
export function jsx(type: unknown, props: Record<string, unknown>): JSX.Element {
  if (typeof type === 'function') {
    return createComponent(type as Component<Record<string, unknown>>, props)
  }
  return createComponent(Dynamic, { ...props, component: type as keyof JSX.IntrinsicElements })
}
export const jsxs = jsx
export const jsxDEV = jsx

export function Fragment(props: { children?: JSX.Element }): JSX.Element {
  return props.children
}
