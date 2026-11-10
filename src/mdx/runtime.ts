import type { JSX } from '@solidjs/web'
import { Dynamic } from '@solidjs/web'
import { createComponent, createContext, merge, useContext } from 'solid-js'
import type { Component, ParentProps } from 'solid-js'

/** A component that can override an MDX element or component. */
export type MDXComponent<Props extends Record<string, any> = Record<string, unknown>> =
  Component<Props>
/** Component overrides supplied to `MDXProvider` or `useMDXComponents`. */
export type MDXComponents = {
  [Name in keyof JSX.IntrinsicElements]?: MDXComponent<JSX.IntrinsicElements[Name]>
} & {
  [name: string]: MDXComponent<any> | undefined
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
      createComponent(Dynamic as Component<any>, merge(rawProps, { component: name })),
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
 * Automatic JSX runtime used by compiled MDX output. Routes every element —
 * intrinsic or component — through `Dynamic`, which is the only Solid 2 path
 * that accepts both on the server and the client.
 */
export function jsx(type: any, props: any): JSX.Element {
  return createComponent(Dynamic, { ...props, component: type })
}
export const jsxs = jsx

export function Fragment(props: { children?: JSX.Element }): JSX.Element {
  return props.children
}
