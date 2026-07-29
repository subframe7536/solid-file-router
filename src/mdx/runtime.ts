import { createComponent, createContext, mergeProps, useContext } from 'solid-js'
import type { JSX, ParentProps } from 'solid-js'
import { Dynamic } from 'solid-js/web'

/** A component that can override an MDX element or component. */
export type MDXComponent = (props: Record<string, unknown>) => JSX.Element
/** Component overrides supplied to `MDXProvider` or `useMDXComponents`. */
export type MDXComponents = Record<string, MDXComponent>

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
      createComponent(Dynamic, mergeProps(rawProps, { component: name })),
  ]),
) as MDXComponents

const MDXContext = createContext<MDXComponents>(intrinsicComponents)

/** Provides runtime component overrides to descendants rendered from MDX. */
export function MDXProvider(props: ParentProps<{ components?: MDXComponents }>) {
  const parentComponents = useContext(MDXContext)

  return createComponent(MDXContext.Provider, {
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
