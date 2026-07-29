import type { MDXComponent, MDXComponents } from '../../src/mdx'

const components: MDXComponents = {
  h1: (props) => <h1 class="page-title" {...props} />,
  a: (props) => <a class="content-link" href={props.href} {...props} />,
  Callout: (props: { tone: 'info' | 'warning' }) => <aside>{props.tone}</aside>,
  wrapper: (props) => <div>{props.children}</div>,
  RouteOutlet: (props) => <>{props.children}</>,
}

const callout: MDXComponent<{ tone: 'info' }> = (props) => <aside>{props.tone}</aside>
const legacyComponent: MDXComponent = () => <div />
const legacyComponents: MDXComponents = {
  Callout: callout,
  legacy: legacyComponent,
}

const invalidComponents: MDXComponents = {
  // @ts-expect-error h1 props do not include anchor-only href.
  h1: (props) => <h1 href={props.href} />,
}

void components
void legacyComponents
void invalidComponents
