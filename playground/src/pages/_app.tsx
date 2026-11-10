import type { JSX } from '@solidjs/web'
import { MDXProvider } from 'solid-file-router/mdx'

export const route = {
  loadingComponent: () => <div>Loading...</div>,
  errorComponent: Catch,
}

export default (props: any): any => {
  return (
    <MDXProvider>
      <div>{props.children}</div>
    </MDXProvider>
  )
}

function Catch(props: { error: any; reset: () => void }): JSX.Element {
  console.error(props)
  return (
    <div>
      <code>{props.error.message}</code>
      <div>Caught at _app error boundary</div>
      <button onClick={() => props.reset}>reset</button>
    </div>
  )
}
